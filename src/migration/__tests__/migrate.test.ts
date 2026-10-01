import { describe, expect, it } from 'vitest';
import { MemoryKV, KEYS, readJSON } from '../storage';
import { WorkspaceController } from '../controller';
import { buildDemoLegacy } from '../demo';
import { makeCommit } from '../faults';
import { migrateBrands } from '../migrate';
import { auditSnapshot } from '../audit';
import { buildPlan } from '../plan';
import { buildDualIdCss, loadBrandSpace, resolveLink } from '../links';
import type { Actor } from '../permissions';
import type { StoredPair, MigrationMeta } from '../types';

const studio: Actor = { id: 'u-admin', name: 'Studio Admin', role: 'studio-admin' };
const auroraAdmin: Actor = { id: 'u-aur', name: 'Aurora Admin', role: 'brand-admin', brand: 'aurora' };
const lumenAdmin: Actor = { id: 'u-lum', name: 'Lumen Admin', role: 'brand-admin', brand: 'lumen' };
const northAdmin: Actor = { id: 'u-nor', name: 'North Admin', role: 'brand-admin', brand: 'northwind' };

function setup() {
  const kv = new MemoryKV();
  const ctl = new WorkspaceController(kv);
  ctl.installLegacy(buildDemoLegacy());
  return { kv, ctl };
}

const fork3 = { 3: { kind: 'fork' as const } };

describe('品牌隔离空间落库', () => {
  it('同一旧编号在不同品牌并存，品牌内编号各自独立', async () => {
    const { kv, ctl } = setup();
    const res = await ctl.runMigration(studio, fork3);
    expect(res.failed).toEqual([]);
    expect(res.completed.sort()).toEqual(['aurora', 'lumen', 'northwind']);

    const aurora = loadBrandSpace(studio, 'aurora', kv) as { pairs: StoredPair[] };
    const lumen = loadBrandSpace(studio, 'lumen', kv) as { pairs: StoredPair[] };
    const north = loadBrandSpace(studio, 'northwind', kv) as { pairs: StoredPair[] };

    expect(aurora.pairs.map((p) => p.localId)).toEqual([1, 2]);
    expect(north.pairs.map((p) => p.localId)).toEqual([1]);
    expect(lumen.pairs.map((p) => p.localId)).toEqual([1]);
    // 各品牌都有 #1，但旧编号不同 → 同编号并存、互不覆盖
    expect(aurora.pairs.find((p) => p.localId === 1)?.legacyId).toBe(1);
    expect(north.pairs.find((p) => p.localId === 1)?.legacyId).toBe(2);
    expect(lumen.pairs.find((p) => p.localId === 1)?.legacyId).toBe(3);
    // 旧全局编号 3 在两个品牌各有一份，uid 不同
    const a3 = aurora.pairs.find((p) => p.legacyId === 3)!;
    const l3 = lumen.pairs.find((p) => p.legacyId === 3)!;
    expect(a3.uid).not.toBe(l3.uid);
    expect(a3.alias).toBe('pair-3'); // 裸别名落第一方
    expect(l3.alias).toBe('brand:lumen:pair-3'); // 第二方命名空间别名
  });

  it('收藏/评审/导出按品牌拆库，不串到对方', async () => {
    const { kv, ctl } = setup();
    await ctl.runMigration(studio, fork3);
    const aurora = loadBrandSpace(studio, 'aurora', kv) as any;
    const lumen = loadBrandSpace(studio, 'lumen', kv) as any;
    expect(aurora.favorites.map((f: any) => f.favId).sort()).toEqual(['fav-a1', 'fav-a3']);
    expect(lumen.favorites.map((f: any) => f.favId)).toEqual(['fav-l3']);
    expect(aurora.reviews.map((r: any) => r.reviewId).sort()).toEqual(['rev-1', 'rev-3a']);
    expect(lumen.reviews.map((r: any) => r.reviewId)).toEqual(['rev-3l']);
    expect(aurora.exports.map((e: any) => e.exportId)).toEqual(['exp-1', 'exp-3a']);
    expect(lumen.exports.map((e: any) => e.exportId)).toEqual(['exp-3l']);
  });

  it('旧全局数据迁移后原样保留（旧链接可回退打开）', async () => {
    const { kv, ctl } = setup();
    await ctl.runMigration(studio, fork3);
    expect(kv.getItem(KEYS.legacyPairs)).not.toBeNull();
    expect(JSON.parse(kv.getItem(KEYS.legacyAssignment)!)).toHaveLength(5);
  });
});

describe('写入失败：只重试未完成品牌，已迁好的不重复改名', () => {
  it('lumen 首写失败后，aurora/northwind 保持 migrated，重试只补 lumen', async () => {
    const { kv, ctl } = setup();
    const first = await ctl.runMigration(studio, fork3, { failBrands: ['lumen'] });
    expect(first.completed.sort()).toEqual(['aurora', 'northwind']);
    expect(first.failed.map((f) => f.brand)).toEqual(['lumen']);

    const meta1 = ctl.meta()!;
    expect(meta1.brands.aurora.state).toBe('migrated');
    expect(meta1.brands.lumen.state).toBe('failed');
    const auroraRecordsFirst = ctl.journal().filter((j) => j.brand === 'aurora').length;
    expect(auroraRecordsFirst).toBeGreaterThan(0);

    const second = await ctl.runMigration(studio, fork3);
    expect(second.retried).toEqual(['lumen']);
    expect(second.skippedMigrated.sort()).toEqual(['aurora', 'northwind']);
    expect(second.completed).toEqual(['lumen']);
    expect(second.failed).toEqual([]);

    // 已迁好品牌没有新增任何改名操作
    expect(ctl.journal().filter((j) => j.brand === 'aurora')).toHaveLength(auroraRecordsFirst);
    const auroraPairs = (loadBrandSpace(studio, 'aurora', kv) as any).pairs;
    expect(auroraPairs).toHaveLength(2); // 没有重复写入

    const meta2 = ctl.meta()!;
    const recordsAfter = meta2.brands.aurora.records;
    await ctl.runMigration(studio, fork3); // 再来一次：全部跳过
    expect(ctl.meta()!.brands.aurora.records).toBe(recordsAfter);
  });

  it('品牌内部第 2 个改名失败：整品牌暂存丢弃，重试复用已分配编号', async () => {
    const { kv, ctl } = setup();
    const first = await ctl.runMigration(studio, fork3, { failBrands: ['aurora'], failAtOp: 2 });
    expect(first.failed[0].error).toContain('模拟写入故障');
    // 写一半的暂存没落盘
    const partial = loadBrandSpace(studio, 'aurora', kv) as any;
    expect(partial.pairs).toEqual([]);
    // 已分配编号 1 被记账，重试时稳定复用
    const pairMap = ctl.meta()!.brands.aurora.pairMap;
    expect(pairMap['1'].localId).toBe(1);

    const second = await ctl.runMigration(studio, fork3);
    expect(second.retried).toContain('aurora');
    const aurora = loadBrandSpace(studio, 'aurora', kv) as any;
    expect(aurora.pairs.map((p: StoredPair) => [p.legacyId, p.localId])).toEqual([[1, 1], [3, 2]]);
  });

  it('receipt-blocked 的编号不会被任何品牌迁走', async () => {
    const { kv, ctl } = setup();
    await ctl.runMigration(studio, fork3);
    const lumen = loadBrandSpace(studio, 'lumen', kv) as any;
    expect(lumen.pairs.find((p: StoredPair) => p.legacyId === 4)).toBeUndefined();
  });

  it('站点补正回执后重新审计放行，再迁编号 4', async () => {
    const { kv, ctl } = setup();
    await ctl.runMigration(studio, fork3);
    ctl.upsertReceipt({ receiptId: 'rcp-4-bad', pairId: 4, alias: 'pair-4', site: 'lumen-deploy', receivedAt: '2026-09-09T00:00:00Z' });
    expect(ctl.audit().pairs[4].verdict).toBe('migratable');
    const again = await ctl.runMigration(studio, fork3);
    expect(again.skippedMigrated.sort()).toEqual(['aurora', 'northwind']);
    const lumen = loadBrandSpace(studio, 'lumen', kv) as any;
    expect(lumen.pairs.find((p: StoredPair) => p.legacyId === 4)?.localId).toBe(2);
  });
});

describe('权限隔离', () => {
  it('brand-admin 跑全量计划：只迁本品牌，其余进 forbidden 且不读不写', async () => {
    const { kv, ctl } = setup();
    const res = await ctl.runMigration(auroraAdmin, fork3);
    expect(res.completed).toEqual(['aurora']);
    expect(res.forbidden.map((f) => f.brand).sort()).toEqual(['lumen', 'northwind']);
    expect(loadBrandSpace(studio, 'lumen', kv) as any).toMatchObject({ pairs: [] });
  });

  it('品牌管理员只能确认本品牌迁移', async () => {
    const { ctl } = setup();
    await ctl.runMigration(studio, fork3);
    expect(ctl.confirm(northAdmin, 'aurora')).toMatchObject({ ok: false });
    expect(ctl.confirm(auroraAdmin, 'aurora')).toMatchObject({ ok: true });
    const meta: MigrationMeta = ctl.meta()!;
    expect(meta.brands.aurora.confirmedBy).toBe('u-aur');
    expect(meta.brands.lumen.confirmed).toBe(false);
  });

  it('未迁完的品牌不能确认', async () => {
    const { kv, ctl } = setup();
    await ctl.runMigration(studio, fork3, { failBrands: ['lumen'] });
    expect(ctl.confirm(lumenAdmin, 'lumen').reason).toContain('尚未完成');
  });

  it('跨品牌读取被拒', () => {
    const { kv, ctl } = setup();
    // 直接用权限门面验证（无需迁移数据）
    expect(loadBrandSpace(auroraAdmin, 'lumen', kv)).toHaveProperty('forbidden');
  });
});

describe('旧链接与双编号导出', () => {
  async function migrated() {
    const { kv, ctl } = setup();
    await ctl.runMigration(studio, fork3);
    return { kv, ctl };
  }

  it('旧裸链接 pair-3 双方并存 -> 工作室视角消歧', async () => {
    const { kv } = await migrated();
    const r = resolveLink(studio, 'pair-3', kv);
    expect(r.outcome).toBe('disambiguation');
    if (r.outcome === 'disambiguation') {
      expect(r.candidates.map((c) => c.brand).sort()).toEqual(['aurora', 'lumen']);
    }
  });

  it('aurora 管理员打开旧链接 pair-3 -> 自动落到本品牌那一份', async () => {
    const { kv } = await migrated();
    const r = resolveLink(auroraAdmin, 'pair-3', kv);
    expect(r).toMatchObject({ outcome: 'resolved', brand: 'aurora' });
  });

  it('aurora 管理员打开他牌旧链接 pair-2 -> forbidden', async () => {
    const { kv } = await migrated();
    expect(resolveLink(auroraAdmin, 'pair-2', kv).outcome).toBe('forbidden');
  });

  it('裸编号 1 与命名空间别名都能解析', async () => {
    const { kv } = await migrated();
    expect(resolveLink(studio, '1', kv)).toMatchObject({ outcome: 'resolved', brand: 'aurora', localId: 1 });
    const ns = resolveLink(studio, 'brand:lumen:pair-3', kv);
    expect(ns).toMatchObject({ outcome: 'resolved', brand: 'lumen', localId: 1 });
    const newRoute = resolveLink(lumenAdmin, 'brand/lumen/local-1', kv);
    expect(newRoute).toMatchObject({ outcome: 'resolved', legacyId: 3 });
  });

  it('导出 CSS 同时保留新旧编号', async () => {
    const { kv } = await migrated();
    const lumen = loadBrandSpace(studio, 'lumen', kv) as any;
    const css = buildDualIdCss(lumen.pairs[0]);
    expect(css).toContain('旧编号（全局配对库）: #3');
    expect(css).toContain('新编号（品牌空间）: #1');
    expect(css).toContain('legacy-id: 3');
    expect(css).toContain('current-id: 1');
  });

  it('未迁移/未知引用 -> not-found', async () => {
    const { kv } = await migrated();
    expect(resolveLink(studio, 'pair-404', kv).outcome).toBe('not-found');
  });
});
