// 品牌隔离迁移引擎
// 核心保证：
//  1. 以品牌为最小执行/重试单元：save 失败的品牌不落任何半成品，已完成品牌幂等跳过，不重复改名/写入；
//  2. 同编号多品牌归属冲突时，每个品牌各落一份 pending-review 副本，旧值全部保留可对账；
//  3. 站点回执按 编号 + 别名 对账，任一不符停在待核；
//  4. 权限隔离：品牌管理员只能查看/确认本品牌；
//  5. 旧链接经 legacyIndex 回查，迁完仍可打开；导出 CSS 同时保留新旧编号。
import {FALLBACK_BRAND, type AuditInput, runAudit} from './audit';
import {AccessDeniedError} from './types';
import type {
  BrandId,
  Identity,
  LegacyIndexEntry,
  ReconciledReceipt,
  ScopedClaim,
  ScopedPair,
} from './types';
import type {BrandMigrationState, MigrationSteps} from './types';
import type {ExportRecord, MigrationData, StoragePort} from './storage';

export interface BrandRunResult {
  brandId: BrandId;
  status: BrandMigrationState['status'];
  written: {pairs: number; claims: number; receipts: number};
  skipped: boolean;
}

export interface MigrateAllSummary {
  results: BrandRunResult[];
  failed: Array<{brandId: BrandId; error: string}>;
}

function formatUid(seq: number): string {
  return `P-${String(seq).padStart(4, '0')}`;
}

export class MigrationEngine {
  readonly report: ReturnType<typeof runAudit>;

  constructor(
    readonly storage: StoragePort,
    private brands: {id: BrandId; admins: string[]}[],
    private auditInput: AuditInput,
  ) {
    this.report = runAudit(auditInput);
  }

  // --- 权限 -------------------------------------------------------------

  assertBrandAccess(identity: Identity, brandId: BrandId): void {
    if (identity.role === 'studio') return;
    if (!identity.brands?.includes(brandId)) {
      throw new AccessDeniedError(identity.userId, brandId);
    }
  }

  canConfirm(identity: Identity, brandId: BrandId): boolean {
    if (identity.role === 'studio') return true;
    if (brandId === FALLBACK_BRAND) return false; // 兜底空间只有工作室能处理
    const brand = this.brands.find((b) => b.id === brandId);
    return !!brand && (identity.brands?.includes(brandId) ?? false) && brand.admins.includes(identity.userId);
  }

  // --- 期望集（由审计结果确定性推导，重试时据此补差） ----------------------

  private plannedBrandIds(): BrandId[] {
    const ids = new Set<BrandId>(Object.keys(this.report.brandPairIds));
    for (const o of this.report.orphans) if (o.brandId) ids.add(o.brandId);
    return [...ids].sort();
  }

  private pairAudit(legacyId: number) {
    return this.report.pairs.find((p) => p.pairId === legacyId);
  }

  /** 该品牌按计划应拥有的配对副本 */
  private expectedPairs(brandId: BrandId): Array<{legacyId: number; status: ScopedPair['status']; reason?: string}> {
    const out: Array<{legacyId: number; status: ScopedPair['status']; reason?: string}> = [];
    for (const audit of this.report.pairs) {
      if (audit.issues.includes('unclaimed')) {
        if (brandId === FALLBACK_BRAND) out.push({legacyId: audit.pairId, status: 'pending-review', reason: 'unclaimed'});
        continue;
      }
      if (audit.sides.some((s) => s.brandId === brandId)) {
        out.push({
          legacyId: audit.pairId,
          status: audit.ownerBrandId ? 'active' : 'pending-review',
          reason: audit.ownerBrandId ? undefined : 'ownership-conflict',
        });
      }
    }
    return out.sort((a, b) => a.legacyId - b.legacyId);
  }

  private expectedClaimRows(brandId: BrandId) {
    const rows = this.auditInput.claims.filter((c) => c.brandId === brandId).map((c) => ({...c}));
    for (const o of this.report.orphans) {
      if (o.kind === 'claim' && o.brandId === brandId) {
        rows.push(this.auditInput.claims.find((c) => c.pairId === o.pairId && c.ref === o.ref)!);
      }
    }
    return rows;
  }

  private expectedReceiptRows(brandId: BrandId) {
    const rows: Array<ReconciledReceipt> = [];
    for (const r of this.auditInput.receipts) {
      if (r.brandId !== brandId) continue;
      const audit = this.pairAudit(r.pairId);
      let entry: ReconciledReceipt = {...r, brandId, status: 'pending', reason: 'number-not-found'};
      const owned = audit?.sides.some((s) => s.brandId === brandId);
      if (audit && !owned && !audit.ownerBrandId) {
        // 争议编号但该品牌不在 sides（理论上不会发生），保持待核
        entry = {...r, brandId, status: 'pending', reason: 'ownership-pending'};
      } else if (audit?.issues.includes('ownership-conflict')) {
        entry = {...r, brandId, status: 'pending', reason: 'ownership-pending'};
      } else if (audit && owned) {
        if (r.alias && r.alias !== audit.legacy.alias) {
          entry = {...r, brandId, status: 'pending', reason: 'alias-mismatch'};
        } else if (!r.alias && audit.legacy.alias) {
          entry = {...r, brandId, status: 'pending', reason: 'alias-mismatch'};
        } else {
          entry = {...r, brandId, status: 'matched'};
        }
      }
      rows.push(entry);
    }
    return rows;
  }

  private hasPending(brandId: BrandId, data: MigrationData): boolean {
    if (data.scopedPairs.some((p) => p.brandId === brandId && p.status === 'pending-review')) return true;
    if (data.scopedClaims.some((c) => c.brandId === brandId && c.status === 'pending')) return true;
    if (data.receipts.some((r) => r.brandId === brandId && r.status === 'pending')) return true;
    return false;
  }

  // --- 执行 -------------------------------------------------------------

  /**
   * 迁移单个品牌。已完成（ready/needs-review/confirmed）的品牌直接跳过，
   * 因此重试只补未完成品牌，绝不会重复改名。
   */
  runBrand(identity: Identity, brandId: BrandId): BrandRunResult {
    this.assertBrandAccess(identity, brandId);
    const data = this.storage.load();

    const existing = data.brandStates[brandId];
    if (existing && (existing.status === 'confirmed' || existing.status === 'ready' || existing.status === 'needs-review')) {
      return {brandId, status: existing.status, written: {pairs: 0, claims: 0, receipts: 0}, skipped: true};
    }

    const now = new Date().toISOString();
    const inProgress: BrandMigrationState = {
      brandId,
      status: 'in-progress',
      steps: {pairs: false, claims: false, receipts: false},
      pendingPairIds: [],
    };
    data.brandStates[brandId] = inProgress;

    const written = {pairs: 0, claims: 0, receipts: 0};

    // 1) 配对副本：已存在的（brand + legacyId）不重复生成，新编号继续顺延
    const seqStart = data.sequences[brandId] ?? 0;
    let seq = seqStart;
    const newIndexEntries: LegacyIndexEntry[] = [];
    for (const expect of this.expectedPairs(brandId)) {
      const found = data.scopedPairs.find((p) => p.brandId === brandId && p.legacyId === expect.legacyId);
      if (found) {
        continue;
      }
      const audit = this.pairAudit(expect.legacyId)!;
      const side = audit.sides.find((s) => s.brandId === brandId);
      seq += 1;
      const uid = formatUid(seq);
      const pair: ScopedPair = {
        uid,
        brandId,
        legacyId: audit.pairId,
        alias: audit.legacy.alias ?? side?.alias,
        title: side?.label || audit.legacy.title,
        heading: audit.legacy.heading,
        body: audit.legacy.body,
        category: audit.legacy.category,
        // 收藏标记跟随该品牌自己的收藏单，而不是配对行
        favorite: this.auditInput.claims.some(
          (c) => c.pairId === audit.pairId && c.brandId === brandId && c.source === 'favorite',
        ),
        status: expect.status,
        pendingReason: expect.reason,
        migratedAt: now,
      };
      data.scopedPairs.push(pair);
      data.sequences[brandId] = seq;
      newIndexEntries.push({
        legacyId: audit.pairId,
        brandId,
        uid,
        alias: pair.alias,
        status: pair.status,
      });
      written.pairs += 1;
    }

    // 2) 业务单据链接（收藏 / 评审 / CSS / 发布快照）
    for (const claim of this.expectedClaimRows(brandId)) {
      const key = (c: ScopedClaim) => `${c.source}|${c.legacyId}|${c.brandId}|${c.ref}`;
      if (data.scopedClaims.some((c) => key(c) === key({...claim, status: 'linked', brandId, legacyId: claim.pairId}))) continue;
      const targetPair = data.scopedPairs.find((p) => p.brandId === brandId && p.legacyId === claim.pairId);
      const scoped: ScopedClaim = {
        source: claim.source,
        legacyId: claim.pairId,
        brandId,
        ref: claim.ref,
        label: claim.label,
        alias: claim.alias,
        at: claim.at,
        status: targetPair?.status === 'active' ? 'linked' : 'pending',
        uid: targetPair?.status === 'active' ? targetPair.uid : undefined,
        reason: !targetPair
          ? 'number-not-found'
          : targetPair.status === 'pending-review'
            ? 'ownership-pending'
            : undefined,
      };
      data.scopedClaims.push(scoped);
      written.claims += 1;
    }

    // 3) 站点回执对账（编号 + 别名）
    for (const receipt of this.expectedReceiptRows(brandId)) {
      const key = (r: ReconciledReceipt) => `${r.brandId}|${r.pairId}|${r.url}`;
      if (data.receipts.some((r) => key(r) === key(receipt))) continue;
      if (receipt.status === 'matched') {
        const target = data.scopedPairs.find((p) => p.brandId === brandId && p.legacyId === receipt.pairId);
        receipt.uid = target?.uid;
      }
      data.receipts.push(receipt);
      written.receipts += 1;
    }

    // legacy index（旧链接落点），追加新条目
    for (const entry of newIndexEntries) {
      (data.legacyIndex[entry.legacyId] ??= []).push(entry);
    }

    const steps: MigrationSteps = {
      pairs: this.expectedPairs(brandId).every((e) => data.scopedPairs.some((p) => p.brandId === brandId && p.legacyId === e.legacyId)),
      claims: this.expectedClaimRows(brandId).every((c) =>
        data.scopedClaims.some((x) => x.brandId === brandId && x.legacyId === c.pairId && x.source === c.source && x.ref === c.ref),
      ),
      receipts: this.expectedReceiptRows(brandId).every((r) =>
        data.receipts.some((x) => x.brandId === brandId && x.pairId === r.pairId && x.url === r.url),
      ),
    };

    const pendingPairIds = data.scopedPairs.filter((p) => p.brandId === brandId && p.status === 'pending-review').map((p) => p.legacyId!);
    const finalState: BrandMigrationState = {
      brandId,
      status: this.hasPending(brandId, data) ? 'needs-review' : 'ready',
      steps,
      pendingPairIds: [...new Set(pendingPairIds)].sort((a, b) => a - b),
      migratedAt: now,
    };
    data.brandStates[brandId] = finalState;

    // 整品牌单包写入：失败则上面的追加全部丢弃（storage 未落盘），重试时重新补差
    this.storage.save(data, [brandId]);
    return {brandId, status: finalState.status, written, skipped: false};
  }

  /** 工作室一次性迁移：逐品牌执行，单个品牌失败不影响其它品牌 */
  migrateAll(identity: Identity): MigrateAllSummary {
    if (identity.role !== 'studio') throw new AccessDeniedError(identity.userId, '*');
    const results: BrandRunResult[] = [];
    const failed: MigrateAllSummary['failed'] = [];
    for (const brandId of this.plannedBrandIds()) {
      try {
        results.push(this.runBrand(identity, brandId));
      } catch (err) {
        failed.push({brandId, error: (err as Error).message});
      }
    }
    return {results, failed};
  }

  /** 只重试未完成的品牌（已 ready/needs-review/confirmed 的不会被重复改名） */
  retryPending(identity: Identity): MigrateAllSummary {
    if (identity.role !== 'studio') throw new AccessDeniedError(identity.userId, '*');
    const data = this.storage.load();
    const done = (b: BrandId) => {
      const s = data.brandStates[b];
      return s && (s.status === 'ready' || s.status === 'needs-review' || s.status === 'confirmed');
    };
    const results: BrandRunResult[] = [];
    const failed: MigrateAllSummary['failed'] = [];
    for (const brandId of this.plannedBrandIds()) {
      if (done(brandId)) {
        const state = data.brandStates[brandId];
        results.push({brandId, status: state.status, written: {pairs: 0, claims: 0, receipts: 0}, skipped: true});
        continue;
      }
      try {
        results.push(this.runBrand(identity, brandId));
      } catch (err) {
        failed.push({brandId, error: (err as Error).message});
      }
    }
    return {results, failed};
  }

  // --- 品牌管理员确认 ----------------------------------------------------

  confirmBrand(identity: Identity, brandId: BrandId): BrandMigrationState {
    if (!this.canConfirm(identity, brandId)) throw new AccessDeniedError(identity.userId, brandId);
    const data = this.storage.load();
    const state = data.brandStates[brandId];
    if (!state) throw new Error(`品牌 ${brandId} 尚未迁移`);
    if (state.status === 'confirmed') return state;
    if (state.status !== 'ready' && state.status !== 'needs-review') {
      throw new Error(`品牌 ${brandId} 当前状态 ${state.status}，无法确认`);
    }
    state.status = 'confirmed';
    state.confirmedAt = new Date().toISOString();
    state.confirmedBy = identity.userId;
    this.storage.save(data, [brandId]);
    return state;
  }

  // --- 旧链接解析（迁完后旧链接仍可打开） ---------------------------------

  resolveLegacyLink(
    identity: Identity,
    legacyId: number,
    alias?: string,
    hint?: {brandId?: BrandId},
  ):
    | {kind: 'resolved'; pair: ScopedPair}
    | {kind: 'ambiguous'; options: ScopedPair[]}
    | {kind: 'alias-mismatch'; expected: ScopedPair; suppliedAlias?: string}
    | {kind: 'not-found'} {
    const data = this.storage.load();
    let entries = (data.legacyIndex[legacyId] ?? []).map((e) =>
      data.scopedPairs.find((p) => p.brandId === e.brandId && p.uid === e.uid)!,
    ).filter(Boolean);
    entries = entries.filter((p) => {
      try {
        this.assertBrandAccess(identity, p.brandId);
        return true;
      } catch {
        return false;
      }
    });
    if (entries.length === 0) return {kind: 'not-found'};
    if (entries.length === 1) {
      if (alias && entries[0].alias && alias !== entries[0].alias) {
        return {kind: 'alias-mismatch', expected: entries[0], suppliedAlias: alias};
      }
      return {kind: 'resolved', pair: entries[0]};
    }
    if (hint?.brandId) {
      const picked = entries.find((p) => p.brandId === hint.brandId);
      if (picked) return {kind: 'resolved', pair: picked};
    }
    if (alias) {
      const matched = entries.filter((p) => p.alias === alias);
      if (matched.length === 1) return {kind: 'resolved', pair: matched[0]};
    }
    return {kind: 'ambiguous', options: entries};
  }

  // --- 导出（同时保留新旧编号） ------------------------------------------

  exportCss(identity: Identity, uid: string, brandId: BrandId): {css: string; fileName: string; record: ExportRecord} {
    this.assertBrandAccess(identity, brandId);
    const data = this.storage.load();
    const pair = data.scopedPairs.find((p) => p.uid === uid && p.brandId === brandId);
    if (!pair) throw new Error(`品牌 ${brandId} 下找不到 ${uid}`);
    const header =
      `/* brand: ${brandId}\n` +
      ` * 新编号 uid: ${pair.uid}${pair.legacyId != null ? `\n * 旧全局编号 legacy pairing no.: ${pair.legacyId}` : ''}${pair.alias ? `\n * alias: ${pair.alias}` : ''}\n` +
      ` * migrated: ${pair.migratedAt ?? ''} */`;
    const css = `${header}\n.heading { /* ${pair.title} */ }\n.body { /* ${pair.category} */ }\n`;
    const record: ExportRecord = {
      uid,
      brandId,
      legacyId: pair.legacyId,
      alias: pair.alias,
      fileName: `${brandId}-${pair.uid}.css`,
      by: identity.userId,
      at: new Date().toISOString(),
    };
    data.exports.push(record);
    this.storage.save(data, [brandId]);
    return {css, fileName: record.fileName, record};
  }

  /** 品牌管理员视角的迁移面板数据（只含本品牌） */
  brandDashboard(identity: Identity, brandId: BrandId) {
    this.assertBrandAccess(identity, brandId);
    const data = this.storage.load();
    return {
      state: data.brandStates[brandId],
      pairs: data.scopedPairs.filter((p) => p.brandId === brandId),
      claims: data.scopedClaims.filter((c) => c.brandId === brandId),
      receipts: data.receipts.filter((r) => r.brandId === brandId),
    };
  }

  snapshot(): MigrationData {
    return this.storage.load();
  }
}
