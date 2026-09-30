import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable } from '../components/DataTable';
import { DecideModal, ExplainModal, ResolutionBadge, type ResolveTarget } from '../components/Resolution';
import { Alert, Badge, Card, PageHeader, SiteSelect, Spinner, Tabs } from '../components/ui';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtQty, kwToday } from '../lib/format';
import { DISC_KIND } from '../lib/labels';
import { fetchAll, friendlyError, supabase } from '../lib/supabase';
import type { DiscKind, DiscrepancyRow } from '../lib/types';

type Tab = 'open' | 'pending' | 'closed';
const keyOf = (r: DiscrepancyRow) => `${r.kind}|${r.leg_id ?? ''}|${r.stv_id ?? ''}|${r.item_code}`;

export default function Discrepancies() {
  const a = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'open';
  const [rows, setRows] = useState<DiscrepancyRow[] | null>(null);
  const [err, setErr] = useState('');
  const [kind, setKind] = useState<DiscKind | ''>('');
  const [site, setSite] = useState<number | ''>('');
  const [mineOnly, setMineOnly] = useState(!a.isHO);
  const [showNotReceived, setShowNotReceived] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [explain, setExplain] = useState<{ targets: ResolveTarget[]; mode: 'explain' | 'close' } | null>(null);
  const [decide, setDecide] = useState<{ ids: string[]; approve: boolean } | null>(null);
  const [hoNotes, setHoNotes] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setRows(null);
    setSelected(new Set());
    fetchAll<DiscrepancyRow>((f, t) => {
      let q = supabase.from('v_discrepancies').select('*').order('event_date');
      if (tab === 'open') q = q.or('resolution_status.is.null,resolution_status.eq.rejected');
      else if (tab === 'pending') q = q.eq('resolution_status', 'pending');
      else q = q.eq('resolution_status', 'approved').gte('event_date', new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10));
      return q.range(f, t);
    }).then(async (r) => {
      setRows(r);
      // head-office notes on rejected explanations, so the store knows what to fix
      const ids = r.filter((x) => x.resolution_status === 'rejected').map((x) => x.resolution_id!);
      const notes: Record<string, string> = {};
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await supabase.from('resolutions').select('id, decision_note').in('id', ids.slice(i, i + 200));
        (data ?? []).forEach((x: { id: string; decision_note: string | null }) => { if (x.decision_note) notes[x.id] = x.decision_note; });
      }
      setHoNotes(notes);
    }).catch((e) => setErr(friendlyError(e)));
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  // transfers not received at all belong to 'Waiting to be received'; hidden here unless asked
  const isWaiting = (r: DiscrepancyRow) => r.kind === 'receipt_short' && Number(r.actual_qty) === 0;
  const waitingCount = (rows ?? []).filter(isWaiting).length;
  const filtered = useMemo(() => (rows ?? []).filter((r) =>
    (showNotReceived || kind === 'receipt_short' || !isWaiting(r)) && (!kind || r.kind === kind) && (!site || r.responsible_site_id === site) && (!mineOnly || a.mySiteIds.includes(r.responsible_site_id))), [rows, kind, site, mineOnly, a.mySiteIds, showNotReceived]);
  const sel = filtered.filter((r) => selected.has(keyOf(r)));
  const toTarget = (r: DiscrepancyRow): ResolveTarget => ({ kind: r.kind, leg_id: r.leg_id, stv_id: r.stv_id, item_code: r.item_code, gap_qty: r.gap_qty, label: `${r.item_code === '*' ? `STV ${r.doc_no}` : `${r.item_code} ${r.item_name ?? ''}`} (${DISC_KIND[r.kind].short})` });
  const refresh = () => { setExplain(null); setDecide(null); load(); };
  const selKinds = new Set(sel.map((r) => r.kind));

  return (
    <div className="space-y-4">
      <PageHeader title={a.isHO ? 'Problems & approvals' : 'Problems to explain'} subtitle={a.isHO ? 'Differences between what was planned, sent and received. The store gives a reason; you approve or reject.' : 'Tick the items, press Explain, choose a reason. Head office will approve it.'} />
      <Tabs value={tab} onChange={(v) => setParams({ tab: v })} tabs={[
        { value: 'open', label: '1. Needs a reason' },
        { value: 'pending', label: '2. Waiting for head office' },
        { value: 'closed', label: '3. Closed' },
      ]} />
      {err && <Alert tone="bad">{err}</Alert>}
      {tab === 'pending' && !a.isAdmin && <Alert tone="info">These explanations are waiting for head office.</Alert>}
      <Card pad={false}>
        {!rows ? <Spinner /> : (
          <DataTable<DiscrepancyRow>
            rows={filtered}
            rowKey={keyOf}
            exportName={`discrepancies_${tab}_${kwToday()}`}
            selectable={tab !== 'closed'}
            isSelectable={(r) => (tab === 'pending' ? a.isAdmin : a.canActFor(r.responsible_site_id))}
            selected={selected}
            onSelectedChange={setSelected}
            empty={tab === 'open' ? '✅ Nothing to explain right now.' : 'Nothing here.'}
            toolbar={<>
              <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value as DiscKind | '')}>
                <option value="">All types</option>
                {Object.entries(DISC_KIND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              {a.isHO ? <SiteSelect value={site} onChange={setSite} sites={a.sites} allLabel="Any responsible store" /> : (
                <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> only lines my store must explain</label>
              )}
              {waitingCount > 0 && tab === 'open' && (
                <label className="flex items-center gap-1 text-xs text-slate-600" title="Transfers nobody has received yet. The store should receive them (upload the receiving STV) rather than explain.">
                  <input type="checkbox" checked={showNotReceived} onChange={(e) => setShowNotReceived(e.target.checked)} /> also show {waitingCount} items not received at all
                </label>
              )}
              {sel.length > 0 && tab === 'open' && <>
                {selKinds.size > 1 && <span className="text-xs text-amber-700">Select one type at a time to explain</span>}
                <button className="btn-primary btn-sm" disabled={selKinds.size > 1} onClick={() => setExplain({ targets: sel.map(toTarget), mode: 'explain' })}>Explain {sel.length}</button>
                {a.isAdmin && <button className="btn-secondary btn-sm" disabled={selKinds.size > 1} onClick={() => setExplain({ targets: sel.map(toTarget), mode: 'close' })}>Close as HO</button>}
              </>}
              {sel.length > 0 && tab === 'pending' && a.isAdmin && <>
                <button className="btn-primary btn-sm" onClick={() => setDecide({ ids: sel.map((r) => r.resolution_id!), approve: true })}>Approve {sel.length}</button>
                <button className="btn-danger btn-sm" onClick={() => setDecide({ ids: sel.map((r) => r.resolution_id!), approve: false })}>Reject</button>
              </>}
            </>}
            columns={[
              { key: 'kind', header: 'Problem', value: (r) => DISC_KIND[r.kind].label, render: (r) => <Badge tone={DISC_KIND[r.kind].who === 'sender' ? 'warn' : 'bad'} title={DISC_KIND[r.kind].help}>{DISC_KIND[r.kind].short}</Badge> },
              { key: 'date', header: 'Date', value: (r) => r.event_date, render: (r) => fmtDate(r.event_date) },
              { key: 'route', header: 'From → To', value: (r) => `${a.siteName(r.from_site_id)} → ${a.siteName(r.to_site_id)}` },
              { key: 'who', header: 'Who explains', value: (r) => a.siteName(r.responsible_site_id), render: (r) => <b>{a.siteName(r.responsible_site_id)}</b> },
              { key: 'ref', header: 'Plan / STV', value: (r) => [r.ref, r.doc_no].filter(Boolean).join(' / '),
                render: (r) => <span className="text-sm">{r.allocation_id ? <Link className="link" to={`/allocations/${r.allocation_id}${r.leg_id ? `?leg=${r.leg_id}` : ''}`}>{r.ref}</Link> : null}{r.ref && r.stv_id ? ' / ' : ''}{r.stv_id ? <Link className="link font-mono" to={`/stvs/${r.stv_id}`}>{r.doc_no}</Link> : null}</span> },
              { key: 'code', header: 'Item', value: (r) => r.item_code, className: 'font-mono text-xs' },
              { key: 'name', header: 'Name', value: (r) => r.item_name, className: 'min-w-[220px]' },
              { key: 'exp', header: 'Expected', align: 'right', value: (r) => r.planned_qty, render: (r) => fmtQty(r.planned_qty) },
              { key: 'act', header: 'Actual', align: 'right', value: (r) => r.actual_qty, render: (r) => fmtQty(r.actual_qty) },
              { key: 'gap', header: 'Difference', align: 'right', value: (r) => r.gap_qty, render: (r) => <b className={Number(r.gap_qty) < 0 ? 'text-red-700' : 'text-violet-700'}>{Number(r.gap_qty) > 0 ? '+' : ''}{fmtQty(r.gap_qty)}</b> },
              { key: 'val', header: 'Value KWD', align: 'right', value: (r) => (r.cost && r.gap_qty ? Number((Math.abs(r.gap_qty) * r.cost).toFixed(3)) : null) },
              { key: 'res', header: 'Reason', value: (r) => [r.resolution_status, a.reasons.find((x) => x.code === r.reason_code)?.label, r.resolution_note].filter(Boolean).join(' - '),
                render: (r) => <div><ResolutionBadge status={r.resolution_status} reason={r.reason_code} note={r.resolution_note} />{r.resolution_note && <div className="mt-0.5 max-w-xs text-xs text-slate-500">{r.resolution_note}</div>}{r.resolution_id && hoNotes[r.resolution_id] && <div className="mt-0.5 max-w-xs text-xs text-red-700">HO: {hoNotes[r.resolution_id]}</div>}</div> },
            ]}
          />
        )}
      </Card>
      {explain && <ExplainModal targets={explain.targets} mode={explain.mode} onClose={() => setExplain(null)} onDone={refresh} />}
      {decide && <DecideModal ids={decide.ids} approve={decide.approve} onClose={() => setDecide(null)} onDone={refresh} />}
    </div>
  );
}
