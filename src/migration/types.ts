// 领域模型：旧的全局配对库 + 新的品牌隔离空间 + 迁移过程产物

export type BrandId = string;

/* ---------- 旧时代（全局编号）数据 ---------- */

export interface LegacyPair {
  id: number; // 全局配对编号
  title: string;
  heading: string;
  body: string;
  category: string;
  favorite: boolean;
}

export interface LegacyFavoriteRow {
  favId: string;
  pairId: number;
  brand?: BrandId; // 收藏记录上标注的归属
  savedAt: string;
  note?: string;
}

export interface LegacyReviewRow {
  reviewId: string;
  pairId: number;
  brand?: BrandId; // 评审单上标注的归属
  alias?: string; // 评审单上抄写的别名，可能与正式别名不一致
  rating: number;
  verdict: string;
  updatedAt: string;
}

export interface LegacyExportRow {
  exportId: string;
  pairId: number;
  brand?: BrandId; // 已导出 CSS 快照上标注的归属
  alias?: string;
  css: string;
  fileName: string;
  exportedAt: string;
}

export interface SiteReceiptRow {
  receiptId: string;
  pairId: number; // 站点回执编号
  alias?: string; // 站点回执别名
  site: string;
  receivedAt: string;
}

/** 全局配对登记表（编号 -> 品牌），旧时代的“官方归属” */
export interface BrandAssignment {
  pairId: number;
  brand: BrandId;
}

export interface LegacySnapshot {
  pairs: LegacyPair[];
  assignments: BrandAssignment[];
  favorites: LegacyFavoriteRow[];
  reviews: LegacyReviewRow[];
  exports: LegacyExportRow[];
  receipts: SiteReceiptRow[];
}

/* ---------- 新空间（品牌隔离）数据 ---------- */

export interface StoredPair {
  uid: string; // 全空间唯一
  localId: number; // 品牌内编号（同一编号在不同品牌下可以并存）
  legacyId: number | null; // 旧的全局编号
  alias: string; // 品牌空间内别名
  legacyAlias: string | null; // 旧全局别名，留档
  title: string;
  heading: string;
  body: string;
  category: string;
  favorite: boolean;
}

export interface StoredFavorite {
  favId: string;
  pairUid: string;
  pairLocalId: number;
  legacyId: number | null;
  savedAt: string;
  note?: string;
}

export interface StoredReview {
  reviewId: string;
  pairUid: string;
  pairLocalId: number;
  legacyId: number | null;
  alias: string;
  legacyAlias: string | null;
  rating: number;
  verdict: string;
  updatedAt: string;
}

export interface StoredExport {
  exportId: string;
  pairUid: string;
  pairLocalId: number;
  legacyId: number | null;
  alias: string;
  legacyAlias: string | null;
  css: string;
  fileName: string;
  exportedAt: string;
}

/* ---------- 迁移审计 / 计划 ---------- */

export type RecordKind = 'favorite' | 'review' | 'export';

export interface RecordClaim {
  kind: RecordKind;
  ref: string;
  pairId: number;
  brand: BrandId | null;
  alias: string | null;
  oldValue: string; // 该方旧值：编号 + 别名的完整描述
}

export type ReceiptStatus =
  | 'match'
  | 'missing-pair'
  | 'alias-mismatch'
  | 'duplicate-alias';

export interface ReceiptFinding {
  receiptId: string;
  pairId: number;
  alias: string | null;
  expectedAlias: string;
  status: ReceiptStatus;
  detail: string;
}

export interface ConflictSide {
  brand: BrandId;
  oldGlobalId: number;
  oldAlias: string;
  claims: RecordClaim[];
}

export type PairVerdict =
  | 'migratable' // 归属唯一、回执对平
  | 'conflict' // 同一编号指向多个品牌，待人工裁决
  | 'receipt-blocked' // 站点回执对不上，停在待核
  | 'unclaimed' // 没有任何归属信息
  | 'resolved-assign' // 冲突已裁决给单一品牌
  | 'resolved-fork'; // 冲突已裁决为双方并存

export interface PairAttribution {
  pairId: number;
  registryBrand: BrandId | null;
  brands: BrandId[]; // 所有指向该编号的品牌
  claims: RecordClaim[];
  conflictSides: ConflictSide[]; // 多品牌时，逐方列出旧值
  receipts: ReceiptFinding[];
  verdict: PairVerdict;
  reason: string;
}

export interface AuditReport {
  generatedAt: string;
  pairs: Record<number, PairAttribution>;
  orphanReceipts: ReceiptFinding[]; // 指向不存在编号的回执
  pendingPairIds: number[]; // 停在“待核”的编号
}

/** 冲突裁决：归给某一品牌，或双方并存（fork） */
export type ConflictDecision =
  | { kind: 'assign'; brand: BrandId }
  | { kind: 'fork' };

/** 人工裁决表：编号 -> 归单一品牌 / 双方并存 */
export type ConflictDecisions = Record<number, ConflictDecision>;

export interface PlannedRecord {
  pairId: number; // 旧全局编号
  brand: BrandId;
  fork: boolean;
  keepBareAlias: boolean; // 旧裸别名 pair-N 是否指向本记录
}

export interface PendingPair {
  pairId: number;
  reason: string;
}

export interface MigrationPlan {
  entries: PlannedRecord[];
  pending: PendingPair[];
}

/* ---------- 迁移执行状态（断点续跑） ---------- */

export type BrandMigrationState = 'queued' | 'writing' | 'failed' | 'migrated';

export interface PairMapEntry {
  localId: number;
  uid: string;
}

export interface BrandStatus {
  state: BrandMigrationState;
  attempts: number;
  error: string | null;
  records: number; // 已完成改名的记录条数
  /** 旧全局编号 -> 本品牌新编号，续跑/重试时据此复用，绝不重复改名 */
  pairMap: Record<number, PairMapEntry>;
  confirmed: boolean;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export interface MigrationMeta {
  startedAt: string | null;
  finishedAt: string | null;
  brands: Record<BrandId, BrandStatus>;
}

export interface RenameJournalEntry {
  opId: string; // 幂等键：同一改名操作绝不执行第二次
  brand: BrandId;
  kind: 'pair' | 'favorite' | 'review' | 'export' | 'alias';
  ref: string;
  at: string;
}

export interface AliasEntry {
  alias: string;
  legacyId: number;
  kind: 'primary' | 'namespaced' | 'disambiguation';
  brand: BrandId | null;
  localId: number | null;
  uid: string | null;
  candidates?: { brand: BrandId; localId: number; uid: string }[];
}

export type LinkResolution =
  | { outcome: 'resolved'; brand: BrandId; localId: number; uid: string; legacyId: number | null; via: string }
  | { outcome: 'disambiguation'; legacyId: number; candidates: { brand: BrandId; localId: number; uid: string }[] }
  | { outcome: 'not-found'; ref: string }
  | { outcome: 'forbidden'; brand: BrandId; localId: number; ref: string };
