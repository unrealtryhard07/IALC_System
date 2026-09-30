import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable } from '../components/DataTable';
import { LegTable } from '../components/LegProgress';
import { Alert, Badge, Card, PageHeader, SiteSelect, Spinner, Tabs } from '../components/ui';
import { groupLegs, type AllocationSummary } from '../lib/allocations';
import { useAuth } from '../lib/auth';
import { addDays, fmtDate, fmtPct, fmtQty, kwToday } from '../lib/format';
import { LEG_STATUS } from '../lib/labels';
import { fetchAll, friendlyError, supabase } from '../lib/supabase';
import type { LegRow, LegStatus } from '../lib/types';

export default function Allocations() {
  const a = useAuth();
  const [params, setParams] = useSearchParams();
  const [legs, setLegs] = useState<LegRow[] | null>(null);
  const [err, setErr] = useState('');
  const [from, setFrom] = useState(addDays(kwToday(), -60));
  const [site, setSite] = useState<number | ''>('');
  const [kind, setKind] = useState('');
  const [showDone, setShowDone] = useState(true);
  const status = (params.get('status') ?? '') as LegStatus | '';
  const isStore = a.profile?.role === 'store';
  type View = 'in' | 'out' | 'plans' | 'stores';
  const view = (params.get('tab') as View) || (isStore ? 'in' : 'plans');
  const setView = (v: View) => { const p = new URLSearchParams(params); p.set('tab', v); setParams(p); };

  useEffect(() => {
    setLegs(null);
    fetchAll<LegRow>((f, t) => supabase.from('v_legs').select('*').gte('plan_date', from).order('plan_date', { ascending: false }).range(f, t))
      .then(setLegs).catch((e) => setErr(friendlyError(e)));
  }, [from]);

  // per-store tracker rows (one row per sending store -> receiving store)
  const legRows = useMemo(() => (legs ?? []).filter((l) =>
    (view === 'in' ? a.mySiteIds.includes(l.to_site_id) : view === 'out' ? a.mySiteIds.includes(l.from_site_id) : true) &&
    (!site || l.from_site_id === site || l.to_site_id === site) && (!kind || l.kind === kind) && (!status || l.status === status) &&
    (showDone || !['completed', 'cancelled'].includes(l.status))), [legs, view, a.mySiteIds, site, kind, status, showDone]);

  const rows = useMemo(() => {
    let r = groupLegs(legs ?? []);
    if (site) r = r.filter((x) => x.from_site_id === site || x.legs.some((l) => l.to_site_id === site));
    if (kind) r = r.filter((x) => x.kind === kind);
    if (status) r = r.filter((x) => x.legs.some((l) => l.status === status));
    return r;
  }, [legs, site, kind, status]);

  return (
    <div>
      <PageHeader title={isStore ? 'My allocations' : 'Allocation tracker'}
        subtitle={isStore ? 'Every allocation coming to your store or going out of it, and where it is right now.' : 'Every allocation, from plan to fully received. View it per plan or per store.'}
        actions={a.isAdmin && <Link to="/allocations/new" className="btn-primary">+ Upload a transfer plan</Link>} />
      <Tabs value={view} onChange={setView} tabs={isStore
        ? [{ value: 'in', label: `📥 Coming to me (${(legs ?? []).filter((l) => a.mySiteIds.includes(l.to_site_id) && !['completed', 'cancelled'].includes(l.status)).length} open)` },
           { value: 'out', label: `📤 Sending out (${(legs ?? []).filter((l) => a.mySiteIds.includes(l.from_site_id) && !['completed', 'cancelled'].includes(l.status)).length} open)` }]
        : [{ value: 'plans', label: 'By plan' }, { value: 'stores', label: 'By store (every route)' }]} />
      {err && <Alert tone="bad">{err}</Alert>}
      {(view === 'in' || view === 'out' || view === 'stores') && (
        <Card pad={false}>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm">
            <label className="text-xs text-slate-500">Planned since <input type="date" className="input ml-1 w-auto" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            {view === 'stores' && <SiteSelect value={site} onChange={setSite} sites={a.sites} />}
            <select className="input w-auto" value={status} onChange={(e) => { const p = new URLSearchParams(params); if (e.target.value) p.set('status', e.target.value); else p.delete('status'); setParams(p); }}>
              <option value="">Any status</option>
              {Object.entries(LEG_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> show finished</label>
          </div>
          {!legs ? <Spinner /> : <LegTable legs={legRows} perspective={view === 'stores' ? 'all' : view} exportName={`allocations_${view}_${kwToday()}`}
            empty={view === 'in' ? 'Nothing is planned to come to your store.' : view === 'out' ? 'Your store has nothing to send.' : 'No allocations.'} />}
        </Card>
      )}
      {view === 'plans' && <Card pad={false}>
        {!legs ? <Spinner /> : (
          <DataTable<AllocationSummary>
            rows={rows}
            rowKey={(r) => r.allocation_id}
            exportName={`allocations_${kwToday()}`}
            searchPlaceholder="Search ref, title…"
            toolbar={<>
              <label className="text-xs text-slate-500">Plans since <input type="date" className="input ml-1 w-auto" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <SiteSelect value={site} onChange={setSite} sites={a.sites} />
              <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">DC + store-to-store</option><option value="dc">From DC</option><option value="internal">Store to store</option>
              </select>
              <select className="input w-auto" value={status} onChange={(e) => { const p = new URLSearchParams(params); if (e.target.value) p.set('status', e.target.value); else p.delete('status'); setParams(p); }}>
                <option value="">Any status</option>
                {Object.entries(LEG_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </>}
            columns={[
              { key: 'ref', header: 'Plan', value: (r) => r.ref, render: (r) => <Link className="link font-medium" to={`/allocations/${r.allocation_id}`}>{r.ref}</Link> },
              { key: 'kind', header: 'Type', value: (r) => (r.kind === 'dc' ? 'From DC' : 'Store to store'), render: (r) => <Badge tone={r.kind === 'dc' ? 'purple' : 'info'}>{r.kind === 'dc' ? 'From DC' : 'Store to store'}</Badge> },
              { key: 'from', header: 'From', value: (r) => a.siteName(r.from_site_id) },
              { key: 'date', header: 'Plan date', value: (r) => r.plan_date, render: (r) => fmtDate(r.plan_date) },
              { key: 'dest', header: 'To stores', value: (r) => r.legs.map((l) => `${a.siteName(l.to_site_id)}: ${LEG_STATUS[l.status].label}`).join('; '),
                render: (r) => <div className="flex flex-wrap gap-1">{r.legs.map((l) => <Badge key={l.leg_id} tone={LEG_STATUS[l.status].tone} title={LEG_STATUS[l.status].label}>{a.siteName(l.to_site_id)}</Badge>)}</div> },
              { key: 'psku', header: 'Items', align: 'right', value: (r) => r.planned_skus },
              { key: 'pqty', header: 'Planned pcs', align: 'right', value: (r) => r.planned_qty, render: (r) => fmtQty(r.planned_qty) },
              { key: 'dqty', header: 'Sent', align: 'right', value: (r) => r.dispatched_qty, render: (r) => <>{fmtQty(r.dispatched_qty)} <span className="text-xs text-slate-400">{fmtPct(r.dispatched_qty, r.planned_qty)}</span></> },
              { key: 'rqty', header: 'Received', align: 'right', value: (r) => r.received_qty, render: (r) => <>{fmtQty(r.received_qty)} <span className="text-xs text-slate-400">{fmtPct(r.received_qty, r.dispatched_qty)}</span></> },
              { key: 'issues', header: 'Problems', align: 'right', value: (r) => r.open_issues, render: (r) => (r.open_issues ? <Badge tone="bad">{r.open_issues}</Badge> : '–') },
              { key: 'status', header: 'Status', value: (r) => LEG_STATUS[r.status].label, render: (r) => <Badge tone={LEG_STATUS[r.status].tone}>{LEG_STATUS[r.status].label}</Badge> },
            ]}
          />
        )}
      </Card>}
    </div>
  );
}
