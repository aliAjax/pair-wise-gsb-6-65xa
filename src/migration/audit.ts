import { canonicalAlias } from './legacy';
import type {
  AuditReport,
  BrandId,
  ConflictDecisions,
  ConflictSide,
  LegacySnapshot,
  PairAttribution,
  RecordClaim,
  RecordKind,
  ReceiptFinding,
} from './types';

const describeOldValue = (pairId: number, brand: BrandId | null, alias: string | null) =>
  `编号 #${pairId}${alias ? ` / 别名 ${alias}` : ' / 无别名'}${brand ? ` / 归属 ${brand}` : ' / 未标品牌'}`;

function claimFromRow(
  kind: RecordKind,
  ref: string,
  pairId: number,
  brand: BrandId | undefined,
  alias: string | undefined,
): RecordClaim {
  return {
    kind,
    ref,
    pairId,
    brand: brand ?? null,
    alias: alias ?? null,
    oldValue: describeOldValue(pairId, brand ?? null, alias ?? null),
  };
}

const uniqSorted = (xs: (BrandId | null)[]): BrandId[] =>
  [...new Set(xs.filter((x): x is BrandId => x != null))].sort();

/**
 * 迁移前核对：收藏、评审单、发布快照（含全局登记表）对同一编号声明的品牌归属，
 * 并按“编号 + 别名”对账站点回执。纯函数，不触碰存储。
 */
export function auditSnapshot(snap: LegacySnapshot, now = new Date().toISOString()): AuditReport {
  const pairs = new Map<number, unknown>();
  snap.pairs.forEach((p) => pairs.set(p.id, p));

  const attrs = new Map<number, PairAttribution>();
  const ensure = (pairId: number): PairAttribution => {
    let a = attrs.get(pairId);
    if (!a) {
      a = {
        pairId,
        registryBrand: null,
        brands: [],
        claims: [],
        conflictSides: [],
        receipts: [],
        verdict: 'unclaimed',
        reason: '',
      };
      attrs.set(pairId, a);
    }
    return a;
  };

  // 全局配对登记表
  const registryBrands = new Map<number, BrandId[]>();
  snap.assignments.forEach((a) => {
    const list = registryBrands.get(a.pairId) ?? [];
    list.push(a.brand);
    registryBrands.set(a.pairId, list);
    ensure(a.pairId);
  });

  // 收藏 / 评审 / 发布快照各自带的品牌标注与别名
  snap.favorites.forEach((f) =>
    ensure(f.pairId).claims.push(claimFromRow('favorite', f.favId, f.pairId, f.brand, undefined)),
  );
  snap.reviews.forEach((r) =>
    ensure(r.pairId).claims.push(claimFromRow('review', r.reviewId, r.pairId, r.brand, r.alias)),
  );
  snap.exports.forEach((e) =>
    ensure(e.pairId).claims.push(claimFromRow('export', e.exportId, e.pairId, e.brand, e.alias)),
  );
  snap.pairs.forEach((p) => ensure(p.id));

  // 站点回执：编号 + 别名对账
  const aliasOwners = new Map<string, Set<number>>();
  snap.receipts.forEach((r) => {
    if (!r.alias) return;
    const set = aliasOwners.get(r.alias) ?? new Set<number>();
    set.add(r.pairId);
    aliasOwners.set(r.alias, set);
  });

  const orphanReceipts: ReceiptFinding[] = [];

  snap.receipts.forEach((r) => {
    const expected = canonicalAlias(r.pairId);
    let finding: ReceiptFinding;
    if (!pairs.has(r.pairId)) {
      finding = {
        receiptId: r.receiptId,
        pairId: r.pairId,
        alias: r.alias ?? null,
        expectedAlias: expected,
        status: 'missing-pair',
        detail: `回执 ${r.receiptId}（${r.site}）指向编号 #${r.pairId}，但配对库中不存在该编号`,
      };
      orphanReceipts.push(finding);
      return;
    }
    const owners = r.alias ? aliasOwners.get(r.alias) : undefined;
    if (r.alias && owners && owners.size > 1) {
      finding = {
        receiptId: r.receiptId,
        pairId: r.pairId,
        alias: r.alias,
        expectedAlias: expected,
        status: 'duplicate-alias',
        detail: `回执 ${r.receiptId}（${r.site}）别名 ${r.alias} 被编号 ${[...owners].join('、')} 同时占用`,
      };
    } else if (r.alias && r.alias !== expected) {
      finding = {
        receiptId: r.receiptId,
        pairId: r.pairId,
        alias: r.alias,
        expectedAlias: expected,
        status: 'alias-mismatch',
        detail: `回执 ${r.receiptId}（${r.site}）编号 #${r.pairId} 对不上别名：回执写 ${r.alias}，应为 ${expected}`,
      };
    } else {
      finding = {
        receiptId: r.receiptId,
        pairId: r.pairId,
        alias: r.alias ?? null,
        expectedAlias: expected,
        status: 'match',
        detail: `回执 ${r.receiptId}：#${r.pairId} / ${r.alias ?? expected} 对平`,
      };
    }
    ensure(r.pairId).receipts.push(finding);
  });

  // 汇总结论
  const pendingPairIds: number[] = [];
  attrs.forEach((a) => {
    const regs = uniqSorted(registryBrands.get(a.pairId) ?? []);
    a.registryBrand = regs.length === 1 ? regs[0] : null;
    a.brands = uniqSorted([...regs, ...a.claims.map((c) => c.brand)]);

    if (a.brands.length > 1) {
      a.conflictSides = a.brands.map((brand): ConflictSide => {
        const sideClaims = a.claims.filter((c) => c.brand === brand);
        const aliases = uniqSorted(sideClaims.map((c) => c.alias));
        return {
          brand,
          oldGlobalId: a.pairId,
          oldAlias: aliases[0] ?? canonicalAlias(a.pairId),
          claims: sideClaims,
        };
      });
    }

    const badReceipts = a.receipts.filter((r) => r.status !== 'match');
    const conflict = a.brands.length > 1;
    if (badReceipts.length) {
      a.verdict = 'receipt-blocked';
      a.reason = `站点回执对不上：${badReceipts.map((r) => r.detail).join('；')}${
        conflict ? `（同时存在品牌归属冲突：${a.brands.join('、')}）` : ''
      }`;
      pendingPairIds.push(a.pairId);
    } else if (conflict) {
      a.verdict = 'conflict';
      a.reason = `编号 #${a.pairId} 同时指向 ${a.brands.length} 个品牌（${a.brands.join('、')}），双方旧值已列出，待工作室管理员裁决`;
      pendingPairIds.push(a.pairId);
    } else if (a.brands.length === 0) {
      a.verdict = 'unclaimed';
      a.reason = `编号 #${a.pairId} 在收藏、评审单、发布快照和登记表中均无品牌归属`;
      pendingPairIds.push(a.pairId);
    } else {
      a.verdict = 'migratable';
      a.reason = `归属唯一（${a.brands[0]}），回执对平，可迁移`;
    }
  });

  return {
    generatedAt: now,
    pairs: Object.fromEntries([...attrs].map(([id, a]) => [id, a])),
    orphanReceipts,
    pendingPairIds: [...pendingPairIds].sort((x, y) => x - y),
  };
}

/** 人工裁决表：编号 -> 归单一品牌 / 双方并存（类型定义在 types.ts） */
export type { ConflictDecisions };
