import { useCallback, useEffect, useState } from 'react';
import { Bot, CheckCircle2, ExternalLink, ShieldAlert, ShieldCheck, Clock, Gavel, RefreshCw } from 'lucide-react';

const AGENT_URL = (import.meta.env.VITE_AGENT_URL as string | undefined) ?? 'http://localhost:8787';
const EXPLORER = (import.meta.env.VITE_AGENT_EXPLORER as string | undefined) ?? 'https://explorer.testnet.arc.io';

interface Finding { check: string; severity: 'ok' | 'warn' | 'fail'; detail: string }
interface Decision { seq: number; ts: number; shipmentId?: number; action: string; amountUSDC?: number; rationale: string; findings?: Finding[]; planner: string; txHash?: string; hash: string }
interface Approval { id: string; shipmentId: number; action: 'confirm' | 'dispute'; amountUSDC: number; reasons: string[]; draftDisputeReason?: string; agentRecommendation: string; status: string; createdAt: number }
interface Status {
  escrow: string; planner: string; lastTick: { at: number; scanned: number; acted: number } | null; ledger: { ok: boolean; brokenAt?: number };
  metrics: { decisions: number; autoConfirmed: number; disputed: number; escalated: number; autoReleased: number; settledUSDC: number; autonomyRate: number; humanAgreedWithEscalation: number; humanOverrode: number };
  wallets: { label: string; role: string; address: string; provider: string }[];
  policy: Record<string, number | boolean | string[]>;
}

const ACTION_STYLE: Record<string, { label: string; cls: string }> = {
  confirm: { label: 'Released', cls: 'bg-[var(--success-soft)] text-[var(--success)]' },
  auto_release: { label: 'Auto-release', cls: 'bg-[var(--success-soft)] text-[var(--success)]' },
  approved: { label: 'Approved', cls: 'bg-[var(--success-soft)] text-[var(--success)]' },
  dispute: { label: 'Disputed', cls: 'bg-[var(--danger-soft)] text-[var(--danger)]' },
  rejected: { label: 'Rejected', cls: 'bg-[var(--danger-soft)] text-[var(--danger)]' },
  request_approval: { label: 'Escalated', cls: 'bg-[var(--warning-soft)] text-[var(--warning)]' },
  hold: { label: 'On hold', cls: 'bg-[var(--surface-muted)] text-[var(--muted)]' },
  observe: { label: 'Note', cls: 'bg-[var(--surface-muted)] text-[var(--muted)]' },
  error: { label: 'Error', cls: 'bg-[var(--danger-soft)] text-[var(--danger)]' },
};

const POLICY_LABELS: [string, string, 'usdc' | 'hours' | 'count' | 'bool' | 'pct'][] = [
  ['autoConfirmMaxUSDC', 'Auto-confirm limit per shipment', 'usdc'],
  ['dailyAutoConfirmCapUSDC', 'Rolling 24h auto-confirm cap', 'usdc'],
  ['newCarrierMaxUSDC', 'Limit for new carriers', 'usdc'],
  ['newCarrierMinCompleted', 'Jobs before a carrier is "known"', 'count'],
  ['maxLateHours', 'Late delivery sent to a human after', 'hours'],
  ['amountTolerance', 'Allowed over-billing', 'pct'],
  ['autoDispute', 'Agent opens disputes on hard failures', 'bool'],
  ['triggerAutoRelease', 'Collect payouts after the 48h window', 'bool'],
];

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const time = (ts: number) => new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function SettlementAgentView() {
  const [status, setStatus] = useState<Status | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(() => localStorage.getItem('hw-agent-token') ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, d, a] = await Promise.all(['status', 'decisions?limit=100', 'approvals'].map(p => fetch(`${AGENT_URL}/api/${p}`).then(r => r.json())));
      setStatus(s); setDecisions(d); setApprovals(a); setError(null);
    } catch { setError(`Agent service not reachable at ${AGENT_URL}`); }
  }, []);
  useEffect(() => { void load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, [load]);

  async function resolve(id: string, decision: 'approve' | 'reject') {
    setBusy(id);
    localStorage.setItem('hw-agent-token', token);
    const r = await fetch(`${AGENT_URL}/api/approvals/${id}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ decision, by: 'finance' }) });
    if (!r.ok) setError((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
    setBusy(null); void load();
  }

  if (error && !status)
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
        <div className="flex items-center gap-2 font-500 text-[var(--ink)] mb-1"><Bot size={16} /> Settlement agent offline</div>
        {error}. Run <span className="mono">cd agent && npm start</span> and set <span className="mono">VITE_AGENT_URL</span>.
      </div>
    );
  if (!status) return <div className="text-sm text-[var(--muted)]">Loading agent…</div>;

  const pending = approvals.filter(a => a.status === 'pending');
  const m = status.metrics;
  const stats = [
    ['Settled by agent', `${m.settledUSDC.toFixed(2)} USDC`], ['Decisions', String(m.decisions)],
    ['Released without a human', String(m.autoConfirmed + m.autoReleased)], ['Disputes opened', String(m.disputed)],
    ['Escalated to finance', String(m.escalated)], ['Decided autonomously', `${Math.round(m.autonomyRate * 100)}%`],
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[15px] font-600 text-[var(--ink)]"><Bot size={18} /> Haulwise Settlement Agent</div>
            <p className="text-sm text-[var(--muted)] mt-1 max-w-2xl">
              Matches each carrier invoice and proof of delivery against the escrowed terms, releases payment when they agree,
              disputes when they don't, and hands anything outside policy to finance.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-md border border-[var(--border)] px-2 py-1 mono">planner: {status.planner}</span>
            <span className={`rounded-md px-2 py-1 inline-flex items-center gap-1 ${status.ledger.ok ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--danger-soft)] text-[var(--danger)]'}`}>
              {status.ledger.ok ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />} {status.ledger.ok ? 'Decision log intact' : `Log broken at #${status.ledger.brokenAt}`}
            </span>
            <a href={`${EXPLORER}/address/${status.escrow}`} target="_blank" rel="noopener noreferrer" className="rounded-md border border-[var(--border)] px-2 py-1 inline-flex items-center gap-1 hover:border-[var(--border-strong)]">
              Escrow {short(status.escrow)} <ExternalLink size={11} />
            </a>
            <button onClick={() => void load()} className="rounded-md border border-[var(--border)] px-2 py-1 inline-flex items-center gap-1 hover:border-[var(--border-strong)]"><RefreshCw size={11} /> Refresh</button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-5">
          {stats.map(([k, v]) => (
            <div key={k} className="rounded-md bg-[var(--surface-muted)] px-3 py-2">
              <div className="text-[11px] text-[var(--subtle)]">{k}</div>
              <div className="text-[15px] font-600 text-[var(--ink)] mono">{v}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
        <div className="space-y-6">
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <header className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
              <h2 className="text-sm font-600 text-[var(--ink)] flex items-center gap-2"><Gavel size={15} /> Waiting for approval</h2>
              <span className="text-xs text-[var(--subtle)]">{pending.length} pending</span>
            </header>
            {pending.length === 0 ? <p className="px-5 py-4 text-sm text-[var(--muted)]">Nothing needs a human right now.</p> : (
              <ul className="divide-y divide-[var(--border)]">
                {pending.map(a => (
                  <li key={a.id} className="px-5 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-500 text-[var(--ink)]">Shipment #{a.shipmentId} · {a.amountUSDC.toFixed(2)} USDC · agent recommends <span className="font-600">{a.action}</span></div>
                      <span className="text-xs text-[var(--subtle)]">{time(a.createdAt)}</span>
                    </div>
                    <p className="text-sm text-[var(--muted)] mt-1">{a.agentRecommendation}</p>
                    <ul className="mt-2 text-xs text-[var(--ink-2)] list-disc pl-4 space-y-0.5">{a.reasons.map(r => <li key={r}>{r}</li>)}</ul>
                    {a.draftDisputeReason && <p className="mt-2 text-xs mono bg-[var(--surface-muted)] rounded p-2">On-chain reason: {a.draftDisputeReason}</p>}
                    <div className="flex gap-2 mt-3">
                      <button disabled={busy === a.id} onClick={() => void resolve(a.id, 'approve')} className="rounded-md bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-500 px-3 py-1.5 disabled:opacity-50">Approve {a.action}</button>
                      <button disabled={busy === a.id} onClick={() => void resolve(a.id, 'reject')} className="rounded-md border border-[var(--border)] text-xs font-500 px-3 py-1.5 hover:border-[var(--border-strong)] disabled:opacity-50">Reject</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {pending.length > 0 && (
              <div className="px-5 py-3 border-t border-[var(--border)] flex items-center gap-2">
                <label className="text-xs text-[var(--subtle)]" htmlFor="hw-token">Approver token</label>
                <input id="hw-token" type="password" value={token} onChange={e => setToken(e.target.value)} className="flex-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs mono" />
              </div>
            )}
            {error && <p className="px-5 pb-3 text-xs text-[var(--danger)]">{error}</p>}
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <header className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
              <h2 className="text-sm font-600 text-[var(--ink)] flex items-center gap-2"><Clock size={15} /> Decision log</h2>
              <span className="text-xs text-[var(--subtle)]">hash-chained, append-only</span>
            </header>
            <ul className="divide-y divide-[var(--border)]">
              {decisions.map(d => {
                const st = ACTION_STYLE[d.action] ?? ACTION_STYLE.observe;
                return (
                  <li key={d.seq} className="px-5 py-3">
                    <button className="w-full text-left" onClick={() => setOpen(open === d.seq ? null : d.seq)}>
                      <div className="flex items-center gap-2 text-xs">
                        <span className={`rounded px-1.5 py-0.5 font-500 ${st.cls}`}>{st.label}</span>
                        {d.shipmentId !== undefined && <span className="text-[var(--ink-2)] font-500">#{d.shipmentId}</span>}
                        {d.amountUSDC !== undefined && <span className="mono text-[var(--muted)]">{d.amountUSDC.toFixed(2)} USDC</span>}
                        <span className="ml-auto text-[var(--subtle)]">{d.planner} · {time(d.ts)}</span>
                      </div>
                      <p className="text-sm text-[var(--ink-2)] mt-1">{d.rationale}</p>
                    </button>
                    {open === d.seq && (
                      <div className="mt-2 space-y-1">
                        {d.findings?.map(f => (
                          <div key={f.check} className="text-xs flex gap-2">
                            <span className={f.severity === 'ok' ? 'text-[var(--success)]' : f.severity === 'warn' ? 'text-[var(--warning)]' : 'text-[var(--danger)]'}>{f.severity === 'ok' ? <CheckCircle2 size={12} className="inline" /> : f.severity.toUpperCase()}</span>
                            <span className="mono text-[var(--subtle)] w-28 shrink-0">{f.check}</span><span className="text-[var(--ink-2)]">{f.detail}</span>
                          </div>
                        ))}
                        <div className="text-[11px] mono text-[var(--subtle)]">entry {d.hash.slice(0, 16)}…</div>
                      </div>
                    )}
                    {d.txHash && <a href={`${EXPLORER}/tx/${d.txHash}`} target="_blank" rel="noopener noreferrer" className="text-[11px] mono text-[var(--accent)] inline-flex items-center gap-1 mt-1">{short(d.txHash)} <ExternalLink size={10} /></a>}
                  </li>
                );
              })}
              {decisions.length === 0 && <li className="px-5 py-4 text-sm text-[var(--muted)]">No decisions yet.</li>}
            </ul>
          </section>
        </div>

        <aside className="space-y-6 xl:sticky xl:top-20 xl:self-start">
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="text-sm font-600 text-[var(--ink)]">Spending policy</h2>
            <p className="text-xs text-[var(--subtle)] mt-1">Enforced in code before any transaction is signed. The model cannot change it.</p>
            <dl className="mt-3 space-y-2">
              {POLICY_LABELS.map(([k, label, kind]) => {
                const v = status.policy[k];
                const shown = kind === 'bool' ? (v ? 'On' : 'Off') : kind === 'usdc' ? `${v} USDC` : kind === 'hours' ? `${v}h` : kind === 'pct' ? `${Number(v) * 100}%` : String(v);
                return <div key={k} className="flex justify-between gap-3 text-xs"><dt className="text-[var(--muted)]">{label}</dt><dd className="mono text-[var(--ink)]">{shown}</dd></div>;
              })}
            </dl>
          </section>
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="text-sm font-600 text-[var(--ink)]">Managed wallets</h2>
            <ul className="mt-3 space-y-2">
              {status.wallets.map(w => (
                <li key={w.address} className="text-xs flex items-center justify-between gap-2">
                  <span className="text-[var(--ink-2)] truncate">{w.label}</span>
                  <a href={`${EXPLORER}/address/${w.address}`} target="_blank" rel="noopener noreferrer" className="mono text-[var(--accent)] shrink-0">{short(w.address)}</a>
                  <span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] text-[var(--subtle)] shrink-0">{w.provider === 'circle' ? 'Circle wallet' : 'local key'}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
