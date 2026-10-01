import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Copy,
  Download,
  GitBranch,
  Link2,
  Lock,
  RefreshCw,
  Scale,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { LocalStorageKV } from './migration/storage';
import { WorkspaceController } from './migration/controller';
import { BRANDS, buildDemoLegacy } from './migration/demo';
import { buildDualIdCss, loadBrandSpace, resolveLink } from './migration/links';
import { canConfirmBrand, canResolveConflict, type Actor } from './migration/permissions';
import { type MigrationResult } from './migration/migrate';
import type {
  AuditReport,
  ConflictDecision,
  PairAttribution,
  StoredPair,
} from './migration/types';

const kv = new LocalStorageKV();
const ctl = new WorkspaceController(kv);

const ACTORS: Actor[] = [
  { id: 'u-admin', name: '工作室管理员', role: 'studio-admin' },
  { id: 'u-aur', name: 'Aurora 品牌管理员', role: 'brand-admin', brand: 'aurora' },
  { id: 'u-nor', name: 'Northwind 品牌管理员', role: 'brand-admin', brand: 'northwind' },
  { id: 'u-lum', name: 'Lumen 品牌管理员', role: 'brand-admin', brand: 'lumen' },
];

const brandName = (b: string) => BRANDS.find((x) => x.id === b)?.name ?? b;
const brandColor = (b: string) => BRANDS.find((x) => x.id === b)?.color ?? '#ccc';

const VERDICT_META: Record<PairAttribution['verdict'], { label: string; cls: string }> = {
  migratable: { label: '可迁移', cls: 'ok' },
  conflict: { label: '品牌冲突·待裁决', cls: 'warn' },
  'receipt-blocked': { label: '回执待核', cls: 'err' },
  unclaimed: { label: '无归属·待核', cls: 'warn' },
  'resolved-assign': { label: '已裁决归一方', cls: 'ok' },
  'resolved-fork': { label: '已裁决双方并存', cls: 'ok' },
};

type Tab = 'audit' | 'decide' | 'run' | 'confirm' | 'space' | 'links';

export default function MigrationConsole() {
  const [actorId, setActorId] = useState(ACTORS[0].id);
  const actor = ACTORS.find((a) => a.id === actorId)!;
  const [tab, setTab] = useState<Tab>('audit');
  const [installed, setInstalled] = useState(ctl.hasLegacy());
  const [decisions, setDecisions] = useState<Record<number, ConflictDecision>>({});
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [linkInput, setLinkInput] = useState('pair-3');
  const [spaceBrand, setSpaceBrand] = useState<string>('aurora');
  const [version, setVersion] = useState(0);

  /** kv 被操作改变（补正回执、确认）后调用，强制审计/空间等读取重算 */
  const refresh = () => setVersion((v) => v + 1);

  const audit: AuditReport | null = useMemo(
    () => (installed ? ctl.audit() : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [installed, result, version],
  );
  const meta = ctl.meta();

  const install = () => {
    ctl.installLegacy(buildDemoLegacy());
    setInstalled(true);
    setMsg('已写入旧时代全局数据：type-pairs / 收藏 / 评审 / 导出快照 / 站点回执');
    setTab('audit');
  };

  const fixReceipt4 = () => {
    ctl.upsertReceipt({
      receiptId: 'rcp-4-bad',
      pairId: 4,
      alias: 'pair-4',
      site: 'lumen-deploy',
      receivedAt: '2026-10-01T09:00:00Z',
    });
    setMsg('站点补正：回执 rcp-4-bad 的别名已由 pair-404 改为 pair-4（编号+别名重新对账）');
    refresh();
  };

  const decide = (pairId: number, d: ConflictDecision) => {
    if (!canResolveConflict(actor).ok) {
      setMsg(canResolveConflict(actor).reason!);
      return;
    }
    setDecisions((prev) => ({ ...prev, [pairId]: d }));
  };

  const run = async (opts?: { failBrand?: string }) => {
    setBusy(true);
    const r = await ctl.runMigration(actor, decisions, {
      failBrands: opts?.failBrand ? [opts.failBrand] : undefined,
    });
    setResult(r);
    setBusy(false);
    setMsg(null);
  };

  const confirm = (brand: string) => {
    const out = ctl.confirm(actor, brand);
    setMsg(out.ok ? `${brandName(brand)}：本品牌迁移已由 ${actor.name} 确认` : out.reason!);
    refresh();
  };

  const exportCss = (pair: StoredPair) => {
    const css = buildDualIdCss(pair);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([css], { type: 'text/css' }));
    a.download = `brand-${pair.uid.replace(':', '-')}.css`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const linkResolution = linkInput
    ? resolveLink(actor, linkInput, kv)
    : null;

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'audit', label: '1 迁移前核对', icon: <Scale size={14} /> },
    { id: 'decide', label: '2 冲突裁决', icon: <GitBranch size={14} /> },
    { id: 'run', label: '3 执行/重试', icon: <RefreshCw size={14} /> },
    { id: 'confirm', label: '4 品牌确认', icon: <BadgeCheck size={14} /> },
    { id: 'space', label: '品牌空间', icon: <ShieldCheck size={14} /> },
    { id: 'links', label: '旧链接/导出', icon: <Link2 size={14} /> },
  ];

  return (
    <div className="mc">
      <header className="mc-top">
        <div>
          <h1>配对库 · 品牌隔离迁移控制台</h1>
          <p>全局配对编号 → 品牌空间；同一编号可跨品牌并存；旧链接永久可开</p>
        </div>
        <div className="mc-actor">
          <ShieldCheck size={15} />
          <select value={actorId} onChange={(e) => setActorId(e.target.value)}>
            {ACTORS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.brand ? `（${a.brand}）` : ''}
              </option>
            ))}
          </select>
        </div>
      </header>

      {!installed ? (
        <div className="mc-welcome">
          <h2>尚未检测到旧数据</h2>
          <p>
            将写入一套混有真实脏数据的旧全局库：编号 3 同时被 Aurora 与 Lumen 登记/收藏/评审/导出；
            编号 4 的站点回执把别名抄成 <code>pair-404</code>；编号 5 无任何品牌归属；回执
            <code>rcp-x</code> 指向不存在的 99 号。
          </p>
          <button className="mc-btn primary" onClick={install}>
            载入旧时代全局数据并开始核对
          </button>
        </div>
      ) : (
        <>
          <nav className="mc-tabs">
            {tabs.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? 'on' : ''}
                onClick={() => setTab(t.id)}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </nav>

          {msg && <div className="mc-msg">{msg}</div>}

          {tab === 'audit' && audit && <AuditTab audit={audit} onFix={fixReceipt4} />}

          {tab === 'decide' && audit && (
            <DecideTab audit={audit} decisions={decisions} onDecide={decide} actor={actor} />
          )}

          {tab === 'run' && (
            <RunTab
              audit={audit!}
              decisions={decisions}
              result={result}
              meta={meta}
              busy={busy}
              onRun={run}
              actor={actor}
            />
          )}

          {tab === 'confirm' && (
            <ConfirmTab meta={meta} actor={actor} onConfirm={confirm} result={result} />
          )}

          {tab === 'space' && (
            <SpaceTab
              actor={actor}
              brand={spaceBrand}
              onBrand={setSpaceBrand}
              onExport={exportCss}
            />
          )}

          {tab === 'links' && (
            <LinksTab
              value={linkInput}
              onChange={setLinkInput}
              resolution={linkResolution}
            />
          )}
        </>
      )}
    </div>
  );
}

/* ---------------- 1. 核对 ---------------- */

function AuditTab({ audit, onFix }: { audit: AuditReport; onFix: () => void }) {
  const rows = Object.values(audit.pairs).sort((a, b) => a.pairId - b.pairId);
  return (
    <div className="mc-panel">
      <div className="mc-panel-head">
        <h2>迁移前核对：收藏 / 评审单 / 发布快照归属 + 站点回执对账</h2>
        <span>待核编号 {audit.pendingPairIds.length} 个</span>
      </div>
      <div className="mc-cards">
        {rows.map((a) => (
          <div key={a.pairId} className={`mc-card ${VERDICT_META[a.verdict].cls}`}>
            <div className="mc-card-top">
              <b>旧编号 #{a.pairId}</b>
              <span className="mc-tag">{VERDICT_META[a.verdict].label}</span>
            </div>
            <p className="mc-reason">{a.reason}</p>

            {a.conflictSides.length > 0 && (
              <div className="mc-sides">
                {a.conflictSides.map((s) => (
                  <div key={s.brand} className="mc-side">
                    <div className="mc-side-head">
                      <i style={{ background: brandColor(s.brand) }} />
                      {brandName(s.brand)}（{s.brand}）
                    </div>
                    <div className="mc-oldvals">
                      <div>旧全局编号：<code>#{s.oldGlobalId}</code></div>
                      <div>旧别名：<code>{s.oldAlias}</code></div>
                      {s.claims.map((c) => (
                        <div key={c.kind + c.ref} className="mc-claim">
                          <span className="mc-kind">{kindLabel(c.kind)}</span>
                          {c.oldValue}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {a.receipts.length > 0 && (
              <ul className="mc-receipts">
                {a.receipts.map((r) => (
                  <li key={r.receiptId} className={r.status}>
                    {r.status === 'match' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                    {r.detail}
                  </li>
                ))}
              </ul>
            )}

            {a.verdict === 'receipt-blocked' && a.pairId === 4 && (
              <button className="mc-btn small" onClick={onFix}>
                模拟站点补正回执（pair-404 → pair-4）
              </button>
            )}
          </div>
        ))}
      </div>

      {audit.orphanReceipts.length > 0 && (
        <div className="mc-orphans">
          <h3><XCircle size={14} /> 孤儿回执（指向不存在的编号）</h3>
          {audit.orphanReceipts.map((r) => (
            <div key={r.receiptId} className="mc-claim err">{r.detail}</div>
          ))}
        </div>
      )}
    </div>
  );
}

const kindLabel = (k: string) =>
  k === 'favorite' ? '收藏' : k === 'review' ? '评审单' : '发布快照';

/* ---------------- 2. 裁决 ---------------- */

function DecideTab({
  audit,
  decisions,
  onDecide,
  actor,
}: {
  audit: AuditReport;
  decisions: Record<number, ConflictDecision>;
  onDecide: (pairId: number, d: ConflictDecision) => void;
  actor: Actor;
}) {
  const conflicts = Object.values(audit.pairs).filter((a) => a.verdict === 'conflict');
  const can = canResolveConflict(actor).ok;
  return (
    <div className="mc-panel">
      <div className="mc-panel-head">
        <h2>同一编号指向多个品牌：列出双方旧值后裁决</h2>
        <span>{conflicts.length} 个待裁决</span>
      </div>
      {!can && (
        <div className="mc-lock">
          <Lock size={14} /> {canResolveConflict(actor).reason}
        </div>
      )}
      {conflicts.map((a) => {
        const d = decisions[a.pairId];
        return (
          <div key={a.pairId} className="mc-card warn">
            <div className="mc-card-top">
              <b>旧编号 #{a.pairId} · 冲突方 {a.brands.map(brandName).join(' / ')}</b>
              {d && <span className="mc-tag ok">已选：{d.kind === 'fork' ? '双方并存' : `归 ${brandName(d.brand)}`}</span>}
            </div>
            <div className="mc-decide-row">
              {a.brands.map((b) => (
                <button
                  key={b}
                  className="mc-btn"
                  disabled={!can}
                  onClick={() => onDecide(a.pairId, { kind: 'assign', brand: b })}
                >
                  归 {brandName(b)}（旧裸别名 pair-{a.pairId} 落此方）
                </button>
              ))}
              <button
                className="mc-btn"
                disabled={!can}
                onClick={() => onDecide(a.pairId, { kind: 'fork' })}
              >
                <GitBranch size={13} /> 双方并存（裸别名消歧，他方用 brand:*:pair-N）
              </button>
            </div>
          </div>
        );
      })}
      {conflicts.length === 0 && <p className="mc-empty">没有待裁决冲突（可能已全部裁决或编号仍被回执挡住）。</p>}
    </div>
  );
}

/* ---------------- 3. 执行 ---------------- */

function RunTab({
  audit,
  decisions,
  result,
  meta,
  busy,
  onRun,
  actor,
}: {
  audit: AuditReport;
  decisions: Record<number, ConflictDecision>;
  result: MigrationResult | null;
  meta: ReturnType<WorkspaceController['meta']>;
  busy: boolean;
  onRun: (opts?: { failBrand?: string }) => void;
  actor: Actor;
}) {
  const pending = audit.pendingPairIds.filter(
    (id) => audit.pairs[id].verdict !== 'conflict' || !decisions[id],
  );
  const planned = Object.values(audit.pairs).filter(
    (a) => a.verdict === 'migratable' || (a.verdict === 'conflict' && decisions[a.pairId]),
  );

  return (
    <div className="mc-panel">
      <div className="mc-panel-head">
        <h2>按品牌写入：失败只重试未完成品牌，已迁好的品牌不重复改名</h2>
      </div>

      <div className="mc-run-actions">
        <button className="mc-btn primary" disabled={busy} onClick={() => onRun()}>
          <RefreshCw size={13} /> {busy ? '写入中…' : '执行 / 重试迁移'}
        </button>
        <button
          className="mc-btn"
          disabled={busy || actor.role !== 'studio-admin'}
          title={actor.role !== 'studio-admin' ? '故障注入演示仅工作室管理员可用' : ''}
          onClick={() => onRun({ failBrand: 'lumen' })}
        >
          注入 Lumen 首次写入故障并重跑
        </button>
      </div>
      <p className="mc-hint">
        当前计划覆盖编号：{planned.map((p) => `#${p.pairId}`).join('、') || '（无）'}；
        仍停留待核：{pending.map((id) => `#${id}`).join('、') || '无'}。
      </p>

      {result && (
        <div className="mc-result">
          <div><CheckCircle2 size={14} /> 本次完成：{fmtBrands(result.completed) || '—'}</div>
          <div><RefreshCw size={14} /> 重试未完成：{fmtBrands(result.retried) || '—'}</div>
          <div><BadgeCheck size={14} /> 已迁好跳过：{fmtBrands(result.skippedMigrated) || '—'}</div>
          {result.failed.length > 0 && (
            <div className="err"><XCircle size={14} /> 失败：
              {result.failed.map((f) => `${brandName(f.brand)}（${f.error}）`).join('；')}
            </div>
          )}
          {result.forbidden.length > 0 && (
            <div className="warn"><Lock size={14} /> 权限拒绝：
              {result.forbidden.map((f) => `${brandName(f.brand)}：${f.reason}`).join('；')}
            </div>
          )}
        </div>
      )}

      {meta && (
        <table className="mc-table">
          <thead>
            <tr><th>品牌</th><th>状态</th><th>尝试</th><th>改名操作数</th><th>旧编号 → 新编号</th><th>错误</th></tr>
          </thead>
          <tbody>
            {Object.entries(meta.brands).map(([b, s]) => (
              <tr key={b}>
                <td><i className="mc-dot" style={{ background: brandColor(b) }} />{brandName(b)}</td>
                <td><span className={`mc-state ${s.state}`}>{s.state}</span></td>
                <td>{s.attempts}</td>
                <td>{s.records}</td>
                <td className="mc-map">
                  {Object.entries(s.pairMap).map(([oldId, m]) => (
                    <code key={oldId}>#{oldId}→#{m.localId}</code>
                  ))}
                </td>
                <td className="err-cell">{s.error}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!meta && <p className="mc-empty">尚未执行过迁移。</p>}
    </div>
  );
}

const fmtBrands = (bs: string[]) => bs.map(brandName).join('、');

/* ---------------- 4. 确认 ---------------- */

function ConfirmTab({
  meta,
  actor,
  onConfirm,
  result,
}: {
  meta: ReturnType<WorkspaceController['meta']>;
  actor: Actor;
  onConfirm: (brand: string) => void;
  result: MigrationResult | null;
}) {
  const brands = meta ? Object.entries(meta.brands) : [];
  return (
    <div className="mc-panel">
      <div className="mc-panel-head">
        <h2>品牌管理员只能确认本品牌迁移</h2>
        <span>当前身份：{actor.name}{actor.brand ? `（${actor.brand}）` : ''}</span>
      </div>
      {brands.length === 0 && <p className="mc-empty">还没有品牌执行迁移。</p>}
      <div className="mc-cards">
        {brands.map(([b, s]) => {
          const perm = canConfirmBrand(actor, b);
          return (
            <div key={b} className="mc-card">
              <div className="mc-card-top">
                <b><i className="mc-dot" style={{ background: brandColor(b) }} />{brandName(b)}</b>
                {s.confirmed ? (
                  <span className="mc-tag ok"><BadgeCheck size={12} /> 已确认 · {s.confirmedBy}</span>
                ) : (
                  <span className="mc-tag">未确认</span>
                )}
              </div>
              <p className="mc-reason">迁移状态：{s.state}；{s.confirmedAt ? `确认于 ${s.confirmedAt}` : '等待本品牌管理员确认'}</p>
              <button
                className="mc-btn small"
                disabled={s.state !== 'migrated' || s.confirmed || !perm.ok}
                onClick={() => onConfirm(b)}
              >
                {perm.ok ? '确认本品牌迁移' : <><Lock size={12} /> 非本品牌管理员</>}
              </button>
            </div>
          );
        })}
      </div>
      {result?.forbidden.length ? (
        <p className="mc-hint warn">上一轮执行中有品牌被权限隔离拒绝，品牌管理员只能看到/操作本品牌。</p>
      ) : null}
    </div>
  );
}

/* ---------------- 品牌空间 ---------------- */

function SpaceTab({
  actor,
  brand,
  onBrand,
  onExport,
}: {
  actor: Actor;
  brand: string;
  onBrand: (b: string) => void;
  onExport: (p: StoredPair) => void;
}) {
  const space = loadBrandSpace(actor, brand, kv);
  return (
    <div className="mc-panel">
      <div className="mc-panel-head">
        <h2>品牌隔离空间（跨品牌读取被拒绝）</h2>
        <select value={brand} onChange={(e) => onBrand(e.target.value)}>
          {BRANDS.map((b) => (
            <option key={b.id} value={b.id}>{b.name}（{b.id}）</option>
          ))}
        </select>
      </div>
      {'forbidden' in space ? (
        <div className="mc-lock"><Lock size={14} /> {space.forbidden}</div>
      ) : (
        <>
          <div className="mc-space-counts">
            配对 {space.pairs.length} · 收藏 {space.favorites.length} · 评审 {space.reviews.length} · 导出快照 {space.exports.length}
          </div>
          <table className="mc-table">
            <thead>
              <tr><th>新编号</th><th>旧全局编号</th><th>当前别名</th><th>旧别名</th><th>标题</th><th></th></tr>
            </thead>
            <tbody>
              {space.pairs.map((p) => (
                <tr key={p.uid}>
                  <td><b>#{p.localId}</b></td>
                  <td><code>#{p.legacyId}</code></td>
                  <td><code>{p.alias}</code></td>
                  <td className="dim">{p.legacyAlias}</td>
                  <td>{p.title}</td>
                  <td>
                    <button className="mc-btn small" onClick={() => onExport(p)}>
                      <Download size={12} /> 导出双编号 CSS
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {space.pairs.length === 0 && <p className="mc-empty">本品牌空间为空（未迁移或无权）。</p>}
        </>
      )}
    </div>
  );
}

/* ---------------- 旧链接 ---------------- */

function LinksTab({
  value,
  onChange,
  resolution,
}: {
  value: string;
  onChange: (v: string) => void;
  resolution: ReturnType<typeof resolveLink> | null;
}) {
  return (
    <div className="mc-panel">
      <div className="mc-panel-head">
        <h2>旧链接解析：迁完后旧链接仍可打开</h2>
      </div>
      <div className="mc-linkrow">
        <code>#/</code>
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="pair-3 / 1 / brand:lumen:pair-3 / brand/lumen/local-1" />
        <Copy size={14} onClick={() => navigator.clipboard?.writeText(value)} />
      </div>
      <div className="mc-linkpresets">
        {['pair-1', 'pair-2', 'pair-3', '1', 'brand:lumen:pair-3', 'brand/lumen/local-1', 'pair-404'].map((s) => (
          <button key={s} className="mc-btn small" onClick={() => onChange(s)}>{s}</button>
        ))}
      </div>
      {resolution && (
        <pre className={`mc-resolution ${resolution.outcome}`}>
          {resolution.outcome === 'resolved' &&
            `✅ 落到原品牌 ${resolution.brand}：新编号 #${resolution.localId}（uid ${resolution.uid}），旧编号 #${resolution.legacyId ?? '-'}；解析路径 ${resolution.via}`}
          {resolution.outcome === 'disambiguation' &&
            `↔ 旧编号 #${resolution.legacyId} 在多个品牌并存，请选择：\n` +
            resolution.candidates.map((c) => `   · ${brandName(c.brand)} → #${c.localId}（uid ${c.uid}）`).join('\n')}
          {resolution.outcome === 'forbidden' &&
            `🔒 链接指向品牌 ${resolution.brand} 的 #${resolution.localId}，当前身份无权访问（品牌间数据隔离）`}
          {resolution.outcome === 'not-found' &&
            `❓ 找不到引用 ${resolution.ref}`}
        </pre>
      )}
      <p className="mc-hint">
        品牌管理员打开并存编号的旧裸链接时只看到本品牌候选，单候选直接落地；工作室管理员看到全部并存方。
      </p>
    </div>
  );
}
