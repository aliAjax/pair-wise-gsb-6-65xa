// 迁移控制台：把迁移引擎接到浏览器（localStorage 持久化）。
// 工作室超管执行 / 重试迁移、查看双方旧值与孤儿单据；
// 品牌管理员只看得到并只能确认本品牌。
import {useMemo, useState} from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Database,
  Download,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  Play,
  RotateCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {MigrationEngine} from './engine';
import type {StoragePort, MigrationData} from './storage';
import {LocalStorageStorage} from './storage';
import {BRANDS, IDENTITIES, LEGACY_CLAIMS, LEGACY_PAIRS, SITE_RECEIPTS} from './seed';
import type {BrandId, BrandMigrationState, Identity} from './types';
import './migration.css';

const auditInput = {pairs: LEGACY_PAIRS, claims: LEGACY_CLAIMS, receipts: SITE_RECEIPTS};

/** 浏览器持久化 + 可选的按品牌一次性写入故障（演示「失败只重试未完成品牌」） */
class DemoStorage implements StoragePort {
  private inner = new LocalStorageStorage();
  failRemaining: Record<string, number> = {};
  load(): MigrationData {
    return this.inner.load();
  }
  save(data: MigrationData, writingBrands: BrandId[]): void {
    for (const brandId of writingBrands) {
      if ((this.failRemaining[brandId] ?? 0) > 0) {
        this.failRemaining[brandId]!--;
        throw new Error(`写入失败（演示存储故障 brand=${brandId}）`);
      }
    }
    this.inner.save(data, writingBrands);
  }
}

function makeEngine(): MigrationEngine {
  return new MigrationEngine(new DemoStorage(), BRANDS, auditInput);
}

const STATUS_TEXT: Record<BrandMigrationState['status'], string> = {
  pending: '待迁移',
  'in-progress': '进行中',
  'needs-review': '待核',
  ready: '待确认',
  confirmed: '已确认',
};

const SOURCE_TEXT: Record<string, string> = {
  favorite: '收藏',
  review: '评审单',
  css: '已导出 CSS',
  publish: '发布快照',
};

const RECEIPT_REASON_TEXT: Record<string, string> = {
  'number-not-found': '回执编号在库中不存在',
  'alias-mismatch': '编号与别名对不上',
  'ownership-pending': '归属有争议，先停在待核',
  'unknown-brand': '回执品牌不存在',
};

export function MigrationConsole({onExit}: {onExit: () => void}) {
  const [identityKey, setIdentityKey] = useState<'studio' | 'u-yuki' | 'u-marcus' | 'u-sora'>('studio');
  const identity: Identity = IDENTITIES[identityKey];
  const engine = useMemo(makeEngine, []);
  const audit = useMemo(() => engine.report, [engine]);
  const [data, setData] = useState(() => engine.snapshot());
  const [failed, setFailed] = useState<Array<{brandId: BrandId; error: string}>>([]);
  const [simulateFail, setSimulateFail] = useState<BrandId | ''>('');
  const [linkInput, setLinkInput] = useState({id: '5', alias: '', brand: ''});
  const [linkResult, setLinkResult] = useState<string>('');
  const [flash, setFlash] = useState('');

  const refresh = () => setData(engine.snapshot());
  const isStudio = identity.role === 'studio';

  const runAll = () => {
    // 演示「写入失败后只重试未完成品牌」：勾选品牌的下一次保存直接报错，之后恢复
    if (simulateFail && isStudio) (engine.storage as DemoStorage).failRemaining[simulateFail] = 1;
    const summary = engine.migrateAll(identity);
    setFailed(summary.failed);
    refresh();
  };

  const retry = () => {
    const summary = engine.retryPending(identity);
    setFailed(summary.failed);
    refresh();
    setFlash(`重试完成：执行 ${summary.results.filter((r) => !r.skipped).length} 个品牌，跳过已完成 ${summary.results.filter((r) => r.skipped).length} 个`);
    setTimeout(() => setFlash(''), 4000);
  };

  const confirm = (brandId: BrandId) => {
    engine.confirmBrand(identity, brandId);
    refresh();
  };

  const tryLink = () => {
    const id = Number(linkInput.id);
    if (!Number.isFinite(id)) {
      setLinkResult('请输入旧编号');
      return;
    }
    const result = engine.resolveLegacyLink(identity, id, linkInput.alias || undefined, linkInput.brand ? {brandId: linkInput.brand} : undefined);
    if (result.kind === 'resolved') {
      setLinkResult(`✓ 打开 ${result.pair.brandId} / ${result.pair.uid}（旧编号 ${result.pair.legacyId} · ${result.pair.alias ?? '无别名'}）`);
    } else if (result.kind === 'ambiguous') {
      setLinkResult(`该旧编号在多个品牌并存：${result.options.map((p) => `${p.brandId}:${p.uid}`).join('，')}。请带品牌参数打开。`);
    } else if (result.kind === 'alias-mismatch') {
      setLinkResult(`⚠ 编号 ${id} 的别名应为 ${result.expected.alias}，你提供的是「${result.suppliedAlias}」，已拦下。`);
    } else {
      setLinkResult(`✗ 旧编号 ${id} 找不到落点（或你无权访问对应品牌）`);
    }
  };

  const exportOne = (uid: string, brandId: BrandId) => {
    const {css, fileName} = engine.exportCss(identity, uid, brandId);
    const blob = new Blob([css], {type: 'text/css'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
    refresh();
  };

  // 可见品牌：工作室全部；品牌管理员仅本品牌
  const visibleBrandIds = isStudio
    ? [...new Set<string>([...Object.keys(audit.brandPairIds), ...BRANDS.map((b) => b.id)])]
    : identity.brands ?? [];
  const brandName = (id: BrandId) => BRANDS.find((b) => b.id === id)?.name ?? (id === '__studio__' ? '工作室兜底空间' : id);

  return (
    <div className="mc">
      <header className="mc-topbar">
        <div className="mc-title">
          <Database size={18} />
          <div>
            <b>配对库品牌隔离迁移</b>
            <small>旧全局编号 → 品牌空间 (brand, uid)，旧链接与旧编号长期保留</small>
          </div>
        </div>
        <div className="mc-top-actions">
          <label className="mc-user">
            <Users size={14} />
            <select value={identityKey} onChange={(e) => setIdentityKey(e.target.value as typeof identityKey)}>
              <option value="studio">{IDENTITIES.studio.name}（工作室超管）</option>
              <option value="u-yuki">Yuki Lin（Aurora 管理员）</option>
              <option value="u-marcus">Marcus Reed（Northwind 管理员）</option>
              <option value="u-sora">Sora Aoki（Lumen 管理员）</option>
            </select>
          </label>
          <button className="mc-btn ghost" onClick={onExit}>返回配对工具</button>
        </div>
      </header>

      {flash && <div className="mc-flash"><CheckCircle2 size={15} />{flash}</div>}

      <main className="mc-main">
        {/* 第一步：迁移前核对 */}
        <section className="mc-card">
          <h2><span className="mc-step">1</span>迁移前核对：收藏 / 评审 / CSS 导出 / 发布快照的归属</h2>
          <table className="mc-table">
            <thead>
              <tr><th>旧编号</th><th>配对</th><th>指向品牌</th><th>核对结论</th></tr>
            </thead>
            <tbody>
              {audit.pairs.map((p) => {
                const conflict = p.issues.includes('ownership-conflict');
                const unclaimed = p.issues.includes('unclaimed');
                return (
                  <tr key={p.pairId} className={conflict ? 'row-warn' : unclaimed ? 'row-dim' : ''}>
                    <td className="mono">#{p.pairId}{p.legacy.alias ? <><br /><small>{p.legacy.alias}</small></> : null}</td>
                    <td>{p.legacy.title}</td>
                    <td>
                      {p.sides.length === 0 && <em className="mc-muted">无单据认领</em>}
                      {p.sides.map((s) => (
                        <div key={s.brandId} className="mc-side">
                          <b>{brandName(s.brandId)}</b>
                          <span>{s.sources.map((x) => SOURCE_TEXT[x]).join('、') || '仅配对行'} · 旧值「{s.label ?? '—'}」别名 {s.alias ?? '—'}</span>
                          <small>{s.refs.join('；')}</small>
                        </div>
                      ))}
                    </td>
                    <td>
                      {conflict && <span className="tag warn"><AlertTriangle size={13} />双方旧值冲突，双方各落一份待核副本</span>}
                      {unclaimed && <span className="tag dim">未认领，进兜底空间待核</span>}
                      {!conflict && !unclaimed && <span className="tag ok"><CheckCircle2 size={13} />归属明确：{brandName(p.ownerBrandId!)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {audit.orphans.length > 0 && (
            <div className="mc-orphans">
              <AlertTriangle size={14} /> 孤儿单据（编号在配对库中不存在，不阻塞其它品牌）：
              {audit.orphans.map((o, i) => (
                <span key={i} className="tag dim">{o.kind === 'claim' ? '单据' : '回执'} #{o.pairId} · {o.brandId ?? '无品牌'} · {o.ref}</span>
              ))}
            </div>
          )}
        </section>

        {/* 第二步：执行 / 重试 */}
        <section className="mc-card">
          <h2><span className="mc-step">2</span>执行迁移（按品牌隔离写入，失败只重试未完成品牌）</h2>
          {!isStudio ? (
            <div className="mc-notice"><Lock size={15} />只有工作室超管可以执行迁移；你当前只能查看并确认本品牌。</div>
          ) : (
            <div className="mc-runbar">
              <button className="mc-btn primary" onClick={runAll}><Play size={15} />全量迁移（逐品牌提交）</button>
              <button className="mc-btn" onClick={retry}><RotateCw size={15} />只重试未完成品牌</button>
              <label className="mc-fail">
                模拟某品牌首次写入失败：
                <select value={simulateFail} onChange={(e) => setSimulateFail(e.target.value as BrandId | '')}>
                  <option value="">不模拟</option>
                  {BRANDS.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            </div>
          )}
          {failed.length > 0 && (
            <div className="mc-failed">
              {failed.map((f) => <span key={f.brandId} className="tag warn"><Loader2 size={13} />{brandName(f.brandId)}：{f.error} —— 已迁好的品牌不受影响，点「只重试未完成品牌」续跑</span>)}
            </div>
          )}
          <div className="mc-brand-grid">
            {visibleBrandIds.map((brandId) => {
              const state: BrandMigrationState | undefined = data.brandStates[brandId];
              const pairs = data.scopedPairs.filter((p) => p.brandId === brandId);
              const receipts = data.receipts.filter((r) => r.brandId === brandId);
              const canConfirm = engine.canConfirm(identity, brandId);
              return (
                <div key={brandId} className="mc-brand">
                  <header>
                    <b>{brandName(brandId)}</b>
                    <span className={`tag ${state?.status === 'confirmed' ? 'ok' : state?.status === 'needs-review' ? 'warn' : ''}`}>
                      {state ? STATUS_TEXT[state.status] : '待迁移'}
                    </span>
                  </header>
                  <small>
                    副本 {pairs.length} 个 · 待核 {pairs.filter((p) => p.status === 'pending-review').length} 个 ·
                    回执 {receipts.filter((r) => r.status === 'matched').length}/{receipts.length} 对上
                  </small>
                  {state?.pendingPairIds.length ? (
                    <div className="mc-pending">争议/待核旧编号：{state.pendingPairIds.map((n) => `#${n}`).join('、')}</div>
                  ) : null}
                  {canConfirm && state && state.status !== 'confirmed' && (state.status === 'ready' || state.status === 'needs-review') && (
                    <button className="mc-btn small" onClick={() => confirm(brandId)}><ShieldCheck size={14} />品牌管理员确认迁移</button>
                  )}
                  {state?.status === 'confirmed' && <div className="mc-confirmed"><CheckCircle2 size={13} />已由 {state.confirmedBy} 确认</div>}
                </div>
              );
            })}
          </div>
        </section>

        {/* 第三步：回执对账 */}
        <section className="mc-card">
          <h2><span className="mc-step">3</span>站点回执对账（编号 + 别名，任一不符停在待核）</h2>
          <table className="mc-table">
            <thead><tr><th>品牌</th><th>回执编号</th><th>回执别名</th><th>结果</th></tr></thead>
            <tbody>
              {data.receipts
                .filter((r) => visibleBrandIds.includes(r.brandId))
                .map((r, i) => (
                  <tr key={i} className={r.status === 'pending' ? 'row-warn' : ''}>
                    <td>{brandName(r.brandId)}</td>
                    <td className="mono">#{r.pairId}</td>
                    <td className="mono">{r.alias ?? '—'}</td>
                    <td>
                      {r.status === 'matched'
                        ? <span className="tag ok"><CheckCircle2 size={13} />对上，落点 {r.uid}</span>
                        : <span className="tag warn"><AlertTriangle size={13} />待核：{RECEIPT_REASON_TEXT[r.reason ?? 'unknown-brand'] ?? r.reason}</span>}
                    </td>
                  </tr>
                ))}
              {data.receipts.length === 0 && <tr><td colSpan={4} className="mc-muted">尚未执行迁移</td></tr>}
            </tbody>
          </table>
        </section>

        {/* 第四步：旧链接 */}
        <section className="mc-card">
          <h2><span className="mc-step">4</span>旧链接回查（迁完后旧编号链接仍可打开）</h2>
          <div className="mc-linkbar">
            <Link2 size={15} />
            <input value={linkInput.id} onChange={(e) => setLinkInput({...linkInput, id: e.target.value})} placeholder="旧编号，如 5" />
            <input value={linkInput.alias} onChange={(e) => setLinkInput({...linkInput, alias: e.target.value})} placeholder="别名（可选）" />
            <select value={linkInput.brand} onChange={(e) => setLinkInput({...linkInput, brand: e.target.value})}>
              <option value="">品牌：自动</option>
              {visibleBrandIds.map((b) => <option key={b} value={b}>{brandName(b)}</option>)}
            </select>
            <button className="mc-btn" onClick={tryLink}><KeyRound size={14} />解析旧链接</button>
          </div>
          {linkResult && <div className="mc-link-result">{linkResult}</div>}
        </section>

        {/* 第五步：品牌空间数据 + 双编号导出 */}
        <section className="mc-card">
          <h2><span className="mc-step">5</span>品牌隔离空间与导出（导出同时保留新旧编号）</h2>
          {visibleBrandIds.map((brandId) => {
            const pairs = data.scopedPairs.filter((p) => p.brandId === brandId);
            if (pairs.length === 0) return null;
            return (
              <div key={brandId} className="mc-scope">
                <h3>{brandName(brandId)} <ChevronRight size={13} /> {pairs.length} 个配对</h3>
                <table className="mc-table tight">
                  <tbody>
                    {pairs.map((p) => (
                      <tr key={p.uid}>
                        <td className="mono"><b>{p.uid}</b></td>
                        <td className="mono mc-muted">旧 #{p.legacyId}</td>
                        <td>{p.title}</td>
                        <td>{p.status === 'active' ? <span className="tag ok">生效</span> : <span className="tag warn">待核 · {p.pendingReason}</span>}</td>
                        <td><button className="mc-btn small" onClick={() => exportOne(p.uid, brandId)}><Download size={13} />导出 CSS</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </section>
      </main>
    </div>
  );
}
