import type { BrandId } from './types';

/* 存储布局：
 * 旧全局键（迁移后原样保留，旧链接/回滚仍可使用）：
 *   type-pairs, type-favorites, type-reviews, type-exports,
 *   type-brand-assignment, type-site-receipts
 * 品牌隔离空间：
 *   brand:{brand}:pairs / favorites / reviews / exports
 * 全局索引（旧链接解析、断点续跑）：
 *   alias-index, migration-meta, rename-journal
 */

export const KEYS = {
  legacyPairs: 'type-pairs',
  legacyFavorites: 'type-favorites',
  legacyReviews: 'type-reviews',
  legacyExports: 'type-exports',
  legacyAssignment: 'type-brand-assignment',
  siteReceipts: 'type-site-receipts',
  aliasIndex: 'alias-index',
  migrationMeta: 'migration-meta',
  renameJournal: 'rename-journal',
} as const;

export const brandKey = (brand: BrandId, kind: 'pairs' | 'favorites' | 'reviews' | 'exports') =>
  `brand:${brand}:${kind}`;

/** 编号命名空间化别名：同一编号在多个品牌并存时使用 */
export const namespacedAlias = (brand: BrandId, legacyId: number) =>
  `brand:${brand}:pair-${legacyId}`;

/** 最小持久化接口：localStorage 与内存实现共用，便于测试与故障注入 */
export interface KVPort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

export class MemoryKV implements KVPort {
  private m = new Map<string, string>();
  getItem(key: string) {
    return this.m.has(key) ? this.m.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.m.set(key, value);
  }
  removeItem(key: string) {
    this.m.delete(key);
  }
  keys() {
    return [...this.m.keys()];
  }
}

export class LocalStorageKV implements KVPort {
  constructor(private ls: Storage = localStorage) {}
  getItem(key: string) {
    return this.ls.getItem(key);
  }
  setItem(key: string, value: string) {
    this.ls.setItem(key, value);
  }
  removeItem(key: string) {
    this.ls.removeItem(key);
  }
  keys() {
    const out: string[] = [];
    for (let i = 0; i < this.ls.length; i++) {
      const k = this.ls.key(i);
      if (k) out.push(k);
    }
    return out;
  }
}

/** 读取 JSON，缺省/损坏时回退到 fallback，不抛异常 */
export function readJSON<T>(kv: KVPort, key: string, fallback: T): T {
  const raw = kv.getItem(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON(kv: KVPort, key: string, value: unknown): void {
  kv.setItem(key, JSON.stringify(value));
}
