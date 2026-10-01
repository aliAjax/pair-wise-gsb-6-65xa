// localStorage 持久化冒烟：模拟「执行迁移 → 刷新页面 → 重试/确认」跨实例
import {LocalStorageStorage} from './storage';
import {MigrationEngine} from './engine';
import {BRANDS, IDENTITIES, LEGACY_CLAIMS, LEGACY_PAIRS, SITE_RECEIPTS} from './seed';

const mem = new Map<string, string>();
const ls = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
} as unknown as Storage;

const input = {pairs: LEGACY_PAIRS, claims: LEGACY_CLAIMS, receipts: SITE_RECEIPTS};

const e1 = new MigrationEngine(new LocalStorageStorage(ls), BRANDS, input);
const s1 = e1.migrateAll(IDENTITIES.studio);
console.log('首次迁移结果:', s1.results.map((r) => `${r.brandId}:${r.status}${r.skipped ? '(skip)' : ''}`).join(', '), '失败:', s1.failed.length);

// “刷新页面”：新引擎、新 storage 实例，同一 localStorage
const e2 = new MigrationEngine(new LocalStorageStorage(ls), BRANDS, input);
const data = e2.snapshot();
console.log('刷新后品牌状态:', Object.entries(data.brandStates).map(([b, s]) => `${b}:${s.status}`).join(', '));

const again = e2.runBrand(IDENTITIES.studio, 'aurora');
console.log('重复执行 aurora -> skipped =', again.skipped);

const link = e2.resolveLegacyLink(IDENTITIES['u-yuki'], 1, 'editorial-calm');
console.log('旧链接 #1 回查:', link.kind === 'resolved' ? `${link.pair.brandId}/${link.pair.uid}` : link.kind);

const confirmed = e2.confirmBrand(IDENTITIES['u-sora'], 'lumen');
console.log('Lumen 管理员确认:', confirmed.status, confirmed.confirmedBy);
