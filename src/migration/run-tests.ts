// 迁移验证：归属核对 / 品牌隔离写入 / 失败重试 / 权限 / 回执对账 / 旧链接 / 双编号导出
import assert from 'node:assert/strict';
import test from 'node:test';
import {runAudit, FALLBACK_BRAND} from './audit';
import {MemoryStorage} from './storage';
import {MigrationEngine} from './engine';
import {BRANDS, IDENTITIES, LEGACY_CLAIMS, LEGACY_PAIRS, SITE_RECEIPTS} from './seed';
import {AccessDeniedError} from './types';

const auditInput = {pairs: LEGACY_PAIRS, claims: LEGACY_CLAIMS, receipts: SITE_RECEIPTS};
const studio = IDENTITIES.studio;
const yuki = IDENTITIES['u-yuki']; // aurora 管理员
const marcus = IDENTITIES['u-marcus']; // northwind 管理员
const sora = IDENTITIES['u-sora']; // lumen 管理员

test('迁移前核对：归属冲突列出双方旧值', () => {
  const report = runAudit(auditInput);
  const five = report.pairs.find((p) => p.pairId === 5)!;
  assert.deepEqual(five.issues, ['ownership-conflict']);
  assert.equal(five.sides.length, 2);
  const aurora = five.sides.find((s) => s.brandId === 'aurora')!;
  const lumen = five.sides.find((s) => s.brandId === 'lumen')!;
  // 双方旧值（别名 / 标题 / 来源单据）都要在
  assert.equal(aurora.alias, 'warm-headlines');
  assert.equal(aurora.label, 'Warm headlines');
  assert.deepEqual(aurora.sources.sort(), ['favorite', 'review']);
  assert.equal(lumen.alias, 'warm-headlines');
  assert.match(lumen.label!, /Lumen/);
  assert.deepEqual(lumen.sources, ['css']);
  assert.ok(lumen.refs.includes('css/warm-headlines.v3.css'));

  const six = report.pairs.find((p) => p.pairId === 6)!;
  assert.deepEqual(six.sides.map((s) => s.brandId).sort(), ['lumen', 'northwind']);
});

test('迁移前核对：未认领与孤儿单据', () => {
  const report = runAudit(auditInput);
  const eight = report.pairs.find((p) => p.pairId === 8)!;
  assert.deepEqual(eight.issues, ['unclaimed']);
  assert.ok(report.brandPairIds[FALLBACK_BRAND].includes(8));
  assert.ok(report.orphans.some((o) => o.kind === 'claim' && o.pairId === 99 && o.ref === 'REV-130'));
  assert.ok(report.orphans.some((o) => o.kind === 'receipt' && o.pairId === 42));
});

test('全量迁移：同编号在不同品牌并存，争议项停在待核', () => {
  const engine = new MigrationEngine(new MemoryStorage(), BRANDS, auditInput);
  engine.migrateAll(studio);
  const data = engine.snapshot();

  // aurora：1/2/4 生效，5 待核
  const aurora = data.scopedPairs.filter((p) => p.brandId === 'aurora');
  assert.deepEqual(aurora.map((p) => p.legacyId).sort(), [1, 2, 4, 5]);
  assert.equal(aurora.find((p) => p.legacyId === 5)!.status, 'pending-review');
  assert.equal(aurora.find((p) => p.legacyId === 1)!.status, 'active');

  // lumen 也有编号 5（与 aurora 并存，各自独立 uid）
  const lumen5 = data.scopedPairs.filter((p) => p.brandId === 'lumen' && p.legacyId === 5);
  assert.equal(lumen5.length, 1);
  assert.equal(lumen5[0].status, 'pending-review');
  const aurora5 = aurora.find((p) => p.legacyId === 5)!;
  assert.notEqual(lumen5[0].uid, aurora5.uid);

  // 编号 6 双品牌待核；编号 3/7 生效
  assert.equal(data.scopedPairs.find((p) => p.brandId === 'northwind' && p.legacyId === 3)!.status, 'active');
  for (const p of data.scopedPairs.filter((p) => p.legacyId === 6)) assert.equal(p.status, 'pending-review');
  assert.equal(data.scopedPairs.find((p) => p.brandId === 'lumen' && p.legacyId === 7)!.status, 'active');

  // 未认领进工作室兜底空间
  const fallback = data.scopedPairs.find((p) => p.brandId === FALLBACK_BRAND && p.legacyId === 8)!;
  assert.equal(fallback.status, 'pending-review');

  // 新编号品牌内连续
  assert.deepEqual(
    data.scopedPairs.filter((p) => p.brandId === 'aurora').map((p) => p.uid),
    ['P-0001', 'P-0002', 'P-0003', 'P-0004'],
  );
});

test('站点回执：编号+别名对账，对不上停在待核', () => {
  const engine = new MigrationEngine(new MemoryStorage(), BRANDS, auditInput);
  engine.migrateAll(studio);
  const data = engine.snapshot();
  const find = (brandId: string, pairId: number, url?: string) =>
    data.receipts.find((r) => r.brandId === brandId && r.pairId === pairId && (!url || r.url === url));

  assert.equal(find('aurora', 1)!.status, 'matched');
  assert.ok(find('aurora', 1)!.uid);
  // 编号 2 别名回传成 studio-notes-v2
  const r2 = find('aurora', 2)!;
  assert.equal(r2.status, 'pending');
  assert.equal(r2.reason, 'alias-mismatch');
  // 编号不存在
  const r42 = find('lumen', 42)!;
  assert.equal(r42.status, 'pending');
  assert.equal(r42.reason, 'number-not-found');
  // 归属争议编号
  const r6 = find('northwind', 6)!;
  assert.equal(r6.status, 'pending');
  assert.equal(r6.reason, 'ownership-pending');

  // 有 pending 的品牌为 needs-review，干净品牌为 ready
  assert.equal(data.brandStates['lumen'].status, 'needs-review');
  assert.equal(data.brandStates['northwind'].status, 'needs-review');
  assert.equal(data.brandStates['aurora'].status, 'needs-review'); // 含争议 5 + 别名错 2
});

test('写入失败只重试未完成品牌，已迁好的品牌不重复改名', () => {
  // aurora 第一次写入失败一次
  const storage = new MemoryStorage(undefined, {aurora: 1});
  const engine = new MigrationEngine(storage, BRANDS, auditInput);
  const first = engine.migrateAll(studio);
  assert.equal(first.failed.length, 1);
  assert.equal(first.failed[0].brandId, 'aurora');
  const before = engine.snapshot();
  const northwindUids = before.scopedPairs.filter((p) => p.brandId === 'northwind').map((p) => p.uid);

  const retry = engine.retryPending(studio);
  assert.equal(retry.failed.length, 0);
  // 只有 aurora 被执行；其它品牌 skipped
  const touched = retry.results.filter((r) => !r.skipped).map((r) => r.brandId);
  assert.deepEqual(touched, ['aurora']);
  assert.ok(retry.results.find((r) => r.brandId === 'northwind')!.skipped);

  const after = engine.snapshot();
  // 已迁品牌 uid 不变、无重复副本
  assert.deepEqual(after.scopedPairs.filter((p) => p.brandId === 'northwind').map((p) => p.uid), northwindUids);
  for (const brandId of Object.keys(after.brandStates)) {
    const ids = after.scopedPairs.filter((p) => p.brandId === brandId).map((p) => p.legacyId!);
    assert.equal(ids.length, new Set(ids).size, `${brandId} 出现重复副本`);
  }
  // aurora 编号仍从 P-0001 连续，没有被重复改名
  assert.deepEqual(
    after.scopedPairs.filter((p) => p.brandId === 'aurora').map((p) => p.uid),
    ['P-0001', 'P-0002', 'P-0003', 'P-0004'],
  );
});

test('再次执行已完成品牌为幂等跳过', () => {
  const engine = new MigrationEngine(new MemoryStorage(), BRANDS, auditInput);
  engine.migrateAll(studio);
  const again = engine.runBrand(studio, 'lumen');
  assert.equal(again.skipped, true);
  const data = engine.snapshot();
  assert.equal(data.scopedPairs.filter((p) => p.brandId === 'lumen').length, 3); // 5,6,7
});

test('权限隔离：品牌管理员只能访问并确认本品牌', () => {
  const engine = new MigrationEngine(new MemoryStorage(), BRANDS, auditInput);
  engine.migrateAll(studio);

  assert.throws(() => engine.runBrand(yuki, 'lumen'), AccessDeniedError);
  assert.throws(() => engine.brandDashboard(yuki, 'northwind'), AccessDeniedError);
  assert.throws(() => engine.confirmBrand(yuki, 'lumen'), AccessDeniedError);

  // 品牌管理员不能触发全量迁移
  assert.throws(() => engine.migrateAll(sora), AccessDeniedError);
  // 兜底空间只有工作室能确认
  assert.throws(() => engine.confirmBrand(yuki, FALLBACK_BRAND), AccessDeniedError);

  // 本品牌管理员可以确认自己的品牌（即便有待核项，确认的是「迁移已落位」）
  const lumen = engine.confirmBrand(sora, 'lumen');
  assert.equal(lumen.status, 'confirmed');
  assert.equal(lumen.confirmedBy, 'u-sora');
  // 别品牌管理员确认不了 lumen
  assert.throws(() => engine.confirmBrand(marcus, 'lumen'), AccessDeniedError);
});

test('旧链接迁完仍可打开：编号回查、品牌提示与歧义', () => {
  const engine = new MigrationEngine(new MemoryStorage(), BRANDS, auditInput);
  engine.migrateAll(studio);

  // 单品牌编号直接解析
  const r1 = engine.resolveLegacyLink(yuki, 1)!;
  assert.equal(r1.kind, 'resolved');
  if (r1.kind === 'resolved') {
    assert.equal(r1.pair.brandId, 'aurora');
    assert.equal(r1.pair.legacyId, 1);
    assert.equal(r1.pair.uid, 'P-0001');
  }

  // 歧义编号：工作室看到两个落点，给品牌提示后落到原品牌
  const amb = engine.resolveLegacyLink(studio, 5);
  assert.equal(amb.kind, 'ambiguous');
  const toAurora = engine.resolveLegacyLink(studio, 5, undefined, {brandId: 'aurora'});
  assert.equal(toAurora.kind, 'resolved');
  if (toAurora.kind === 'resolved') assert.equal(toAurora.pair.brandId, 'aurora');
  const toLumen = engine.resolveLegacyLink(studio, 5, undefined, {brandId: 'lumen'});
  if (toLumen.kind === 'resolved') assert.equal(toLumen.pair.brandId, 'lumen');

  // 旧链接别名也能解析
  const byAlias = engine.resolveLegacyLink(marcus, 3, 'field-guide');
  assert.equal(byAlias.kind, 'resolved');

  // 旧链接带错别名 → 不静默跳转
  const badAlias = engine.resolveLegacyLink(yuki, 1, 'editorial-calm-old');
  assert.equal(badAlias.kind, 'alias-mismatch');

  // 不存在的旧编号
  assert.equal(engine.resolveLegacyLink(studio, 404).kind, 'not-found');

  // 权限：aurora 管理员看不到 lumen 的歧义副本
  const scoped = engine.resolveLegacyLink(yuki, 5);
  if (scoped.kind === 'resolved') assert.equal(scoped.pair.brandId, 'aurora');
  else assert.notEqual(scoped.kind, 'ambiguous');
});

test('导出 CSS 同时保留新旧编号，且受品牌权限限制', () => {
  const engine = new MigrationEngine(new MemoryStorage(), BRANDS, auditInput);
  engine.migrateAll(studio);
  const aurora1 = engine.snapshot().scopedPairs.find((p) => p.brandId === 'aurora' && p.legacyId === 1)!;
  const out = engine.exportCss(yuki, aurora1.uid, 'aurora');
  assert.match(out.css, /uid: P-0001/);
  assert.match(out.css, /legacy pairing no\.: 1/);
  assert.match(out.css, /alias: editorial-calm/);

  // 跨品牌导出被拒
  assert.throws(() => engine.exportCss(yuki, 'P-0001', 'lumen'), AccessDeniedError);
  // 导出名带品牌与新编号
  assert.equal(out.fileName, 'aurora-P-0001.css');
});
