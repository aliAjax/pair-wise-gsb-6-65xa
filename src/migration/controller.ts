import { KEYS, KVPort, readJSON, writeJSON } from './storage';
import { auditSnapshot, type ConflictDecisions } from './audit';
import { buildPlan } from './plan';
import { loadLegacySnapshot } from './legacy';
import { makeCommit } from './faults';
import { confirmBrandMigration, migrateBrands, type MigrationResult } from './migrate';
import type {
  AuditReport,
  BrandId,
  LegacySnapshot,
  MigrationMeta,
  RenameJournalEntry,
  SiteReceiptRow,
} from './types';
import type { Actor } from './permissions';

/** 面向 UI 的门面：一键安装演示旧数据、审计、裁决、对账补正、执行/重试/确认 */
export class WorkspaceController {
  constructor(public kv: KVPort) {}

  hasLegacy(): boolean {
    return this.kv.getItem(KEYS.legacyPairs) != null;
  }

  installLegacy(snap: LegacySnapshot): void {
    writeJSON(this.kv, KEYS.legacyPairs, snap.pairs);
    writeJSON(this.kv, KEYS.legacyAssignment, snap.assignments);
    writeJSON(this.kv, KEYS.legacyFavorites, snap.favorites);
    writeJSON(this.kv, KEYS.legacyReviews, snap.reviews);
    writeJSON(this.kv, KEYS.legacyExports, snap.exports);
    writeJSON(this.kv, KEYS.siteReceipts, snap.receipts);
  }

  snapshot(): LegacySnapshot {
    return loadLegacySnapshot(this.kv);
  }

  audit(): AuditReport {
    return auditSnapshot(this.snapshot());
  }

  plan(decisions: ConflictDecisions) {
    return buildPlan(this.audit(), decisions);
  }

  meta(): MigrationMeta | null {
    return readJSON<MigrationMeta | null>(this.kv, KEYS.migrationMeta, null);
  }

  journal(): RenameJournalEntry[] {
    return readJSON<RenameJournalEntry[]>(this.kv, KEYS.renameJournal, []);
  }

  /** 站点补正回执（编号 + 别名）后重新入库，下一次审计即对平放行 */
  upsertReceipt(row: SiteReceiptRow): void {
    const rows = readJSON<SiteReceiptRow[]>(this.kv, KEYS.siteReceipts, []);
    const i = rows.findIndex((r) => r.receiptId === row.receiptId);
    if (i >= 0) rows[i] = row;
    else rows.push(row);
    writeJSON(this.kv, KEYS.siteReceipts, rows);
  }

  async runMigration(
    actor: Actor,
    decisions: ConflictDecisions,
    opts?: { onlyBrands?: BrandId[]; failBrands?: BrandId[]; failAtOp?: number; now?: string },
  ): Promise<MigrationResult> {
    const plan = buildPlan(this.audit(), decisions);
    return migrateBrands(actor, this.snapshot(), plan, {
      kv: this.kv,
      commit: makeCommit({ failBrands: opts?.failBrands, failAtOp: opts?.failAtOp }),
      delay: () => Promise.resolve(),
    }, { onlyBrands: opts?.onlyBrands, now: opts?.now });
  }

  confirm(actor: Actor, brand: BrandId) {
    return confirmBrandMigration(actor, brand, this.kv);
  }
}
