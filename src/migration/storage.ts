// 迁移状态的持久化端口：浏览器走 localStorage，测试走内存。
// 写入可以按品牌注入失败，用于验证「写入失败后只重试未完成品牌」。
import type {BrandId, LegacyIndex, ReconciledReceipt, ScopedClaim, ScopedPair} from './types';
import type {BrandMigrationState} from './types';

export interface ExportRecord {
  uid: string;
  brandId: BrandId;
  legacyId?: number;
  alias?: string;
  fileName: string;
  by: string;
  at: string;
}

export interface MigrationData {
  version: 1;
  scopedPairs: ScopedPair[];
  scopedClaims: ScopedClaim[];
  receipts: ReconciledReceipt[];
  brandStates: Record<BrandId, BrandMigrationState>;
  legacyIndex: LegacyIndex;
  sequences: Record<BrandId, number>;
  exports: ExportRecord[];
}

export function emptyMigrationData(): MigrationData {
  return {version: 1, scopedPairs: [], scopedClaims: [], receipts: [], brandStates: {}, legacyIndex: {}, sequences: {}, exports: []};
}

export interface StoragePort {
  load(): MigrationData;
  /** 整包写入；按品牌失败模拟由 failWrite 控制 */
  save(data: MigrationData, writingBrands: BrandId[]): void;
}

export class MemoryStorage implements StoragePort {
  constructor(
    private data: MigrationData = emptyMigrationData(),
    /** 剩余失败次数：brandId -> 次数 */
    private failRemaining: Record<string, number> = {},
  ) {}

  load(): MigrationData {
    return structuredClone(this.data);
  }

  save(data: MigrationData, writingBrands: BrandId[]): void {
    for (const brandId of writingBrands) {
      if ((this.failRemaining[brandId] ?? 0) > 0) {
        this.failRemaining[brandId]!--;
        throw new Error(`写入失败（模拟存储故障 brand=${brandId}）`);
      }
    }
    this.data = structuredClone(data);
  }
}

const STORAGE_KEY = 'type-pairs:branded:v1';
const BACKUP_KEY = 'type-pairs:legacy-backup:v1';

export class LocalStorageStorage implements StoragePort {
  constructor(private ls: Storage = localStorage) {}

  load(): MigrationData {
    try {
      const raw = this.ls.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as MigrationData;
    } catch {
      /* 损坏的包不覆盖，交由人工处理 */
    }
    return emptyMigrationData();
  }

  save(data: MigrationData, _writingBrands: BrandId[]): void {
    this.ls.setItem(STORAGE_KEY, JSON.stringify(data));
  }
}

/** 迁移前把全局旧键原样备份，旧链接与回溯都依赖它 */
export function backupLegacyStore(ls: Storage = localStorage, legacyKey = 'type-pairs'): boolean {
  const raw = ls.getItem(legacyKey);
  if (raw == null || ls.getItem(BACKUP_KEY)) return false;
  ls.setItem(BACKUP_KEY, raw);
  return true;
}
