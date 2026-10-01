import { describe, expect, it } from 'vitest';
import { buildDemoLegacy } from '../demo';
import { auditSnapshot } from '../audit';
import { buildPlan } from '../plan';

describe('迁移前核对（收藏 / 评审 / 发布快照归属）', () => {
  const audit = auditSnapshot(buildDemoLegacy());

  it('归属唯一且回执对平 -> 可迁移', () => {
    const a = audit.pairs[1];
    expect(a.verdict).toBe('migratable');
    expect(a.brands).toEqual(['aurora']);
    expect(a.receipts[0].status).toBe('match');
  });

  it('同一编号指向多个品牌 -> 冲突，并逐方列出旧值', () => {
    const a = audit.pairs[3];
    expect(a.verdict).toBe('conflict');
    expect(a.conflictSides.map((s) => s.brand).sort()).toEqual(['aurora', 'lumen']);
    const aurora = a.conflictSides.find((s) => s.brand === 'aurora')!;
    const lumen = a.conflictSides.find((s) => s.brand === 'lumen')!;
    expect(aurora.oldGlobalId).toBe(3);
    expect(aurora.oldAlias).toBe('pair-3');
    // 双方各自的收藏、评审单、导出快照旧值都要列得出
    expect(aurora.claims.map((c) => c.kind)).toContain('favorite');
    expect(aurora.claims.map((c) => c.kind)).toContain('review');
    expect(lumen.claims.map((c) => c.kind)).toContain('export');
    // 双方收藏行各自归位（fav-a3 / fav-l3），旧值描述都带品牌与编号
    expect(aurora.claims.find((c) => c.ref === 'fav-a3')?.oldValue).toContain('aurora');
    expect(lumen.claims.find((c) => c.ref === 'fav-l3')?.oldValue).toContain('lumen');
    expect(a.reason).toContain('aurora');
    expect(a.reason).toContain('lumen');
  });

  it('站点回执编号+别名对不上 -> 停在待核', () => {
    const a = audit.pairs[4];
    expect(a.verdict).toBe('receipt-blocked');
    expect(a.receipts[0].status).toBe('alias-mismatch');
    expect(a.receipts[0].detail).toContain('pair-404');
    expect(audit.pendingPairIds).toContain(4);
  });

  it('指向不存在编号的回执进入孤儿列表', () => {
    expect(audit.orphanReceipts[0]).toMatchObject({ pairId: 99, status: 'missing-pair' });
  });

  it('没有任何归属信息 -> unclaimed 待核', () => {
    expect(audit.pairs[5].verdict).toBe('unclaimed');
    expect(audit.pendingPairIds).toContain(5);
  });
});

describe('迁移计划', () => {
  it('未裁决的冲突与待核编号不进计划，且带原因', () => {
    const plan = buildPlan(auditSnapshot(buildDemoLegacy()));
    expect(plan.entries.map((e) => e.pairId)).toEqual([1, 2]);
    expect(plan.pending.map((p) => p.pairId).sort()).toEqual([3, 4, 5, 99]);
  });

  it('assign 裁决：旧裸别名落到被选定的原品牌', () => {
    const plan = buildPlan(auditSnapshot(buildDemoLegacy()), { 3: { kind: 'assign', brand: 'lumen' } });
    const e3 = plan.entries.filter((e) => e.pairId === 3);
    expect(e3).toHaveLength(1);
    expect(e3[0]).toMatchObject({ brand: 'lumen', fork: false, keepBareAlias: true });
  });

  it('assign 给非冲突方被驳回', () => {
    const plan = buildPlan(auditSnapshot(buildDemoLegacy()), { 3: { kind: 'assign', brand: 'northwind' } });
    expect(plan.pending.find((p) => p.pairId === 3)?.reason).toContain('驳回');
  });

  it('fork 裁决：同一编号在两个品牌空间并存，裸别名只落一方', () => {
    const plan = buildPlan(auditSnapshot(buildDemoLegacy()), { 3: { kind: 'fork' } });
    const e3 = plan.entries.filter((e) => e.pairId === 3);
    expect(e3).toHaveLength(2);
    expect(e3.filter((e) => e.keepBareAlias)).toHaveLength(1);
    expect(e3.map((e) => e.brand).sort()).toEqual(['aurora', 'lumen']);
  });
});
