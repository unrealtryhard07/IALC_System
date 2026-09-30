// Head-office overview: KPIs, what needs attention, and analytics across all stores.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CAT, Columns, Donut, HBars, Kpi, STATUS_COLOR, BRAND, type Slice } from '../components/charts';
import { Icon, type IconName } from '../components/Icon';
import { Alert, Card, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth';
import { addDays, daysBetween, fmtDate, fmtKwd, fmtQty, kwToday, sum } from '../lib/format';
import { DISC_KIND, LEG_STATUS } from '../lib/labels';
import { fetchAll, friendlyError, supabase } from '../lib/supabase';
import type { DiscKind, DiscrepancyRow, DispatchItemRow, LegRow, LegStatus, VsRow } from '../lib/types';
import { AgingChart, OldestTransfers, Scorecard } from './Dashboard';

interface StvLite { direction: string; stv_date: string; total_qty: number; from_site_id: number; to_site_id: number }
interface ResLite { kind: DiscKind; reason_code: string | null; status: string; requested_at: string }
interface Data { legs: LegRow[]; open: DispatchItemRow[]; disc: DiscrepancyRow[]; vs: VsRow[]; stvs: StvLite[]; res: ResLite[] }

const STATUS_ORDER: { s: LegStatus; color: string }[] = [
  { s: 'awaiting_dispatch', color: STATUS_COLOR.neutral },
  { s: 'in_transit', color: STATUS_COLOR.info },
  { s: 'partially_received', color: STATUS_COLOR.warning },
  { s: 'discrepancy', color: STATUS_COLOR.critical },
  { s: 'completed', color: STATUS_COLOR.good },
];
const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);
const fmtP = (v: number | null) => (v == null ? '–' : `${v.toFixed(1)}%`);

export default function Overview() {
  const a = useAuth();
  const [period, setPeriod] = useState(30);
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    const since = addDays(kwToday(), -120);
    Promise.all([
      fetchAll<LegRow>((f, t) => supabase.from('v_legs').select('*').gte('plan_date', since).range(f, t)),
      fetchAll<DispatchItemRow>((f, t) => supabase.from('v_dispatch_items').select('*').gt('open_qty', 0).range(f, t)),
      fetchAll<DiscrepancyRow>((f, t) => supabase.from('v_discrepancies').select('*').or('resolution_status.is.null,resolution_status.neq.approved').range(f, t)),
      fetchAll<VsRow>((f, t) => supabase.from('v_vs_latest').select('*').range(f, t)),
      fetchAll<StvLite>((f, t) => supabase.from('stvs').select('direction, stv_date, total_qty, from_site_id, to_site_id').eq('status', 'active').gte('stv_date', addDays(kwToday(), -56)).range(f, t)),
      fetchAll<ResLite>((f, t) => supabase.from('resolutions').select('kind, reason_code, status, requested_at').gte('requested_at', addDays(kwToday(), -90)).range(f, t)),
    ]).then(([legs, open, disc, vs, stvs, res]) => setD({ legs, open, disc, vs, stvs, res })).catch((e) => setErr(friendlyError(e)));
  }, []);

  const m = useMemo(() => {
    if (!d) return null;
    const since = addDays(kwToday(), -period);
    const legs = d.legs.filter((l) => l.plan_date >= since && l.status !== 'cancelled');
    const sent = legs.filter((l) => l.first_dispatch_date);
    const done = legs.filter((l) => l.completed_date && l.first_dispatch_date);
    const late = d.open.filter((r) => r.age_days > a.receiptSla);
    const isProblem = (x: DiscrepancyRow) => x.kind !== 'receipt_short' || Number(x.actual_qty) > 0;
    const problems = d.disc.filter(isProblem);
    const storesDs = a.sites.filter((s) => s.active);
    const receivers = storesDs.filter((s) => legs.some((l) => l.to_site_id === s.id));
    const senders = storesDs.filter((s) => sent.some((l) => l.from_site_id === s.id));

    // weekly flow (last 8 weeks)
    const weeks = Array.from({ length: 8 }, (_, i) => addDays(kwToday(), -7 * (7 - i) - 6));
    const wk = (date: string) => weeks.findIndex((w, i) => date >= w && (i === 7 || date < weeks[i + 1]));
    const sentW = weeks.map(() => 0), recvW = weeks.map(() => 0);
    for (const s of d.stvs) {
      const i = wk(s.stv_date);
      if (i < 0) continue;
      if (s.direction === 'dispatch' || s.direction === 'direct') sentW[i] += Number(s.total_qty);
      if (s.direction === 'receipt' || s.direction === 'direct') recvW[i] += Number(s.total_qty);
    }

    // reasons given (last 90 days)
    const reasonCount = new Map<string, number>();
    d.res.forEach((r) => r.reason_code && reasonCount.set(r.reason_code, (reasonCount.get(r.reason_code) ?? 0) + 1));
    const reasonsSorted = [...reasonCount.entries()].sort((x, y) => y[1] - x[1]);
    const reasons: Slice[] = reasonsSorted.slice(0, 5).map(([code, n], i) => ({ label: a.reasons.find((r) => r.code === code)?.label ?? code, value: n, color: CAT[i] }));
    const rest = reasonsSorted.slice(5).reduce((s, [, n]) => s + n, 0);
    if (rest) reasons.push({ label: 'Other reasons', value: rest, color: '#a3a3a0' });

    // stuck stock (latest ERP report) by virtual store
    const vsByLoc = new Map<string, { qty: number; unknown: number; name: string }>();
    d.vs.forEach((r) => {
      const e = vsByLoc.get(r.location_code) ?? { qty: 0, unknown: 0, name: r.erp_name };
      e.qty += Number(r.erp_qty);
      if (r.match_status === 'not_in_system') e.unknown += Number(r.erp_qty);
      vsByLoc.set(r.location_code, e);
    });

    return {
      legs, sent, done, late, problems,
      plannedQty: sum(legs, (l) => l.planned_qty),
      plans: new Set(legs.map((l) => l.allocation_id)).size,
      fill: pct(sum(sent, (l) => Math.min(Number(l.dispatched_qty), Number(l.planned_qty))), sum(sent, (l) => l.planned_qty)),
      recv: pct(sum(sent, (l) => l.received_qty), sum(sent, (l) => l.dispatched_qty)),
      onTime: pct(sent.filter((l) => daysBetween(l.plan_date, l.first_dispatch_date!) <= a.dispatchSla).length, sent.length),
      avgDays: done.length ? sum(done, (l) => daysBetween(l.first_dispatch_date!, l.completed_date!)) / done.length : null,
      waitQty: sum(d.open, (r) => r.open_qty),
      waitValue: sum(d.open, (r) => r.open_qty * (r.cost ?? 0)),
      lateQty: sum(late, (r) => r.open_qty),
      lateStvs: new Set(late.map((r) => r.stv_id)).size,
      pending: d.disc.filter((x) => x.resolution_status === 'pending').length,
      unexplained: problems.filter((x) => x.resolution_status === null || x.resolution_status === 'rejected').length,
      notSent: d.legs.filter((l) => l.status === 'awaiting_dispatch').length,
      notSentLate: d.legs.filter((l) => l.status === 'awaiting_dispatch' && (l.days_waiting_dispatch ?? 0) > a.dispatchSla).length,
      statusSlices: STATUS_ORDER.map(({ s, color }) => ({ label: LEG_STATUS[s].label, value: legs.filter((l) => l.status === s).length, color })),
      byReceiver: {
        categories: receivers.map((s) => s.name),
        series: [
          { name: 'Planned', color: CAT[0], values: receivers.map((s) => sum(legs.filter((l) => l.to_site_id === s.id), (l) => l.planned_qty)) },
          { name: 'Sent', color: CAT[1], values: receivers.map((s) => sum(legs.filter((l) => l.to_site_id === s.id), (l) => l.dispatched_qty)) },
          { name: 'Received', color: CAT[2], values: receivers.map((s) => sum(legs.filter((l) => l.to_site_id === s.id), (l) => l.received_qty)) },
        ],
      },
      weekly: { categories: weeks.map((w) => fmtDate(w).slice(0, 5)), series: [{ name: 'Pieces sent', color: CAT[0], values: sentW }, { name: 'Pieces received', color: CAT[1], values: recvW }] },
      senderFill: senders.map((s) => {
        const ls = sent.filter((l) => l.from_site_id === s.id);
        return { label: s.name, value: pct(sum(ls, (l) => Math.min(Number(l.dispatched_qty), Number(l.planned_qty))), sum(ls, (l) => l.planned_qty)) ?? 0, note: `${ls.length} allocation(s) sent` };
      }).sort((x, y) => x.value - y.value),
      receiverDays: storesDs.map((s) => {
        const ls = done.filter((l) => l.to_site_id === s.id);
        return { label: s.name, value: ls.length ? sum(ls, (l) => daysBetween(l.first_dispatch_date!, l.completed_date!)) / ls.length : 0, note: `${ls.length} completed`, n: ls.length };
      }).filter((r) => r.n > 0).sort((x, y) => y.value - x.value),
      problemTypes: (Object.keys(DISC_KIND) as DiscKind[]).map((k) => ({ label: DISC_KIND[k].short, value: problems.filter((x) => x.kind === k && x.resolution_status !== 'approved').length }))
        .filter((r) => r.value > 0).sort((x, y) => y.value - x.value),
      reasons,
      stuck: [...vsByLoc.values()].map((e) => ({ label: e.name, value: e.qty, note: `${fmtQty(e.unknown)} pcs unknown (not explained by any transfer)`, color: e.unknown ? BRAND : CAT[0] })).sort((x, y) => y.value - x.value),
    };
  }, [d, period, a]);

  if (err) return <Alert tone="bad">{err}</Alert>;
  if (!d || !m) return <Spinner />;
  const tone = (v: number | null, good: number, ok: number) => (v == null ? 'neutral' : v >= good ? 'good' : v >= ok ? 'warn' : 'bad') as 'neutral' | 'good' | 'warn' | 'bad';

  const attention: { icon: IconName; n: number; text: string; to: string }[] = [
    { icon: 'checkCircle', n: m.pending, text: 'explanations to approve', to: '/discrepancies?tab=pending' },
    { icon: 'truck', n: m.lateStvs, text: `transfers received late (${fmtQty(m.lateQty)} pcs)`, to: '/in-transit?overdue=1' },
    { icon: 'send', n: m.notSentLate, text: `plans not sent on time (of ${m.notSent} not sent)`, to: '/allocations?status=awaiting_dispatch' },
    { icon: 'alert', n: m.unexplained, text: 'problems without a reason', to: '/discrepancies' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-slate-500">All stores · {fmtDate(kwToday())} · receiving deadline {a.receiptSla} day(s), sending deadline {a.dispatchSla} day(s)</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm" role="group" aria-label="Period">
            {[7, 30, 90].map((p) => (
              <button key={p} onClick={() => setPeriod(p)} className={`rounded-md px-3 py-1 text-sm font-medium ${period === p ? 'bg-brand-500 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{p} days</button>
            ))}
          </div>
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
        <Kpi label="Received late" value={fmtQty(m.lateQty)} sub={`${m.lateStvs} STVs over ${a.receiptSla} day(s)`} tone={m.lateQty ? 'bad' : 'good'} />
        <Kpi label="Open problems" value={m.problems.length} sub={`${m.pending} waiting for your approval`} tone={m.problems.length ? 'warn' : 'good'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {attention.map((x) => (
          <Link key={x.text} to={x.to} className={`card group flex items-center gap-3 p-3.5 transition hover:border-brand-200 hover:shadow-md ${x.n ? '' : 'opacity-70'}`}>
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${x.n ? 'bg-brand-50 text-brand-600' : 'bg-green-50 text-green-600'}`}><Icon name={x.n ? x.icon : 'check'} /></span>
            <span className="min-w-0 flex-1"><span className="text-xl font-semibold tabular-nums">{x.n}</span> <span className="text-sm text-slate-600">{x.text}</span></span>
            <Icon name="arrowRight" className="h-4 w-4 text-slate-300 group-hover:text-brand-500" />
          </Link>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-5">
        <Card title="Allocation status" className="xl:col-span-2"><Donut data={m.statusSlices} sub="allocations" format={(n) => String(n)} /></Card>
        <Card title="Planned vs sent vs received, by receiving store" className="xl:col-span-3"><Columns {...m.byReceiver} format={(n) => `${fmtQty(n)} pcs`} /></Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Weekly flow - pieces sent and received (8 weeks)"><Columns {...m.weekly} format={(n) => `${fmtQty(n)} pcs`} height={200} /></Card>
        <Card title="Stock waiting to be received - by store and age"><AgingChart rows={d.open} /></Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Sending stores - sent vs plan">
          <HBars rows={m.senderFill} format={(n) => `${n.toFixed(1)}%`} max={100} target={95} targetLabel="95% target" empty="Nothing sent in this period" />
        </Card>
        <Card title="Receiving stores - avg days to receive">
          <HBars rows={m.receiverDays} format={(n) => `${n.toFixed(1)} d`} target={a.receiptSla} targetLabel={`${a.receiptSla}-day deadline`} empty="No completed allocations yet" />
        </Card>
        <Card title="Reasons given for differences (90 days)"><Donut data={m.reasons} sub="explanations" format={(n) => String(n)} empty="No explanations yet" /></Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Open problems by type" actions={<Link to="/discrepancies" className="link text-sm">Open list</Link>}>
          <HBars rows={m.problemTypes} format={(n) => String(n)} empty="No open problems" />
        </Card>
        <Card title="Stock stuck in virtual stores" actions={<Link to="/virtual-stores" className="link text-sm">Check</Link>}>
          <HBars rows={m.stuck} format={(n) => `${fmtQty(n)} pcs`} empty="Upload the ERP stock report of the Allocation stores to see this" />
          {m.stuck.length > 0 && <p className="mt-3 text-xs text-slate-500">Magenta = includes stock that no transfer explains (old backlog). From the latest ERP report.</p>}
        </Card>
        <Card title="Oldest transfers not received" pad={false}><OldestTransfers rows={d.open} /></Card>
      </div>

      <Card title="How each store is doing (plans from the last 30 days)" pad={false}><Scorecard legs={d.legs} open={d.open} /></Card>
    </div>
  );
}
