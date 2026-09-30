// Dashboard tab: charts, trends and store comparisons for head office.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CAT, Columns, Donut, HBars, Lines } from '../components/charts';
import { Alert, Card, Spinner, Tabs } from '../components/ui';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtKwd, fmtQty, kwToday } from '../lib/format';
import { fmtP, lastMonths, monthLabel, pct, useHoData, useMetrics, type AccRow, type VsHist } from '../lib/metrics';
import { AgingChart, Scorecard } from './Dashboard';
import { PeriodPicker } from './Overview';

export default function Analytics() {
  const a = useAuth();
  const [period, setPeriod] = useState(30);
  const { d, err } = useHoData();
  const m = useMetrics(d, period);

  if (err) return <Alert tone="bad">{err}</Alert>;
  if (!d || !m) return <Spinner />;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-slate-500">Charts and trends for all stores · {fmtDate(kwToday())}. Hover any chart for exact numbers.</p>
        </div>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      <div className="grid gap-5 xl:grid-cols-5">
        <Card title={`Allocation status (last ${period} days)`} className="xl:col-span-2"><Donut data={m.statusSlices} sub="allocations" format={(n) => String(n)} /></Card>
        <Card title="Planned vs sent vs received, by receiving store" className="xl:col-span-3"><Columns {...m.byReceiver} format={(n) => `${fmtQty(n)} pcs`} /></Card>
      </div>

      <AccuracyTrend rows={d.acc} />

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

      <div className="grid gap-5 xl:grid-cols-5">
        <div className="xl:col-span-3"><BacklogTrend hist={d.hist} /></div>
        <Card title="Stuck now, by virtual store" className="xl:col-span-2">
          <HBars rows={m.stuck} format={(n) => `${fmtQty(n)} pcs`} empty="No ERP stock report uploaded yet" />
          {m.stuck.length > 0 && <p className="mt-3 text-xs text-slate-500">Magenta = includes stock that no transfer explains (old backlog). From the latest ERP report.</p>}
        </Card>
      </div>

      <Card title={`How each store is doing (plans from the last ${period} days)`} pad={false}><Scorecard legs={m.legs} open={d.open} /></Card>
    </div>
  );
}

// Monthly accuracy per store: sending exactly what was planned / receiving everything that was sent.
function AccuracyTrend({ rows }: { rows: AccRow[] }) {
  const a = useAuth();
  const [role, setRole] = useState<'sender' | 'receiver'>('sender');
  const months = useMemo(() => lastMonths(6), []);
  const data = useMemo(() => {
    const rs = rows.filter((r) => r.role === role);
    const stores = a.sites.filter((s) => s.active && rs.some((r) => r.site_id === s.id));
    const at = (site: number, mo: string) => rs.find((r) => r.site_id === site && r.month.slice(0, 7) === mo.slice(0, 7));
    const series = stores.map((s, i) => ({
      name: s.name, color: CAT[i % CAT.length],
      values: months.map((mo) => { const r = at(s.id, mo); return r && Number(r.lines) > 0 ? (Number(r.exact_lines) / Number(r.lines)) * 100 : null; }),
    }));
    const table = stores.map((s) => {
      const cur = at(s.id, months[5]), prev = at(s.id, months[4]);
      const acc = (r?: AccRow) => (r && Number(r.lines) ? (Number(r.exact_lines) / Number(r.lines)) * 100 : null);
      const allRows = rs.filter((r) => r.site_id === s.id);
      return {
        site: s.name, now: acc(cur), before: acc(prev),
        lines: allRows.reduce((x, r) => x + Number(r.lines), 0),
        qtyFill: pct(allRows.reduce((x, r) => x + Number(r.matched_qty), 0), allRows.reduce((x, r) => x + Number(r.expected_qty), 0)),
        extra: allRows.reduce((x, r) => x + Number(r.extra_lines), 0),
      };
    });
    return { series, table };
  }, [rows, role, a.sites, months]);
  const help = role === 'sender'
    ? 'Share of plan lines each store sent in exactly the planned quantity. Only plans that were sent count.'
    : 'Share of sent lines each store received in full. Transfers still inside the receiving deadline are not counted yet.';
  return (
    <Card title="Accuracy trend per store (6 months)" actions={
      <div className="-mb-4"><Tabs value={role} onChange={setRole} tabs={[{ value: 'sender', label: 'Sending' }, { value: 'receiver', label: 'Receiving' }]} /></div>
    }>
      <p className="mb-3 text-xs text-slate-500">{help}</p>
      <div className="grid gap-5 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <Lines categories={months.map((mo) => monthLabel(mo))} series={data.series} min={0} max={100} target={95} targetLabel="95% target"
            format={(n) => `${n.toFixed(0)}%`} empty="No sent allocations in the last 6 months" />
        </div>
        <div className="overflow-x-auto xl:col-span-2">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="py-1.5">Store</th><th className="py-1.5 text-right">This month</th><th className="py-1.5 text-right">Change</th><th className="py-1.5 text-right">Pcs {role === 'sender' ? 'sent' : 'received'}</th>{role === 'sender' && <th className="py-1.5 text-right">Extra lines</th>}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.table.map((r) => {
                const ch = r.now != null && r.before != null ? r.now - r.before : null;
                return (
                  <tr key={r.site}>
                    <td className="py-2 font-medium">{r.site}</td>
                    <td className="py-2 text-right tabular-nums">{fmtP(r.now)}</td>
                    <td className={`py-2 text-right tabular-nums ${ch == null ? 'text-slate-400' : ch >= 0 ? 'text-green-700' : 'text-red-700'}`}>{ch == null ? '–' : `${ch >= 0 ? '+' : ''}${ch.toFixed(1)}`}</td>
                    <td className="py-2 text-right tabular-nums" title="pieces matched / expected, all 6 months">{fmtP(r.qtyFill)}</td>
                    {role === 'sender' && <td className="py-2 text-right tabular-nums">{r.extra || '–'}</td>}
                  </tr>
                );
              })}
              {!data.table.length && <tr><td colSpan={5} className="py-6 text-center text-slate-400">No data yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

// Size of the Allocation (virtual) stores over time, from every ERP report uploaded.
function BacklogTrend({ hist }: { hist: VsHist[] }) {
  const [metric, setMetric] = useState<'qty' | 'value' | 'skus'>('qty');
  const dates = [...new Set(hist.map((h) => h.snapshot_date))].sort();
  const locs = [...new Map(hist.map((h) => [h.location_code, h.erp_name])).entries()];
  const series = locs.map(([code, name], i) => ({
    name, color: CAT[i % CAT.length],
    values: dates.map((dt) => { const h = hist.find((x) => x.location_code === code && x.snapshot_date === dt); return h ? Number(h[metric]) : null; }),
  }));
  const fmt = metric === 'value' ? (n: number) => fmtKwd(n) : metric === 'skus' ? (n: number) => `${fmtQty(n)} items` : (n: number) => `${fmtQty(n)} pcs`;
  return (
    <Card title="Stuck stock in virtual stores over time" actions={
      <div className="flex items-center gap-3">
        <div className="-mb-4"><Tabs value={metric} onChange={setMetric} tabs={[{ value: 'qty', label: 'Pieces' }, { value: 'value', label: 'Value' }, { value: 'skus', label: 'Items' }]} /></div>
        <Link to="/virtual-stores?tab=cleanup" className="link text-sm">Clean up</Link>
      </div>
    }>
      <p className="mb-3 text-xs text-slate-500">One point per ERP stock report uploaded. The line should go down as old stock is cleared.</p>
      <Lines categories={dates.map((dt) => fmtDate(dt).slice(0, 5))} series={series} format={fmt} empty="Upload the ERP stock report of the Allocation stores (Stuck stock check) to see the trend" />
    </Card>
  );
}
