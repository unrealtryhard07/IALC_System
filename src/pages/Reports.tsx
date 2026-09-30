import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Card, PageHeader, Spinner } from '../components/ui';
import { groupLegs, type AllocationSummary } from '../lib/allocations';
import { useAuth } from '../lib/auth';
import { downloadExcel } from '../lib/excel';
import { addDays, daysBetween, fmtDate, fmtPct, kwToday } from '../lib/format';
import { DISC_KIND, LEG_STATUS } from '../lib/labels';
import { fetchAll, friendlyError, supabase } from '../lib/supabase';
import type { DiscrepancyRow, LegRow } from '../lib/types';

const pct = (n: number, d: number) => (d > 0 ? n / d : null);

export default function Reports() {
  const a = useAuth();
  const [from, setFrom] = useState(addDays(kwToday(), -30));
  const [to, setTo] = useState(kwToday());
  const [legs, setLegs] = useState<LegRow[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const stores = a.sites.filter((s) => s.kind === 'ds' && s.active);

  useEffect(() => {
    setLegs(null);
    fetchAll<LegRow>((f, t) => supabase.from('v_legs').select('*').gte('plan_date', from).lte('plan_date', to).order('plan_date').range(f, t))
      .then(setLegs).catch((e) => setErr(friendlyError(e)));
  }, [from, to]);
  const allocs = useMemo(() => groupLegs(legs ?? []).reverse(), [legs]);

  const legFor = (al: AllocationSummary, siteId: number) => al.legs.find((l) => l.to_site_id === siteId);
  const trackerRows = allocs.map((al) => {
    const per = stores.map((s) => legFor(al, s.id));
    const sent = al.first_dispatch_date;
    const recvDates = per.map((l) => l?.completed_date ?? null);
    const days = per.map((l) => (l?.completed_date && l.first_dispatch_date ? daysBetween(l.first_dispatch_date, l.completed_date) : null));
    return { al, per, sent, recvDates, days };
  });

  const exportTracker = async () => {
    setBusy('tracker');
    try {
      const n = stores.length;
      const dest = (al: AllocationSummary) => al.legs.map((l) => `${a.siteName(l.to_site_id)} DS`);
      const reasonsByLeg = new Map<string, string>();
      // approved / pending reasons per allocation (short text)
      const ids = allocs.map((x) => x.allocation_id);
      if (ids.length) {
        const disc = await fetchAll<DiscrepancyRow>((f, t) => supabase.from('v_discrepancies').select('*').in('allocation_id', ids).range(f, t));
        const byAlloc = new Map<string, Map<string, number>>();
        disc.forEach((d) => {
          if (!d.allocation_id) return;
          const label = d.reason_code ? a.reasons.find((r) => r.code === d.reason_code)?.label ?? d.reason_code : `${DISC_KIND[d.kind].short} - no reason yet`;
          const m = byAlloc.get(d.allocation_id) ?? new Map();
          m.set(label, (m.get(label) ?? 0) + 1);
          byAlloc.set(d.allocation_id, m);
        });
        byAlloc.forEach((m, k) => reasonsByLeg.set(k, [...m.entries()].map(([l, c]) => `${l} (${c})`).join('; ')));
      }
      const header = [
        'Allocation Code', 'From Store / DC', ...Array.from({ length: 4 }, (_, i) => (i === 0 ? 'To' : '')), 'Sent Date',
        ...stores.map((s) => s.name), 'Total Received Date', '',
        ...stores.map((s) => s.name), '', ...stores.map((s) => s.name), '', ...stores.map((s) => s.name), '', 'Total Days Took To complete Allocation',
        ...stores.map((s) => s.name), 'Status', 'Reasons',
      ];
      let c = 1;
      const groups = [
        { label: '', from: c, to: (c += 7) - 1 },
        { label: 'Stores Received Dates', from: c, to: (c += n + 2) - 1 },
        { label: 'SKUs Sent Each Darkstore', from: c, to: (c += n + 1) - 1 },
        { label: 'SKUs Received Each Darkstore', from: c, to: (c += n + 1) - 1 },
        { label: 'Days Took To complete Allocation Each DS', from: c, to: (c += n + 2) - 1 },
        { label: 'SLA', from: c, to: (c += n) - 1 },
      ].filter((g) => g.label);
      const rows = trackerRows.map(({ al, per, sent, recvDates, days }) => {
        const d = dest(al);
        const complete = al.status === 'completed';
        return [
          al.ref, `From ${a.siteName(al.from_site_id)}`, d[0] ?? '-', d[1] ?? '-', d[2] ?? '-', d[3] ?? '-', fmtDate(sent),
          ...recvDates.map((x, i) => (per[i] ? fmtDate(x) : '-')), complete ? fmtDate(al.completed_date) : '', null,
          ...per.map((l) => l?.planned_skus ?? 0), null,
          ...per.map((l) => l?.received_skus ?? 0), null,
          ...days.map((x) => x ?? 0), null, complete && sent && al.completed_date ? daysBetween(sent, al.completed_date) : null,
          ...per.map((l) => (l ? pct(l.received_skus, l.planned_skus) ?? 0 : 0)),
          LEG_STATUS[al.status].label, reasonsByLeg.get(al.allocation_id) ?? '-',
        ];
      });
      const pctCols = header.length - 2 - n;
      await downloadExcel(`Allocation_Tracker_${from}_to_${to}`, [
        {
          name: 'Tracker',
          title: `Last Updated on ${fmtDate(kwToday())} ${new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuwait' })}`,
          headerGroups: groups,
          columns: header.map((h, i) => ({ header: h, width: i === header.length - 1 ? 40 : i === 0 ? 12 : 11, numFmt: i >= pctCols && i < pctCols + n ? '0.00%' : undefined })),
          rows,
        },
        {
          name: 'Qty detail',
          columns: [{ header: 'Allocation' }, { header: 'Type' }, { header: 'Plan date' }, { header: 'From' }, { header: 'To' }, { header: 'Planned SKUs' }, { header: 'Planned qty', numFmt: '#,##0.###' }, { header: 'Dispatched SKUs' }, { header: 'Dispatched qty', numFmt: '#,##0.###' }, { header: 'Received SKUs' }, { header: 'Received qty', numFmt: '#,##0.###' }, { header: 'Still in allocation store', numFmt: '#,##0.###' }, { header: 'Value open (KWD)', numFmt: '0.000' }, { header: 'Dispatch fill %', numFmt: '0.0%' }, { header: 'Receipt %', numFmt: '0.0%' }, { header: 'First dispatch' }, { header: 'Completed' }, { header: 'Days' }, { header: 'Open issues' }, { header: 'STVs', width: 30 }, { header: 'Status' }],
          rows: allocs.flatMap((al) => al.legs.map((l) => [al.ref, al.kind === 'dc' ? 'DC' : 'Internal', fmtDate(al.plan_date), a.siteName(al.from_site_id), a.siteName(l.to_site_id), l.planned_skus, l.planned_qty, l.dispatched_skus, l.dispatched_qty, l.received_skus, l.received_qty, l.open_qty, l.open_value ? Number(Number(l.open_value).toFixed(3)) : null, pct(l.dispatched_qty, l.planned_qty), pct(l.received_qty, l.dispatched_qty), fmtDate(l.first_dispatch_date), fmtDate(l.completed_date), l.completed_date && l.first_dispatch_date ? daysBetween(l.first_dispatch_date, l.completed_date) : null, l.open_issues, l.dispatch_docs, LEG_STATUS[l.status].label])),
        },
      ]);
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(''); }
  };

  const exportDiscrepancies = async () => {
    setBusy('disc');
    try {
      const rows = await fetchAll<DiscrepancyRow>((f, t) => supabase.from('v_discrepancies').select('*').gte('event_date', from).lte('event_date', to).order('event_date').range(f, t));
      await downloadExcel(`Discrepancies_${from}_to_${to}`, [{
        name: 'Discrepancies',
        columns: [{ header: 'Date' }, { header: 'Type', width: 22 }, { header: 'From' }, { header: 'To' }, { header: 'Responsible store' }, { header: 'Plan' }, { header: 'STV(s)', width: 18 }, { header: 'Item code' }, { header: 'Item name', width: 40 }, { header: 'Expected', numFmt: '#,##0.###' }, { header: 'Actual', numFmt: '#,##0.###' }, { header: 'Gap', numFmt: '#,##0.###' }, { header: 'Gap value (KWD)', numFmt: '0.000' }, { header: 'Reason', width: 28 }, { header: 'Reason status' }, { header: 'Note', width: 30 }],
        rows: rows.map((r) => [fmtDate(r.event_date), DISC_KIND[r.kind].label, a.siteName(r.from_site_id), a.siteName(r.to_site_id), a.siteName(r.responsible_site_id), r.ref, r.doc_no ?? r.docs, r.item_code, r.item_name, r.planned_qty, r.actual_qty, r.gap_qty, r.cost && r.gap_qty ? Number((Math.abs(r.gap_qty) * r.cost).toFixed(3)) : null, a.reasons.find((x) => x.code === r.reason_code)?.label ?? '', r.resolution_status ?? 'needs reason', r.resolution_note]),
      }]);
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(''); }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Reports" subtitle="Excel exports for head office. Every table in the system also has its own ⬇ Excel button."
        actions={<div className="flex items-center gap-2 text-sm">
          <label>From <input className="input w-auto" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>to <input className="input w-auto" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>} />
      {err && <Alert tone="bad">{err}</Alert>}
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="📊 Allocation tracker (same as your old Excel)">
          <p className="mb-3 text-sm text-slate-600">Same layout as the tracker you keep today - received dates, SKUs sent/received, days and SLA per store - but filled automatically, plus a qty-level sheet.</p>
          <button className="btn-primary" onClick={exportTracker} disabled={!legs || !!busy}>{busy === 'tracker' ? 'Building…' : '⬇ Download tracker'}</button>
        </Card>
        <Card title="⚠️ Problems report">
          <p className="mb-3 text-sm text-slate-600">Every short / over / wrong / not-received line with the store's reason and HO decision, with KWD value where cost is known.</p>
          <button className="btn-primary" onClick={exportDiscrepancies} disabled={!!busy}>{busy === 'disc' ? 'Building…' : '⬇ Download discrepancies'}</button>
        </Card>
        <Card title="Other exports">
          <ul className="space-y-1 text-sm">
            <li><Link className="link" to="/in-transit">In-transit stock (by STV / by item)</Link></li>
            <li><Link className="link" to="/virtual-stores">Virtual store watch</Link></li>
            <li><Link className="link" to="/stvs">STV register</Link></li>
            <li><Link className="link" to="/items">Items masterlist</Link></li>
          </ul>
        </Card>
      </div>
      <Card title={`Tracker preview - ${allocs.length} allocation(s) planned ${fmtDate(from)} → ${fmtDate(to)}`} pad={false}>
        {!legs ? <Spinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th" rowSpan={2}>Code</th><th className="th" rowSpan={2}>From</th><th className="th" rowSpan={2}>Sent</th>
                  {stores.map((s) => <th key={s.id} className="th border-l text-center" colSpan={3}>{s.name}</th>)}
                  <th className="th border-l" rowSpan={2}>Status</th>
                </tr>
                <tr>{stores.map((s) => [<th key={`${s.id}a`} className="th border-l text-right">SKUs sent</th>, <th key={`${s.id}b`} className="th text-right">Recv</th>, <th key={`${s.id}c`} className="th text-right">SLA</th>])}</tr>
              </thead>
              <tbody>
                {trackerRows.map(({ al, per, sent }) => (
                  <tr key={al.allocation_id} className="hover:bg-slate-50">
                    <td className="td"><Link className="link" to={`/allocations/${al.allocation_id}`}>{al.ref}</Link></td>
                    <td className="td">{a.siteName(al.from_site_id)}</td>
                    <td className="td">{fmtDate(sent)}</td>
                    {per.map((l, i) => l ? [
                      <td key={`${i}a`} className="td num border-l">{l.planned_skus}</td>,
                      <td key={`${i}b`} className="td num">{l.received_skus}</td>,
                      <td key={`${i}c`} className="td num">{fmtPct(l.received_skus, l.planned_skus)}</td>,
                    ] : <td key={i} className="td border-l text-center text-slate-300" colSpan={3}>-</td>)}
                    <td className="td border-l"><Badge tone={LEG_STATUS[al.status].tone}>{LEG_STATUS[al.status].label}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {allocs.length === 0 && <div className="p-6 text-center text-sm text-slate-500">No allocations in this period.</div>}
          </div>
        )}
      </Card>
    </div>
  );
}
