import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import { LegTable } from '../components/LegProgress';
import { Alert, Badge, Card, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth';
import { AGE_BUCKETS, ageBucket, addDays, daysBetween, fmtDate, fmtKwd, fmtPct, fmtQty, kwToday, sum } from '../lib/format';
import { fetchAll, friendlyError, supabase } from '../lib/supabase';
import type { DiscrepancyRow, DispatchItemRow, LegRow, VsRow } from '../lib/types';

interface Data { legs: LegRow[]; open: DispatchItemRow[]; disc: DiscrepancyRow[]; vs: VsRow[] }

const greeting = () => {
  const h = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kuwait', hour: '2-digit', hour12: false }));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

export default function Dashboard() {
  const a = useAuth();
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
    const mine = (siteId: number | null) => a.isHO || (siteId != null && a.mySiteIds.includes(siteId));
    const stvCount = (rows: DispatchItemRow[]) => new Set(rows.map((r) => r.stv_id)).size;
    const toReceive = d.open.filter((r) => mine(r.to_site_id));
    const late = d.open.filter((r) => r.age_days > a.receiptSla);
    // Not-received-at-all lines are the receiving task (card above), not a separate problem
    const isProblem = (x: DiscrepancyRow) => x.kind !== 'receipt_short' || Number(x.actual_qty) > 0;
    const toSend = d.legs.filter((l) => l.status === 'awaiting_dispatch' && (a.isHO || a.mySiteIds.includes(l.from_site_id)));
    const incoming = d.legs.filter((l) => a.mySiteIds.includes(l.to_site_id) && !['completed', 'cancelled'].includes(l.status));
    return {
      incoming: incoming.length,
      incomingNotSent: incoming.filter((l) => l.status === 'awaiting_dispatch').length,
      incomingOnWay: incoming.filter((l) => l.status === 'in_transit' || l.status === 'partially_received').length,
      toSend: toSend.length,
      toSendLate: toSend.filter((l) => (l.days_waiting_dispatch ?? 0) > a.dispatchSla).length,
      toReceive: stvCount(toReceive),
      toReceiveQty: sum(toReceive, (r) => r.open_qty),
      oldest: Math.max(0, ...toReceive.map((r) => r.age_days)),
      late: stvCount(late),
      lateQty: sum(late, (r) => r.open_qty),
      lateValue: sum(late, (r) => r.open_qty * (r.cost ?? 0)),
      explain: d.disc.filter((x) => isProblem(x) && (x.resolution_status === null || x.resolution_status === 'rejected') && mine(x.responsible_site_id)).length,
      rejected: d.disc.filter((x) => isProblem(x) && x.resolution_status === 'rejected' && mine(x.responsible_site_id)).length,
      approve: d.disc.filter((x) => x.resolution_status === 'pending').length,
      stuckSkus: d.vs.filter((r) => r.match_status === 'not_in_system').length,
      stuckQty: sum(d.vs.filter((r) => r.match_status === 'not_in_system'), (r) => r.erp_qty),
      hasSnapshot: d.vs.length > 0,
    };
  }, [d, a]);

  if (err) return <Alert tone="bad">{err}</Alert>;
  if (!d || !k) return <Spinner />;
  const isStore = a.profile?.role === 'store';
  const storeNames = a.mySiteIds.map(a.siteName).join(' & ');

  const tasks: TaskProps[] = isStore
    ? [
        { icon: 'inbox', count: k.incoming, title: k.incoming === 1 ? 'allocation coming to you' : 'allocations coming to you', text: `${k.incomingNotSent} not sent yet by the sender, ${k.incomingOnWay} on the way to you. See each one and where it is.`, to: '/allocations?tab=in', button: 'Track them', tone: k.incomingOnWay ? 'warn' : 'info' },
        { icon: 'send', count: k.toSend, title: k.toSend === 1 ? 'plan to send' : 'plans to send', text: k.toSendLate ? `${k.toSendLate} are late. Pick the items, make the STV in the ERP, then upload it here.` : 'Pick the items, make the STV in the ERP, then upload it here.', to: '#to-send', button: 'See what to send', tone: k.toSendLate ? 'bad' : 'info' },
        { icon: 'truck', count: k.toReceive, title: k.toReceive === 1 ? 'transfer to receive' : 'transfers to receive', text: k.toReceive ? `${fmtQty(k.toReceiveQty)} pcs are waiting for you (oldest ${k.oldest} days). Count them on your phone, receive them in the ERP (Allocation → D.S) and upload that STV - until then the app cannot sell them.` : 'Nothing is waiting for you.', to: '/receive', button: 'Receive stock', tone: k.oldest > a.receiptSla ? 'bad' : 'info' },
        { icon: 'alert', count: k.explain, title: k.explain === 1 ? 'problem to explain' : 'problems to explain', text: k.rejected ? `${k.rejected} reason(s) were rejected by head office - please explain again.` : 'Items sent short, not sent, or received short. Choose a reason for each.', to: '/discrepancies', button: 'Explain now', tone: k.explain ? 'warn' : 'info' },
      ]
    : [
        { icon: 'checkCircle', count: k.approve, title: k.approve === 1 ? 'explanation to approve' : 'explanations to approve', text: 'Stores gave reasons for short or missing stock. Approve or reject them.', to: '/discrepancies?tab=pending', button: 'Review', tone: k.approve ? 'purple' : 'info' },
        { icon: 'truck', count: k.late, title: 'late receiving', text: k.late ? `${fmtQty(k.lateQty)} pcs sent more than ${a.receiptSla} day(s) ago are still not received${k.lateValue ? ` (${fmtKwd(k.lateValue)})` : ''}. Chase the stores.` : 'Every store received its stock on time.', to: '/in-transit?overdue=1', button: 'See who is late', tone: k.late ? 'bad' : 'info' },
        { icon: 'send', count: k.toSend, title: 'plans not sent yet', text: k.toSendLate ? `${k.toSendLate} are later than ${a.dispatchSla} days.` : 'Plans the sending stores still have to send.', to: '/allocations?status=awaiting_dispatch', button: 'See plans', tone: k.toSendLate ? 'warn' : 'info' },
        { icon: 'alert', count: k.explain, title: 'problems without a reason', text: 'Differences the stores have not explained yet.', to: '/discrepancies', button: 'See problems', tone: k.explain ? 'warn' : 'info' },
        { icon: 'search', count: k.hasSnapshot ? k.stuckSkus : null, title: 'unknown stuck items', text: k.hasSnapshot ? `${fmtQty(k.stuckQty)} pcs sit in the virtual stores with no transfer explaining them.` : 'Upload the ERP stock report of the Allocation stores to find old stuck stock.', to: '/virtual-stores', button: k.hasSnapshot ? 'Check stuck stock' : 'Upload ERP report', tone: k.stuckSkus ? 'bad' : 'info' },
      ];
  const allClear = tasks.every((t) => !t.count);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{greeting()}, {a.profile?.full_name?.split(' ')[0]}</h1>
          <p className="text-slate-500">{isStore ? `Here is what ${storeNames} needs to do today.` : 'Here is what needs your attention today.'} <span className="text-slate-400">· {fmtDate(kwToday())}</span></p>
        </div>
        {isStore && <Link to="/upload" className="btn-primary px-5 py-2.5 text-base"><Icon name="upload" className="h-4 w-4" />Upload STV</Link>}
        {a.isAdmin && <Link to="/allocations/new" className="btn-primary px-5 py-2.5 text-base"><Icon name="upload" className="h-4 w-4" />Upload a transfer plan</Link>}
      </div>

      {a.isAdmin && <SetupChecklist />}

      {allClear && <Alert tone="good" title="All done - nothing needs attention right now" />}
      <div className={`grid gap-4 sm:grid-cols-2 ${isStore ? 'lg:grid-cols-4' : 'lg:grid-cols-3 xl:grid-cols-5'}`}>
        {tasks.map((t) => <TaskCard key={t.title} {...t} />)}
      </div>

      <HowItWorks compact />

      {isStore && (
        <Card title="Allocations coming to your store" pad={false} actions={<Link className="link text-sm" to="/allocations?tab=in">See all →</Link>}>
          <LegTable legs={d.legs.filter((l) => a.mySiteIds.includes(l.to_site_id) && !['completed', 'cancelled'].includes(l.status))} perspective="in" exportName="coming_to_my_store" empty="Nothing is planned to come to your store." />
        </Card>
      )}

      {isStore ? <StoreTasks d={d} /> : (
        <>
          <div className="grid gap-5 xl:grid-cols-5">
            <Card title="Stock waiting to be received - by store and age" className="xl:col-span-3"><AgingChart rows={d.open} /></Card>
            <Card title="Oldest transfers not received" className="xl:col-span-2" pad={false}><OldestTransfers rows={d.open} /></Card>
          </div>
          <Card title="How each store is doing (plans from the last 30 days)" pad={false}><Scorecard legs={d.legs} open={d.open} /></Card>
        </>
      )}
    </div>
  );
}

interface TaskProps { icon: IconName; count: number | null; title: string; text: string; to: string; button: string; tone: 'info' | 'bad' | 'warn' | 'purple' }
function TaskCard({ icon, count, title, text, to, button, tone }: TaskProps) {
  const done = count === 0;
  const ring = done ? 'border-slate-200' : { info: 'border-slate-200', bad: 'border-red-200 ring-1 ring-red-100', warn: 'border-amber-200 ring-1 ring-amber-100', purple: 'border-violet-200 ring-1 ring-violet-100' }[tone];
  const go = to.startsWith('#')
    ? <a href={to} className={done ? 'btn-secondary w-full' : 'btn-primary w-full'}>{button}</a>
    : <Link to={to} className={done ? 'btn-secondary w-full' : 'btn-primary w-full'}>{button}</Link>;
  return (
    <div className={`card flex flex-col p-5 ${ring}`}>
      <div className="flex items-center gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${done ? 'bg-green-50 text-green-600' : 'bg-brand-50 text-brand-600'}`}><Icon name={done ? 'check' : icon} className="h-6 w-6" /></span>
        <div>
          <div className="text-3xl font-bold tabular-nums leading-none">{count ?? '–'}</div>
          <div className="text-sm font-semibold text-slate-700">{title}</div>
        </div>
      </div>
      <p className="my-3 flex-1 text-sm text-slate-600">{done ? 'Nothing to do here.' : text}</p>
      {go}
    </div>
  );
}

export function HowItWorks({ compact }: { compact?: boolean }) {
  const steps: { n: number; title: string; who: string; body: ReactNode }[] = [
    { n: 1, title: 'Head office plans', who: 'Head office', body: 'Uploads the transfer plan Excel (which store sends what to whom).' },
    { n: 2, title: 'Sender sends', who: 'Sending store', body: <>Makes the STV in the ERP <b>(my store → their Allocation)</b> and uploads it here the same day.</> },
    { n: 3, title: 'Receiver receives', who: 'Receiving store', body: <>When goods arrive, makes the STV <b>(my Allocation → my D.S)</b> and uploads it. Only now can the app sell it.</> },
    { n: 4, title: 'Differences explained', who: 'Stores + head office', body: 'Anything short or missing: the store gives a reason, head office approves.' },
  ];
  return (
    <Card title={compact ? 'How it works (4 steps)' : undefined}>
      <ol className="grid gap-3 md:grid-cols-4">
        {steps.map((s) => (
          <li key={s.n} className="flex gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500 font-bold text-white">{s.n}</span>
            <div>
              <div className="font-semibold">{s.title} <span className="text-xs font-normal text-slate-500">· {s.who}</span></div>
              <div className="text-sm text-slate-600">{s.body}</div>
            </div>
          </li>
        ))}
      </ol>
      {!compact && <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900"><b>Why step 3 matters:</b> stock sent to a store first lands in that store's <b>Allocation</b> store - a virtual store the app cannot sell from. If the receiving STV is never made, the stock sits there until it expires. This system makes sure that never happens silently.</p>}
    </Card>
  );
}

function SetupChecklist() {
  const a = useAuth();
  const [s, setS] = useState<{ users: number; items: number; plans: number; unconfirmed: number } | null>(null);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('ialc.setupDone') === '1'; } catch { return false; } });
  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('user_id', { count: 'exact', head: true }).eq('role', 'store'),
      supabase.from('items').select('item_code', { count: 'exact', head: true }),
      supabase.from('allocations').select('id', { count: 'exact', head: true }),
    ]).then(([u, i, p]) => setS({ users: u.count ?? 0, items: i.count ?? 0, plans: p.count ?? 0, unconfirmed: a.locations.filter((l) => l.auto_created).length }));
  }, [a.locations]);
  if (!s || hidden) return null;
  const steps = [
    { done: s.users > 0, label: 'Create a login for each store', to: '/users', button: 'Add store users' },
    { done: s.items > 0, label: 'Upload your items masterlist (Excel)', to: '/items', button: 'Upload masterlist' },
    { done: s.plans > 0, label: 'Upload your first transfer plan (the Excel you send stores)', to: '/allocations/new', button: 'Upload plan' },
    { done: s.unconfirmed === 0, label: 'Confirm new ERP store numbers (found on uploaded STVs)', to: '/settings', button: 'Check store numbers' },
  ];
  const left = steps.filter((x) => !x.done).length;
  if (left === 0) return null;
  return (
    <Card title={`Getting started - ${steps.length - left} of ${steps.length} done`} actions={<button className="btn-ghost btn-sm" onClick={() => { setHidden(true); try { localStorage.setItem('ialc.setupDone', '1'); } catch { /* ignore */ } }}>Hide</button>}>
      <ul className="space-y-2">
        {steps.map((x) => (
          <li key={x.label} className="flex flex-wrap items-center gap-3">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-sm ${x.done ? 'bg-green-600 text-white' : 'border-2 border-slate-300'}`}>{x.done ? <Icon name="check" className="h-3.5 w-3.5" /> : ''}</span>
            <span className={x.done ? 'text-slate-400 line-through' : 'font-medium'}>{x.label}</span>
            {!x.done && <Link to={x.to} className="btn-secondary btn-sm ml-auto">{x.button} →</Link>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function AgingChart({ rows }: { rows: DispatchItemRow[] }) {
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
  if (!bySite.length) return <div className="p-6 text-center text-sm text-green-700">Nothing is waiting in an Allocation store.</div>;
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
      <p className="mt-3 text-xs text-slate-500">Pieces sent but not yet received by the store. Darker = older. Anything older than the receiving deadline should be chased.</p>
      {hover && (
        <div className="pointer-events-none absolute z-10 whitespace-pre rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow"
          style={{ left: hover.x + 12, top: hover.y + 12 }}>{hover.text}</div>
      )}
    </div>
  );
}

export function OldestTransfers({ rows }: { rows: DispatchItemRow[] }) {
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
  if (!stvs.length) return <div className="p-6 text-center text-sm text-green-700">No open transfers.</div>;
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

export function Scorecard({ legs, open }: { legs: LegRow[]; open: DispatchItemRow[] }) {
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
            <th className="th whitespace-normal text-right">Not sent yet</th>
            <th className="th whitespace-normal text-right" title="Dispatched qty / planned qty (capped at plan)">Sent vs plan (pcs)</th>
            <th className="th whitespace-normal text-right" title="SKUs dispatched / SKUs planned">Sent vs plan (items)</th>
            <th className="th whitespace-normal text-right">Problems</th>
            <th className="th whitespace-normal text-right">Transfers received</th>
            <th className="th whitespace-normal text-right" title="Received qty / dispatched qty">Received vs sent</th>
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
    <div id="to-send" className="grid scroll-mt-20 gap-5 lg:grid-cols-2">
      <Card title={`Stock you must send (${toSend.length})`} pad={false}>
        {toSend.length === 0 ? <div className="p-4 text-sm text-green-700">Nothing to send.</div> : (
          <table className="w-full"><tbody>
            {toSend.map((l) => (
              <tr key={l.leg_id} className="hover:bg-slate-50">
                <td className="td"><Link className="link" to={`/allocations/${l.allocation_id}?leg=${l.leg_id}`}>{l.ref}</Link> → <b>{a.siteName(l.to_site_id)}</b></td>
                <td className="td text-sm text-slate-500">{fmtDate(l.plan_date)}</td>
                <td className="td num text-sm">{l.planned_skus} items · {fmtQty(l.planned_qty)} pcs</td>
                <td className="td num">{(l.days_waiting_dispatch ?? 0) > a.dispatchSla ? <Badge tone="bad">{l.days_waiting_dispatch} d late</Badge> : <Badge>{l.days_waiting_dispatch} d</Badge>}</td>
              </tr>
            ))}
          </tbody></table>
        )}
      </Card>
      <Card title={`Stock waiting for you to receive (${incoming.length})`} pad={false}>
        {incoming.length === 0 ? <div className="p-4 text-sm text-green-700">Nothing waiting for you.</div> : (
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
