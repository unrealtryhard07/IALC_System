import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Badge, Card, PageHeader, Spinner, Stat } from '../components/ui';
import { useAuth } from '../lib/auth';
import { AGE_BUCKETS, ageBucket, addDays, daysBetween, fmtDate, fmtKwd, fmtPct, fmtQty, kwToday, sum } from '../lib/format';
import { fetchAll, friendlyError, supabase } from '../lib/supabase';
import type { DiscrepancyRow, DispatchItemRow, LegRow, VsRow } from '../lib/types';

interface Data { legs: LegRow[]; open: DispatchItemRow[]; disc: DiscrepancyRow[]; vs: VsRow[] }

export default function Dashboard() {
  const a = useAuth();
  const nav = useNavigate();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    const since = addDays(kwToday(), -120);
    Promise.all([
      fetchAll<LegRow>((f, t) => supabase.from('v_legs').select('*').eq('allocation_status', 'active').gte('plan_date', since).range(f, t)),
      fetchAll<DispatchItemRow>((f, t) => supabase.from('v_dispatch_items').select('*').gt('open_qty', 0).range(f, t)),
      fetchAll<DiscrepancyRow>((f, t) => supabase.from('v_discrepancies').select('*').or('resolution_status.is.null,resolution_status.neq.approved').range(f, t)),
      fetchAll<VsRow>((f, t) => supabase.from('v_vs_latest').select('*').range(f, t)),
    ]).then(([legs, open, disc, vs]) => setD({ legs, open, disc, vs })).catch((e) => setErr(friendlyError(e)));
  }, []);

  const k = useMemo(() => {
    if (!d) return null;
    const overdue = d.open.filter((r) => r.age_days > a.receiptSla);
    const awaiting = d.legs.filter((l) => l.status === 'awaiting_dispatch');
    const mine = (siteId: number | null) => a.isHO || (siteId != null && a.mySiteIds.includes(siteId));
    const needReason = d.disc.filter((x) => (x.resolution_status === null || x.resolution_status === 'rejected') && mine(x.responsible_site_id));
    const pending = d.disc.filter((x) => x.resolution_status === 'pending');
    const valueKnown = d.open.some((r) => r.cost != null);
    return {
      openQty: sum(d.open, (r) => r.open_qty),
      openValue: sum(d.open, (r) => r.open_qty * (r.cost ?? 0)),
      valueKnown,
      openStvs: new Set(d.open.map((r) => r.stv_id)).size,
      openLines: d.open.length,
      overdueQty: sum(overdue, (r) => r.open_qty),
      overdueStvs: new Set(overdue.map((r) => r.stv_id)).size,
      oldest: Math.max(0, ...d.open.map((r) => r.age_days)),
      awaiting: awaiting.length,
      awaitingLate: awaiting.filter((l) => (l.days_waiting_dispatch ?? 0) > a.dispatchSla).length,
      needReason: needReason.length,
      pending: pending.length,
      vsQty: sum(d.vs, (r) => r.erp_qty),
      vsValue: sum(d.vs, (r) => r.erp_value ?? 0),
      vsUnexplained: d.vs.filter((r) => r.match_status === 'not_in_system').length,
      vsLocations: new Set(d.vs.map((r) => r.location_code)).size,
    };
  }, [d, a]);

  if (err) return <Alert tone="bad">{err}</Alert>;
  if (!d || !k) return <Spinner />;
  const storeUser = !a.isHO;

  return (
    <div className="space-y-5">
      <PageHeader
        title={storeUser ? `Dashboard - ${a.mySiteIds.map(a.siteName).join(', ')}` : 'Head office dashboard'}
        subtitle={`Today ${fmtDate(kwToday())} · receiving SLA ${a.receiptSla} day(s) · dispatch SLA ${a.dispatchSla} day(s)`}
        actions={!a.isHO || a.isAdmin ? <Link to="/upload" className="btn-primary">⇪ Upload STV</Link> : undefined}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Sitting in allocation stores" value={`${fmtQty(k.openQty)} pcs`} tone="info"
          sub={`${k.openStvs} STVs · ${k.openLines} lines${k.valueKnown ? ` · ${fmtKwd(k.openValue)}` : ''}`} onClick={() => nav('/in-transit')} />
        <Stat label={`Overdue > ${a.receiptSla}d (not received)`} value={`${fmtQty(k.overdueQty)} pcs`} tone={k.overdueQty ? 'bad' : 'good'}
          sub={`${k.overdueStvs} STVs · oldest ${k.oldest} days`} onClick={() => nav('/in-transit?overdue=1')} />
        <Stat label="Plans awaiting dispatch" value={k.awaiting} tone={k.awaitingLate ? 'warn' : 'neutral'}
          sub={`${k.awaitingLate} late (> ${a.dispatchSla} days)`} onClick={() => nav('/allocations?status=awaiting_dispatch')} />
        <Stat label={storeUser ? 'Lines needing my reason' : 'Lines needing a reason'} value={k.needReason} tone={k.needReason ? 'warn' : 'good'}
          sub="short / wrong / not received" onClick={() => nav('/discrepancies')} />
        <Stat label="Awaiting HO approval" value={k.pending} tone={k.pending ? 'purple' : 'neutral'} sub="explanations sent by stores" onClick={() => nav('/discrepancies?tab=pending')} />
        <Stat label="Virtual stores (ERP report)" value={k.vsLocations ? `${fmtQty(k.vsQty)} pcs` : '–'} tone={k.vsUnexplained ? 'bad' : 'neutral'}
          sub={k.vsLocations ? `${k.vsUnexplained} SKUs not explained${k.vsValue ? ` · ${fmtKwd(k.vsValue)}` : ''}` : 'no ERP snapshot uploaded yet'} onClick={() => nav('/virtual-stores')} />
      </div>

      {storeUser && <StoreTasks d={d} />}

      <div className="grid gap-5 xl:grid-cols-5">
        <Card title="How long stock has been waiting in Allocation stores (by receiving store)" className="xl:col-span-3">
          <AgingChart rows={d.open} />
        </Card>
        <Card title="Oldest open transfers" className="xl:col-span-2" pad={false}>
          <OldestTransfers rows={d.open} />
        </Card>
      </div>

      <Card title="Store scorecard - allocations planned in the last 30 days" pad={false}>
        <Scorecard legs={d.legs} open={d.open} />
      </Card>
    </div>
  );
}

function AgingChart({ rows }: { rows: DispatchItemRow[] }) {
  const a = useAuth();
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const bySite = useMemo(() => {
    const m = new Map<number, { total: number; buckets: Record<string, { qty: number; lines: number }> }>();
    for (const r of rows) {
      const e = m.get(r.to_site_id) ?? { total: 0, buckets: {} };
      const b = ageBucket(r.age_days).key;
      e.buckets[b] = { qty: (e.buckets[b]?.qty ?? 0) + Number(r.open_qty), lines: (e.buckets[b]?.lines ?? 0) + 1 };
      e.total += Number(r.open_qty);
      m.set(r.to_site_id, e);
    }
    return [...m.entries()].sort((x, y) => y[1].total - x[1].total);
  }, [rows]);
  if (!bySite.length) return <div className="p-6 text-center text-sm text-green-700">✔ Nothing is waiting in an Allocation store.</div>;
  const max = Math.max(...bySite.map(([, e]) => e.total));

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-slate-600" aria-label="Legend">
        {AGE_BUCKETS.map((b) => (
          <span key={b.key} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: b.color }} />{b.label}</span>
        ))}
      </div>
      <div className="space-y-3">
        {bySite.map(([site, e]) => (
          <div key={site} className="grid grid-cols-[90px_1fr_90px] items-center gap-2">
            <div className="truncate text-sm font-medium text-slate-700">{a.siteName(site)}</div>
            <div className="flex h-6 gap-[2px]" style={{ width: `${Math.max(4, (e.total / max) * 100)}%` }}>
              {AGE_BUCKETS.map((b, i) => {
                const v = e.buckets[b.key];
                if (!v) return null;
                const last = !AGE_BUCKETS.slice(i + 1).some((n) => e.buckets[n.key]);
                return (
                  <div key={b.key} className={`h-full min-w-[3px] ${last ? 'rounded-r' : ''}`}
                    style={{ flexGrow: v.qty, background: b.color }}
                    onMouseMove={(ev) => {
                      const box = (ev.currentTarget.closest('.relative') as HTMLElement).getBoundingClientRect();
                      setHover({ x: ev.clientX - box.left, y: ev.clientY - box.top, text: `${a.siteName(site)} · ${b.label}\n${fmtQty(v.qty)} pcs on ${v.lines} line(s)` });
                    }} />
                );
              })}
            </div>
            <div className="text-right text-sm tabular-nums text-slate-700">{fmtQty(e.total)}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">Pieces dispatched but not yet moved into the receiving D.S. Older = darker. Everything past the SLA should be chased.</p>
      {hover && (
        <div className="pointer-events-none absolute z-10 whitespace-pre rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow"
          style={{ left: hover.x + 12, top: hover.y + 12 }}>{hover.text}</div>
      )}
    </div>
  );
}

function OldestTransfers({ rows }: { rows: DispatchItemRow[] }) {
  const a = useAuth();
  const stvs = useMemo(() => {
    const m = new Map<string, { id: string; doc: string; date: string; age: number; from: number; to: number; qty: number; lines: number; partial: boolean }>();
    for (const r of rows) {
      const e = m.get(r.stv_id) ?? { id: r.stv_id, doc: r.doc_no, date: r.stv_date, age: r.age_days, from: r.from_site_id, to: r.to_site_id, qty: 0, lines: 0, partial: false };
      e.qty += Number(r.open_qty);
      e.lines += 1;
      e.partial ||= Number(r.received_qty) > 0;
      m.set(r.stv_id, e);
    }
    return [...m.values()].sort((x, y) => y.age - x.age).slice(0, 8);
  }, [rows]);
  if (!stvs.length) return <div className="p-6 text-center text-sm text-green-700">✔ No open transfers.</div>;
  return (
    <table className="w-full">
      <thead><tr><th className="th">STV</th><th className="th">Route</th><th className="th text-right">Age</th><th className="th text-right">Open pcs</th></tr></thead>
      <tbody>
        {stvs.map((s) => (
          <tr key={s.id} className="hover:bg-slate-50">
            <td className="td whitespace-nowrap"><Link className="link font-mono" to={`/stvs/${s.id}`}>{s.doc}</Link><div className="text-xs text-slate-500">{fmtDate(s.date)}</div></td>
            <td className="td text-sm">{a.siteName(s.from)} → {a.siteName(s.to)} {s.partial && <Badge tone="warn">partly</Badge>}</td>
            <td className="td num"><Badge tone={s.age > a.receiptSla ? 'bad' : 'info'}>{s.age} d</Badge></td>
            <td className="td num">{fmtQty(s.qty)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Scorecard({ legs, open }: { legs: LegRow[]; open: DispatchItemRow[] }) {
  const a = useAuth();
  const since = addDays(kwToday(), -30);
  const recent = legs.filter((l) => l.plan_date >= since);
  const rows = a.sites.filter((s) => s.active).map((s) => {
    const out = recent.filter((l) => l.from_site_id === s.id);
    const outSent = out.filter((l) => l.status !== 'awaiting_dispatch');
    const inc = recent.filter((l) => l.to_site_id === s.id && l.status !== 'awaiting_dispatch');
    const done = inc.filter((l) => l.completed_date && l.first_dispatch_date);
    const openHere = open.filter((r) => r.to_site_id === s.id);
    return {
      s,
      plansOut: out.length,
      awaiting: out.length - outSent.length,
      fill: fmtPct(sum(outSent, (l) => Math.min(l.dispatched_qty, l.planned_qty)), sum(outSent, (l) => l.planned_qty)),
      skuFill: fmtPct(sum(outSent, (l) => l.dispatched_skus), sum(outSent, (l) => l.planned_skus)),
      issues: sum(out, (l) => l.open_issues),
      inc: inc.length,
      recv: fmtPct(sum(inc, (l) => l.received_qty), sum(inc, (l) => l.dispatched_qty)),
      avgDays: done.length ? (sum(done, (l) => daysBetween(l.first_dispatch_date!, l.completed_date!)) / done.length).toFixed(1) : '–',
      openQty: sum(openHere, (r) => r.open_qty),
      oldest: openHere.length ? Math.max(...openHere.map((r) => r.age_days)) : null,
    };
  }).filter((r) => a.isHO || a.mySiteIds.includes(r.s.id) || r.plansOut || r.inc);
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr>
            <th className="th whitespace-normal">Store</th>
            <th className="th whitespace-normal text-right" title="Allocation legs this store had to send">Plans to send</th>
            <th className="th whitespace-normal text-right">Not dispatched</th>
            <th className="th whitespace-normal text-right" title="Dispatched qty / planned qty (capped at plan)">Qty fill %</th>
            <th className="th whitespace-normal text-right" title="SKUs dispatched / SKUs planned">SKU fill %</th>
            <th className="th whitespace-normal text-right">Open send issues</th>
            <th className="th whitespace-normal text-right">Transfers received</th>
            <th className="th whitespace-normal text-right" title="Received qty / dispatched qty">Received %</th>
            <th className="th whitespace-normal text-right" title="From dispatch to fully received">Avg days to receive</th>
            <th className="th whitespace-normal text-right">Waiting now (pcs)</th>
            <th className="th whitespace-normal text-right">Oldest (days)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.s.id} className="hover:bg-slate-50">
              <td className="td font-medium">{r.s.name}</td>
              <td className="td num">{r.plansOut || '–'}</td>
              <td className="td num">{r.awaiting ? <Badge tone="warn">{r.awaiting}</Badge> : '–'}</td>
              <td className="td num">{r.fill}</td>
              <td className="td num">{r.skuFill}</td>
              <td className="td num">{r.issues ? <Badge tone="bad">{r.issues}</Badge> : '–'}</td>
              <td className="td num">{r.inc || '–'}</td>
              <td className="td num">{r.recv}</td>
              <td className="td num">{r.avgDays}</td>
              <td className="td num">{r.openQty ? fmtQty(r.openQty) : '–'}</td>
              <td className="td num">{r.oldest == null ? '–' : <Badge tone={r.oldest > a.receiptSla ? 'bad' : 'info'}>{r.oldest}</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StoreTasks({ d }: { d: Data }) {
  const a = useAuth();
  const toSend = d.legs.filter((l) => l.status === 'awaiting_dispatch' && a.mySiteIds.includes(l.from_site_id));
  const incoming = useMemo(() => {
    const m = new Map<string, { id: string; doc: string; date: string; age: number; from: number; qty: number }>();
    d.open.filter((r) => a.mySiteIds.includes(r.to_site_id)).forEach((r) => {
      const e = m.get(r.stv_id) ?? { id: r.stv_id, doc: r.doc_no, date: r.stv_date, age: r.age_days, from: r.from_site_id, qty: 0 };
      e.qty += Number(r.open_qty);
      m.set(r.stv_id, e);
    });
    return [...m.values()].sort((x, y) => y.age - x.age);
  }, [d.open, a.mySiteIds]);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title={`To dispatch (${toSend.length})`} pad={false}>
        {toSend.length === 0 ? <div className="p-4 text-sm text-green-700">✔ Nothing waiting to be sent.</div> : (
          <table className="w-full"><tbody>
            {toSend.map((l) => (
              <tr key={l.leg_id} className="hover:bg-slate-50">
                <td className="td"><Link className="link" to={`/allocations/${l.allocation_id}?leg=${l.leg_id}`}>{l.ref}</Link> → <b>{a.siteName(l.to_site_id)}</b></td>
                <td className="td text-sm text-slate-500">{fmtDate(l.plan_date)}</td>
                <td className="td num text-sm">{l.planned_skus} SKUs · {fmtQty(l.planned_qty)} pcs</td>
                <td className="td num">{(l.days_waiting_dispatch ?? 0) > a.dispatchSla ? <Badge tone="bad">{l.days_waiting_dispatch} d late</Badge> : <Badge>{l.days_waiting_dispatch} d</Badge>}</td>
              </tr>
            ))}
          </tbody></table>
        )}
      </Card>
      <Card title={`To receive - post Allocation → D.S and upload (${incoming.length})`} pad={false}>
        {incoming.length === 0 ? <div className="p-4 text-sm text-green-700">✔ Nothing waiting in your Allocation store.</div> : (
          <table className="w-full"><tbody>
            {incoming.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="td"><Link className="link font-mono" to={`/stvs/${s.id}`}>{s.doc}</Link> from <b>{a.siteName(s.from)}</b></td>
                <td className="td text-sm text-slate-500">{fmtDate(s.date)}</td>
                <td className="td num text-sm">{fmtQty(s.qty)} pcs open</td>
                <td className="td num"><Badge tone={s.age > a.receiptSla ? 'bad' : 'info'}>{s.age} d</Badge></td>
              </tr>
            ))}
          </tbody></table>
        )}
      </Card>
    </div>
  );
}
