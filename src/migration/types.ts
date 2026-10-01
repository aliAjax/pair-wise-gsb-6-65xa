// 品牌隔离迁移：领域模型
// 旧世界：全局编号 number（type-pairs），收藏 / 评审单 / CSS 导出 / 发布快照 / 站点回执共用。
// 新世界：品牌空间 (brandId, uid)，旧编号保留为 legacyId，旧链接通过 legacy-index 回查。

export type BrandId = string;

export interface Brand {
  id: BrandId;
  name: string;
  color: string;
  /** 品牌管理员用户 id 列表（数据访问权限隔离） */
  admins: string[];
}

export type Role = 'studio' | 'brand-admin';

export interface Identity {
  userId: string;
  name: string;
  role: Role;
  /** brand-admin 可访问的品牌；studio 可访问全部 */
  brands?: BrandId[];
}

// --- 旧数据（全局编号时代） -------------------------------------------------

export interface LegacyPair {
  id: number; // 全局配对编号
  title: string;
  heading: string;
  body: string;
  category: string;
  favorite: boolean;
  /** 行内记录的客户品牌（可能缺失，也可能与业务单据互相矛盾） */
  brandId?: BrandId;
  alias?: string;
}

export type ClaimSource = 'favorite' | 'review' | 'css' | 'publish';

/** 收藏 / 评审单 / 已导出 CSS / 发布快照 对同一配对编号的归属记录 */
export interface LegacyClaim {
  source: ClaimSource;
  pairId: number;
  brandId?: BrandId;
  /** 单号或文件名，便于人工核对 */
  ref: string;
  /** 该单据里记下的旧值（标题 / 别名等），冲突时双方旧值要同时列出 */
  label?: string;
  alias?: string;
  at: string;
}

/** 站点回执：站点回传的编号 + 别名，用于发布后对账 */
export interface SiteReceipt {
  pairId: number;
  alias?: string;
  brandId?: BrandId;
  url: string;
  at: string;
}

// --- 迁移审计 ---------------------------------------------------------------

export interface OwnerSide {
  brandId: BrandId;
  sources: ClaimSource[];
  alias?: string;
  label?: string;
  at?: string;
  refs: string[];
}

export interface PairAudit {
  pairId: number;
  legacy: LegacyPair;
  /** 所有来源指向同一品牌时的确定归属 */
  ownerBrandId?: BrandId;
  /** 同一编号指向多个品牌时的双方（或多方）旧值 */
  sides: OwnerSide[];
  issues: Array<'ownership-conflict' | 'unclaimed'>;
  receipts: SiteReceipt[];
}

export interface OrphanRecord {
  kind: 'claim' | 'receipt';
  pairId: number;
  brandId?: BrandId;
  ref: string;
}

export interface AuditReport {
  generatedAt: string;
  pairs: PairAudit[];
  /** 单据 / 回执指向了根本不存在的旧编号 */
  orphans: OrphanRecord[];
  /** 每个品牌名下核对出的编号（含争议编号） */
  brandPairIds: Record<BrandId, number[]>;
}

// --- 新世界（品牌隔离空间） -------------------------------------------------

export type PairStatus = 'active' | 'pending-review';

export interface ScopedPair {
  /** 品牌空间内稳定新编号 */
  uid: string;
  brandId: BrandId;
  /** 旧全局编号，长期保留（旧链接、导出兼容） */
  legacyId?: number;
  alias?: string;
  title: string;
  heading: string;
  body: string;
  category: string;
  favorite: boolean;
  status: PairStatus;
  /** 待核原因，如 ownership-conflict / duplicate-alias */
  pendingReason?: string;
  migratedAt?: string;
}

export type LinkStatus = 'linked' | 'pending';

export interface ScopedClaim {
  source: ClaimSource;
  legacyId: number;
  brandId: BrandId;
  ref: string;
  label?: string;
  alias?: string;
  at: string;
  status: LinkStatus;
  uid?: string;
  reason?: string;
}

export type ReceiptStatus = 'matched' | 'pending';

export interface ReconciledReceipt extends SiteReceipt {
  brandId: BrandId;
  status: ReceiptStatus;
  uid?: string;
  reason?: 'number-not-found' | 'alias-mismatch' | 'ownership-pending' | 'unknown-brand';
}

export type BrandMigrationStatus =
  | 'pending'
  | 'in-progress'
  | 'needs-review' // 已写入但存在待核项，等待品牌管理员处理
  | 'ready' // 无待核项，等待品牌管理员确认
  | 'confirmed';

export interface MigrationSteps {
  pairs: boolean;
  claims: boolean;
  receipts: boolean;
}

export interface BrandMigrationState {
  brandId: BrandId;
  status: BrandMigrationStatus;
  steps: MigrationSteps;
  pendingPairIds: number[];
  migratedAt?: string;
  confirmedAt?: string;
  confirmedBy?: string;
  lastError?: string;
}

/** 旧编号 → 各品牌空间的落点（同一编号在不同品牌可以并存） */
export interface LegacyIndexEntry {
  legacyId: number;
  brandId: BrandId;
  uid: string;
  alias?: string;
  status: PairStatus;
}

export type LegacyIndex = Record<number, LegacyIndexEntry[]>;

export class AccessDeniedError extends Error {
  constructor(public who: string, public brandId: BrandId) {
    super(`${who} 无权访问品牌空间 ${brandId}`);
    this.name = 'AccessDeniedError';
  }
}
