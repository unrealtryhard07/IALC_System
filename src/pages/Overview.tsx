// Head-office home: the key numbers and everything that needs action today. Charts live on the Dashboard tab.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HBars, Kpi } from '../components/charts';
import { Icon } from '../components/Icon';
import { Alert, Card, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtKwd, fmtQty, kwToday } from '../lib/format';
import { fmtP, useHoData, useMetrics } from '../lib/metrics';
import { NOTICE_ICON, noticeLabel, type Notice } from '../lib/notices';
import { rpc } from '../lib/supabase';
import { OldestTransfers } from './Dashboard';

export function PeriodPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm" role="group" aria-label="Period">
      {[7, 30, 90].map((p) => (
        <button key={p} onClick={() => onChange(p)} className={`rounded-md px-3 py-1 text-sm font-medium ${value === p ? 'bg-brand-500 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{p} days</button>
      ))}
    </div>
  );
}

export default function Overview() {
  const a = useAuth();
  const [period, setPeriod] = useState(30);
  const { d, err } = useHoData();
  const m = useMetrics(d, period);
  const [notices, setNotices] = useState<Notice[] | null>(null);
  useEffect(() => { rpc<Notice[]>('my_notifications').then(setNotices).catch(() => setNotices([])); }, []);

  if (err) return <Alert tone="bad">{err}</Alert>;
  if (!d || !m) return <Spinner />;
  const tone = (v: number | null, good: number, ok: number) => (v == null ? 'neutral' : v >= good ? 'good' : v >= ok ? 'warn' : 'bad') as 'neutral' | 'good' | 'warn' | 'bad';
  const firstHist = new Map<string, number>(), lastHist = new Map<string, number>();
  d.hist.forEach((h) => { if (!firstHist.has(h.location_code)) firstHist.set(h.location_code, Number(h.qty)); lastHist.set(h.location_code, Number(h.qty)); });
  const startQty = [...firstHist.values()].reduce((s, v) => s + v, 0), nowQty = [...lastHist.values()].reduce((s, v) => s + v, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-slate-500">All stores · {fmtDate(kwToday())} · receiving deadline {a.receiptSla} day(s), sending deadline {a.dispatchSla} day(s)</p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodPicker value={period} onChange={setPeriod} />
          <Link to="/dashboard" className="btn-secondary"><Icon name="chart" className="h-4 w-4" />Dashboard</Link>
          {a.isAdmin && <Link to="/allocations/new" className="btn-primary"><Icon name="upload" className="h-4 w-4" />Upload plan</Link>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Allocations planned" value={m.legs.length} sub={`${m.plans} plans · ${fmtQty(m.plannedQty)} pcs`} tone="brand" />
        <Kpi label="Sent vs plan" value={fmtP(m.fill)} sub="pieces sent / planned" tone={tone(m.fill, 95, 85)} />
        <Kpi label="Sent on time" value={fmtP(m.onTime)} sub={`within ${a.dispatchSla} days of the plan`} tone={tone(m.onTime, 90, 70)} />
        <Kpi label="Received vs sent" value={fmtP(m.recv)} sub="pieces received / sent" tone={tone(m.recv, 97, 85)} />
        <Kpi label="Avg days to receive" value={m.avgDays == null ? '–' : m.avgDays.toFixed(1)} sub={`${m.done.length} completed`} tone={m.avgDays == null ? 'neutral' : m.avgDays <= a.receiptSla ? 'good' : m.avgDays <= a.receiptSla * 2 ? 'warn' : 'bad'} />
        <Kpi label="Waiting to be received" value={fmtQty(m.waitQty)} sub={m.waitValue ? fmtKwd(m.waitValue) : 'pieces'} tone={m.waitQty ? 'warn' : 'good'} />
        <Kpi label="Late, not received" value={fmtQty(m.lateQty)} sub={`pcs in ${m.lateStvs} STV(s) older than ${a.receiptSla} day(s)`} tone={m.lateQty ? 'bad' : 'good'} />
        <Kpi label="Open problems" value={m.problems.length} sub={`${m.pending} waiting for your approval`} tone={m.problems.length ? 'warn' : 'good'} />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-800">Needs attention</h2>
        {notices == null ? <Spinner /> : notices.length === 0 ? (
          <div className="card flex items-center gap-3 p-4 text-sm text-slate-600"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-50 text-green-600"><Icon name="check" /></span>All clear - nothing is waiting for head office.</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {notices.map((x) => (
              <Link key={x.key} to={x.to} className="card group flex items-center gap-3 p-3.5 transition hover:border-brand-200 hover:shadow-md">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${x.tone === 'bad' ? 'bg-red-50 text-red-600' : x.tone === 'info' ? 'bg-blue-50 text-blue-600' : 'bg-brand-50 text-brand-600'}`}><Icon name={NOTICE_ICON[x.key] ?? 'alert'} /></span>
                <span className="min-w-0 flex-1"><span className="text-xl font-semibold tabular-nums">{x.key === 'month' ? '' : x.n}</span> <span className="text-sm text-slate-600">{noticeLabel(x)}</span></span>
                <Icon name="arrowRight" className="h-4 w-4 text-slate-300 group-hover:text-brand-500" />
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Open problems by type" actions={<Link to="/discrepancies" className="link text-sm">Open list</Link>}>
          <HBars rows={m.problemTypes} format={(n) => String(n)} empty="No open problems" />
        </Card>
        <Card title="Stock stuck in virtual stores" actions={<Link to="/virtual-stores?tab=cleanup" className="link text-sm">Clean up</Link>}>
          <HBars rows={m.stuck} format={(n) => `${fmtQty(n)} pcs`} empty="Upload the ERP stock report of the Allocation stores to see this" />
          {startQty > 0 && (
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs text-slate-500"><span>Cleared since the first ERP report</span><b className="text-slate-800">{fmtP(Math.max(0, ((startQty - nowQty) / startQty) * 100))}</b></div>
              <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-green-600" style={{ width: `${Math.max(0, Math.min(100, ((startQty - nowQty) / startQty) * 100))}%` }} /></div>
              <p className="mt-1 text-xs text-slate-500">{fmtQty(startQty)} pcs then, {fmtQty(nowQty)} pcs now</p>
            </div>
          )}
        </Card>
        <Card title="Oldest transfers not received" pad={false}><OldestTransfers rows={d.open} /></Card>
      </div>
    </div>
  );
}
