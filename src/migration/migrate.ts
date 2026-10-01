import { brandKey, KEYS, namespacedAlias, readJSON, writeJSON, type KVPort } from './storage';
import { canConfirmBrand, canMigrateBrand, type Actor } from './permissions';
import { canonicalAlias } from './legacy';
import type {
  AliasEntry,
  BrandId,
  BrandStatus,
  LegacySnapshot,
  MigrationMeta,
  MigrationPlan,
  PairMapEntry,
  RenameJournalEntry,
  StoredExport,
  StoredFavorite,
  StoredPair,
  StoredReview,
} from './types';

export interface MigrationResult {
  meta: MigrationMeta;
  completed: BrandId[]; // 本次跑通的品牌
  retried: BrandId[]; // 本次重试（之前未完成）的品牌
  skippedMigrated: BrandId[]; // 已迁好、跳过不重复改名的品牌
  forbidden: { brand: BrandId; reason: string }[];
  failed: { brand: BrandId; error: string }[];
}

export interface MigrateDeps {
  kv: KVPort;
  /**
   * 原子提交一个改名操作。可按品牌注入失败（写一半掉盘的模拟）：
   * 抛错时本次所有内存改动必须作废（调用方先暂存、commit 成功才落账）。
   */
  commit(brand: BrandId, opId: string, apply: () => void): void;
  delay?(ms: number): Promise<void>;
}

const uidOf = (brand: BrandId, localId: number) => `${brand}:${localId}`;

function freshBrandStatus(): BrandStatus {
  return {
    state: 'queued',
    attempts: 0,
    error: null,
    records: 0,
    pairMap: {},
    confirmed: false,
    confirmedBy: null,
    confirmedAt: null,
  };
}

function loadMeta(kv: KVPort): MigrationMeta {
  return readJSON<MigrationMeta | null>(kv, KEYS.migrationMeta, null) ?? {
    startedAt: null,
    finishedAt: null,
    brands: {},
  };
}

/** 把计划按品牌分组（fork 时同一旧编号在不同品牌各自一份） */
function groupByBrand(plan: MigrationPlan): Map<BrandId, { entries: MigrationPlan['entries']; idx: number }> {
  const m = new Map<BrandId, { entries: MigrationPlan['entries']; idx: number }>();
  plan.entries.forEach((e, idx) => {
    const slot = m.get(e.brand) ?? { entries: [], idx: Infinity };
    slot.entries.push(e);
    slot.idx = Math.min(slot.idx, idx);
    m.set(e.brand, slot);
  });
  return m;
}

const nextLocalId = (pairs: StoredPair[]) =>
  pairs.reduce((max, p) => Math.max(max, p.localId), 0) + 1;

/**
 * 执行迁移（可断点续跑）：
 * - 只处理 queued/writing/failed 的品牌；state=migrated 的品牌直接跳过，不重复改名；
 * - 单个品牌写入失败只标记该品牌，其它品牌继续；重跑只重试未完成品牌；
 * - 幂等由“品牌状态 + rename journal 双层”保证：同一 opId 绝不执行第二次；
 * - brand-admin 只能触发本品牌，跨品牌请求进 forbidden 且不读不写。
 */
export async function migrateBrands(
  actor: Actor,
  snap: LegacySnapshot,
  plan: MigrationPlan,
  deps: MigrateDeps,
  options?: { onlyBrands?: BrandId[]; now?: string },
): Promise<MigrationResult> {
  const now = options?.now ?? new Date().toISOString();
  const { kv } = deps;
  const meta = loadMeta(kv);
  if (!meta.startedAt) meta.startedAt = now;

  const result: MigrationResult = {
    meta,
    completed: [],
    retried: [],
    skippedMigrated: [],
    forbidden: [],
    failed: [],
  };

  const legacyPairs = new Map(snap.pairs.map((p) => [p.id, p]));
  const grouped = groupByBrand(plan);
  // 品牌处理顺序 = 该品牌第一个条目在计划中的顺序，保证稳定可复现
  const targets = (options?.onlyBrands ?? [...grouped.keys()].sort((a, b) =>
    (grouped.get(a)?.idx ?? 0) - (grouped.get(b)?.idx ?? 0),
  )).filter((b) => grouped.has(b));

  for (const brand of targets) {
    const perm = canMigrateBrand(actor, brand);
    if (!perm.ok) {
      result.forbidden.push({ brand, reason: perm.reason! });
      continue;
    }

    const status: BrandStatus = meta.brands[brand] ?? freshBrandStatus();
    const alreadyMigrated = status.state === 'migrated';
    if (status.attempts > 0 && !alreadyMigrated) result.retried.push(brand);

    status.state = 'writing';
    if (!alreadyMigrated) status.attempts += 1;
    status.error = null;
    meta.brands[brand] = status;
    writeJSON(kv, KEYS.migrationMeta, meta);

    // 暂存区：commit 成功才并入，避免“写一半”污染品牌空间
    const stage = {
      pairs: readJSON<StoredPair[]>(kv, brandKey(brand, 'pairs'), []),
      favorites: readJSON<StoredFavorite[]>(kv, brandKey(brand, 'favorites'), []),
      reviews: readJSON<StoredReview[]>(kv, brandKey(brand, 'reviews'), []),
      exports: readJSON<StoredExport[]>(kv, brandKey(brand, 'exports'), []),
      aliases: readJSON<AliasEntry[]>(kv, KEYS.aliasIndex, []),
      journal: readJSON<RenameJournalEntry[]>(kv, KEYS.renameJournal, []),
    };
    const doneOps = new Set(stage.journal.map((j) => j.opId));
    let localRecords = 0;

    const commit = (
      pairId: number,
      kind: RenameJournalEntry['kind'],
      ref: string,
      apply: () => void,
    ) => {
      const opId = `${brand}:${pairId}:${kind}:${ref}`;
      if (doneOps.has(opId)) return; // 已完成的改名操作：绝不重复
      deps.commit(brand, opId, apply); // 可能注入失败 -> 本品牌整体回滚到 stage 起点
      stage.journal.push({ opId, brand, kind, ref, at: now });
      doneOps.add(opId);
      localRecords += 1;
    };

    const upsertAlias = (entry: AliasEntry) => {
      const i = stage.aliases.findIndex((a) => a.alias === entry.alias);
      if (i >= 0) stage.aliases[i] = entry;
      else stage.aliases.push(entry);
    };

    try {
      for (const entry of grouped.get(brand)!.entries) {
        const legacy = legacyPairs.get(entry.pairId);
        if (!legacy) throw new Error(`品牌 ${brand}：旧编号 #${entry.pairId} 在配对库中不存在`);

        // 1) 旧全局编号 -> 品牌内新编号（续跑复用 pairMap，保证不重新分配）
        let mapped: PairMapEntry | undefined = status.pairMap[entry.pairId];
        if (!mapped) {
          const localId = nextLocalId(stage.pairs);
          mapped = { localId, uid: uidOf(brand, localId) };
          status.pairMap[entry.pairId] = mapped;
        }
        const { localId, uid } = mapped;
        const bare = canonicalAlias(entry.pairId);

        // 2) 配对主体改名落到品牌空间
        commit(entry.pairId, 'pair', String(legacy.id), () => {
          if (!stage.pairs.some((p) => p.uid === uid)) {
            stage.pairs.push({
              uid,
              localId,
              legacyId: legacy.id,
              alias: entry.keepBareAlias ? bare : namespacedAlias(brand, legacy.id),
              legacyAlias: bare,
              title: legacy.title,
              heading: legacy.heading,
              body: legacy.body,
              category: legacy.category,
              favorite: legacy.favorite,
            });
          }
        });

        // 3) 收藏：只迁本品牌标注的行；冲突编号上的他牌收藏留在待核，不串库
        snap.favorites
          .filter((f) => f.pairId === entry.pairId)
          .filter((f) =>
            entry.fork ? f.brand === brand : (f.brand ?? null) === brand || f.brand == null,
          )
          .forEach((f) =>
            commit(entry.pairId, 'favorite', f.favId, () => {
              stage.favorites.push({
                favId: f.favId,
                pairUid: uid,
                pairLocalId: localId,
                legacyId: f.pairId,
                savedAt: f.savedAt,
                ...(f.note ? { note: f.note } : {}),
              });
            }),
          );

        // 4) 评审单：品牌标注匹配；fork 双方各自带走自己的评审
        snap.reviews
          .filter((r) => r.pairId === entry.pairId)
          .filter((r) =>
            entry.fork ? r.brand === brand : (r.brand ?? null) === brand || r.brand == null,
          )
          .forEach((r) =>
            commit(entry.pairId, 'review', r.reviewId, () => {
              stage.reviews.push({
                reviewId: r.reviewId,
                pairUid: uid,
                pairLocalId: localId,
                legacyId: r.pairId,
                alias: entry.keepBareAlias ? bare : namespacedAlias(brand, r.pairId),
                legacyAlias: r.alias ?? bare,
                rating: r.rating,
                verdict: r.verdict,
                updatedAt: r.updatedAt,
              });
            }),
          );

        // 5) 已导出 CSS 快照：同评审规则，并保留新旧编号
        snap.exports
          .filter((e) => e.pairId === entry.pairId)
          .filter((e) =>
            entry.fork ? e.brand === brand : (e.brand ?? null) === brand || e.brand == null,
          )
          .forEach((e) =>
            commit(entry.pairId, 'export', e.exportId, () => {
              stage.exports.push({
                exportId: e.exportId,
                pairUid: uid,
                pairLocalId: localId,
                legacyId: e.pairId,
                alias: entry.keepBareAlias ? bare : namespacedAlias(brand, e.pairId),
                legacyAlias: e.alias ?? bare,
                css: e.css,
                fileName: e.fileName,
                exportedAt: e.exportedAt,
              });
            }),
          );

        // 6) 别名索引（全局，但指向品牌空间，受读权限约束）
        if (entry.fork) {
          commit(entry.pairId, 'alias', namespacedAlias(brand, entry.pairId), () =>
            upsertAlias({
              alias: namespacedAlias(brand, entry.pairId),
              legacyId: entry.pairId,
              kind: 'namespaced',
              brand,
              localId,
              uid,
            }),
          );
          commit(entry.pairId, 'alias', `disambig:${bare}`, () => {
            const dis = stage.aliases.find((a) => a.alias === bare);
            // 只收已真正分配过编号的品牌；尚未迁移的一方不能留下空候选
            const fresh = plan.entries
              .filter((e2) => e2.pairId === entry.pairId && e2.fork)
              .map((e2) => {
                const m2 = meta.brands[e2.brand]?.pairMap[entry.pairId];
                return m2 ? { brand: e2.brand, localId: m2.localId, uid: m2.uid } : null;
              })
              .filter((c): c is { brand: BrandId; localId: number; uid: string } => c != null);
            const prev = dis?.kind === 'disambiguation' ? (dis.candidates ?? []) : [];
            const merged = [...fresh, ...prev.filter((p) => !fresh.some((f) => f.brand === p.brand))];
            upsertAlias({
              alias: bare,
              legacyId: entry.pairId,
              kind: 'disambiguation',
              brand: null,
              localId: null,
              uid: null,
              candidates: merged.length ? merged : [{ brand, localId, uid }],
            });
          });
        } else {
          commit(entry.pairId, 'alias', bare, () =>
            upsertAlias({
              alias: bare,
              legacyId: entry.pairId,
              kind: 'primary',
              brand,
              localId,
              uid,
            }),
          );
        }
      }

      // 品牌全部条目无故障：暂存区整体落盘
      writeJSON(kv, brandKey(brand, 'pairs'), stage.pairs);
      writeJSON(kv, brandKey(brand, 'favorites'), stage.favorites);
      writeJSON(kv, brandKey(brand, 'reviews'), stage.reviews);
      writeJSON(kv, brandKey(brand, 'exports'), stage.exports);
      writeJSON(kv, KEYS.aliasIndex, stage.aliases);
      writeJSON(kv, KEYS.renameJournal, stage.journal);

      status.records = readJSON<RenameJournalEntry[]>(kv, KEYS.renameJournal, [])
        .filter((j) => j.brand === brand).length;
      status.state = 'migrated';
      status.error = null;
      meta.brands[brand] = status;
      // 没有任何新改名 = 已迁好的品牌，只做幂等跳过；有新增 = 增量迁入（不重复旧改名）
      if (localRecords === 0) result.skippedMigrated.push(brand);
      else result.completed.push(brand);
    } catch (e) {
      // 本品牌写入失败：暂存区丢弃，已迁好的品牌与其他品牌不受影响
      status.state = 'failed';
      status.error = e instanceof Error ? e.message : String(e);
      meta.brands[brand] = status;
      result.failed.push({ brand, error: status.error });
    }
    writeJSON(kv, KEYS.migrationMeta, meta);
    if (deps.delay) await deps.delay(0);
  }

  if (result.completed.length && result.failed.length === 0
      && [...grouped.keys()].every((b) => meta.brands[b]?.state === 'migrated' || !targets.includes(b))) {
    const allInScope = (options?.onlyBrands ?? [...grouped.keys()]);
    if (allInScope.every((b) => meta.brands[b]?.state === 'migrated')) {
      meta.finishedAt = now;
      writeJSON(kv, KEYS.migrationMeta, meta);
    }
  }

  return result;
}

/** 品牌管理员确认本品牌迁移（只能确认本品牌；工作室管理员可代确认） */
export function confirmBrandMigration(
  actor: Actor,
  brand: BrandId,
  kv: KVPort,
  now = new Date().toISOString(),
): { ok: boolean; reason?: string } {
  const perm = canConfirmBrand(actor, brand);
  if (!perm.ok) return perm;
  const meta = loadMeta(kv);
  const status = meta.brands[brand];
  if (!status || status.state !== 'migrated') {
    return { ok: false, reason: `品牌 ${brand} 尚未完成迁移，无可确认对象` };
  }
  status.confirmed = true;
  status.confirmedBy = actor.id;
  status.confirmedAt = now;
  writeJSON(kv, KEYS.migrationMeta, meta);
  return { ok: true };
}
