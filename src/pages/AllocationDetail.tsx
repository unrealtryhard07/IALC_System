import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { DataTable } from '../components/DataTable';
import { DecideModal, ExplainModal, ResolutionBadge, type ResolveTarget } from '../components/Resolution';
import { Alert, Badge, Card, Field, Modal, PageHeader, Spinner, Stat, Tabs } from '../components/ui';
import { useAuth } from '../lib/auth';
import { downloadExcel } from '../lib/excel';
import { fmtDate, fmtDateTime, fmtKwd, fmtPct, fmtQty } from '../lib/format';
import { DIRECTION, DISPATCH_STATUS, LEG_STATUS } from '../lib/labels';
import { fetchAll, friendlyError, openDocument, rpc, supabase } from '../lib/supabase';
import type { LegItemRow, LegRow, StvRow } from '../lib/types';

interface AllocationRow { id: string; ref: string; kind: string; notes: string | null; title: string | null; source_file: string | null; status: string; cancel_reason: string | null; cancelled_at: string | null; created_at: string; plan_date: string; from_site_id: number }

export default function AllocationDetail() {
  const { id } = useParams();
  const a = useAuth();
  const [params, setParams] = useSearchParams();
  const [alloc, setAlloc] = useState<AllocationRow | null>(null);
  const [legs, setLegs] = useState<LegRow[] | null>(null);
  const [items, setItems] = useState<LegItemRow[] | null>(null);
  const [stvs, setStvs] = useState<StvRow[]>([]);
  const [err, setErr] = useState('');
  const [explain, setExplain] = useState<{ targets: ResolveTarget[]; mode: 'explain' | 'close' } | null>(null);
  const [decide, setDecide] = useState<{ ids: string[]; approve: boolean } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const legId = params.get('leg') ?? legs?.[0]?.leg_id ?? '';

  const load = useCallback(async () => {
    try {
      const [al, lg] = await Promise.all([
        supabase.from('allocations').select('*').eq('id', id!).maybeSingle(),
        supabase.from('v_legs').select('*').eq('allocation_id', id!).order('to_site_id'),
      ]);
      if (al.error) throw al.error;
      if (!al.data) throw new Error('Allocation not found or you do not have access to it.');
      setAlloc(al.data as AllocationRow);
      setLegs((lg.data as LegRow[]) ?? []);
    } catch (e) { setErr(friendlyError(e)); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const legRequest = useRef('');
  const loadLeg = useCallback(async () => {
    if (!legId) return;
    legRequest.current = legId;
    setItems(null);
    setStvs([]);
    setSelected(new Set());
    const [li, st] = await Promise.all([
      fetchAll<LegItemRow>((f, t) => supabase.from('v_leg_items').select('*').eq('leg_id', legId).order('item_code').range(f, t)),
      supabase.from('stvs').select('*').eq('leg_id', legId).order('stv_date'),
    ]);
    if (legRequest.current !== legId) return; // user already switched to another destination
    setItems(li);
    setStvs((st.data as StvRow[]) ?? []);
  }, [legId]);
  useEffect(() => { loadLeg(); }, [loadLeg]);

  const leg = legs?.find((l) => l.leg_id === legId);
  const issues = useMemo(() => (items ?? []).filter((i) => ['short', 'not_sent', 'over', 'unplanned'].includes(i.dispatch_status)), [items]);
  if (err) return <Alert tone="bad">{err}</Alert>;
  if (!alloc || !legs) return <Spinner />;

  const canExplain = a.canActFor(alloc.from_site_id);
  const kindOf = (i: LegItemRow) => (i.dispatch_status === 'over' ? 'dispatch_over' : i.dispatch_status === 'unplanned' ? 'unplanned_item' : 'dispatch_short') as ResolveTarget['kind'];
  const toTarget = (i: LegItemRow): ResolveTarget => ({ kind: kindOf(i), leg_id: i.leg_id, stv_id: null, item_code: i.item_code, gap_qty: i.dispatch_gap, label: `${i.item_code} ${i.item_name ?? ''} (${i.dispatch_gap > 0 ? '+' : ''}${fmtQty(i.dispatch_gap)})` });
  const selectedRows = (items ?? []).filter((i) => selected.has(i.item_code));
  const refresh = () => { setExplain(null); setDecide(null); load(); loadLeg(); };

  const exportLeg = () => {
    if (!items || !leg) return;
    downloadExcel(`${alloc.ref}_${a.siteName(leg.to_site_id)}`, [{
      name: `${alloc.ref} to ${a.siteName(leg.to_site_id)}`,
      title: `${alloc.ref} · ${a.siteName(alloc.from_site_id)} → ${a.siteName(leg.to_site_id)} · plan ${fmtDate(alloc.plan_date)}`,
      columns: [{ header: 'Item Code', width: 12 }, { header: 'Item Name', width: 45 }, { header: 'Planned', numFmt: '#,##0.###' }, { header: 'Dispatched', numFmt: '#,##0.###' }, { header: 'Difference', numFmt: '#,##0.###' }, { header: 'Received', numFmt: '#,##0.###' }, { header: 'Still in allocation store', numFmt: '#,##0.###' }, { header: 'Status', width: 16 }, { header: 'Reason', width: 30 }, { header: 'Reason status', width: 14 }, { header: 'Note', width: 30 }],
      rows: items.map((i) => [i.item_code, i.item_name, i.planned_qty, i.dispatched_qty, i.dispatch_gap, i.received_qty, i.open_qty, DISPATCH_STATUS[i.dispatch_status].label, a.reasons.find((r) => r.code === i.reason_code)?.label ?? '', i.resolution_status ?? '', i.resolution_note ?? '']),
    }]);
  };
  const exportPickList = () => {
    if (!items || !leg) return;
    downloadExcel(`PICK_${alloc.ref}_${a.siteName(alloc.from_site_id)}_to_${a.siteName(leg.to_site_id)}`, [{
      name: 'Pick list',
      title: `Pick list ${alloc.ref}: ${a.siteName(alloc.from_site_id)} → ${a.siteName(leg.to_site_id)} (${fmtDate(alloc.plan_date)})`,
      columns: [{ header: 'Item Code', width: 12 }, { header: 'Item Name', width: 50 }, { header: 'Qty to send', numFmt: '#,##0.###' }, { header: 'Picked qty', width: 12 }, { header: 'Remarks', width: 25 }],
      rows: items.filter((i) => i.planned_qty).map((i) => [i.item_code, i.item_name, i.planned_qty, null, null]),
    }]);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${alloc.ref} · ${a.siteName(alloc.from_site_id)}${alloc.kind === 'dc' ? ' (DC)' : ''}`}
        subtitle={<>Plan date {fmtDate(alloc.plan_date)} · created {fmtDateTime(alloc.created_at)}{alloc.title && <> · {alloc.title}</>}</>}
        actions={<>
          {alloc.source_file && <button className="btn-secondary" onClick={() => openDocument(alloc.source_file!).catch((e) => alert(friendlyError(e)))}>Original Excel</button>}
          {a.isAdmin && alloc.status === 'active' && <button className="btn-danger" onClick={() => setCancelOpen(true)}>Cancel plan</button>}
        </>}
      />
      {alloc.status === 'cancelled' && <Alert tone="warn" title="This plan was cancelled">{alloc.cancel_reason} ({fmtDateTime(alloc.cancelled_at)})</Alert>}
      {alloc.notes && <Alert tone="info">{alloc.notes}</Alert>}

      <Tabs value={legId} onChange={(v) => setParams({ leg: v })}
        tabs={legs.map((l) => ({ value: l.leg_id, label: <span className="flex items-center gap-2">→ {a.siteName(l.to_site_id)} <Badge tone={LEG_STATUS[l.status].tone}>{LEG_STATUS[l.status].label}</Badge></span> }))} />

      {leg && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Planned" value={fmtQty(leg.planned_qty)} sub={`${leg.planned_skus} SKUs`} />
            <Stat label="Dispatched" value={fmtQty(leg.dispatched_qty)} sub={`${leg.dispatched_skus} SKUs · ${fmtPct(leg.dispatched_qty, leg.planned_qty)}`} tone={leg.dispatched_qty ? 'info' : 'neutral'} />
            <Stat label="Received" value={fmtQty(leg.received_qty)} sub={`${leg.received_skus} SKUs · ${fmtPct(leg.received_qty, leg.dispatched_qty)}`} tone={leg.received_qty ? 'good' : 'neutral'} />
            <Stat label="Still in allocation store" value={fmtQty(leg.open_qty)} sub={leg.open_value ? fmtKwd(leg.open_value) : undefined} tone={leg.open_qty ? 'warn' : 'good'} />
            <Stat label="Open issues" value={leg.open_issues} sub={`${leg.pending_issues} awaiting HO`} tone={leg.open_issues ? 'bad' : 'good'} />
          </div>

          <Card title="STVs for this destination" pad={false}>
            {stvs.length === 0 ? <div className="p-4 text-sm text-slate-500">No dispatch STV uploaded yet{leg.days_waiting_dispatch != null && <> - waiting {leg.days_waiting_dispatch} day(s)</>}.</div> : (
              <table className="w-full"><tbody>
                {stvs.map((s) => (
                  <tr key={s.id}>
                    <td className="td"><Link className="link font-mono" to={`/stvs/${s.id}`}>{s.doc_no}</Link></td>
                    <td className="td">{fmtDate(s.stv_date)}</td>
                    <td className="td"><Badge tone={DIRECTION[s.direction].tone}>{DIRECTION[s.direction].label}</Badge></td>
                    <td className="td num">{s.line_count} lines · {fmtQty(s.total_qty)} pcs</td>
                    <td className="td text-sm text-slate-500">uploaded {fmtDateTime(s.uploaded_at)}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </Card>

          {issues.length > 0 && (
            <Alert tone="warn" title={`${issues.length} line(s) differ from the plan`}>
              {canExplain ? 'Select them below and give a reason - head office then approves or rejects.' : `${a.siteName(alloc.from_site_id)} has to explain these lines.`}
            </Alert>
          )}

          <Card pad={false} title="Line by line" actions={<>
            {canExplain && <button className="btn-secondary btn-sm" onClick={exportPickList}>⬇ Pick list</button>}
            <button className="btn-secondary btn-sm" onClick={exportLeg}>⬇ Excel</button>
          </>}>
            {!items ? <Spinner /> : (
              <DataTable<LegItemRow>
                rows={items}
                rowKey={(r) => r.item_code}
                selectable={alloc.status === 'active'}
                isSelectable={(r) => ['short', 'not_sent', 'over', 'unplanned'].includes(r.dispatch_status) && r.resolution_status !== 'approved'}
                selected={selected}
                onSelectedChange={setSelected}
                initialSort={{ key: 'status', dir: 1 }}
                toolbar={selected.size > 0 && <>
                  {canExplain && <button className="btn-primary btn-sm" onClick={() => setExplain({ targets: selectedRows.map(toTarget), mode: 'explain' })}>Explain {selected.size}</button>}
                  {a.isAdmin && <button className="btn-secondary btn-sm" onClick={() => setExplain({ targets: selectedRows.map(toTarget), mode: 'close' })}>Close as HO</button>}
                  {a.isAdmin && selectedRows.some((r) => r.resolution_status === 'pending') && <>
                    <button className="btn-secondary btn-sm" onClick={() => setDecide({ ids: selectedRows.filter((r) => r.resolution_status === 'pending').map((r) => r.resolution_id!), approve: true })}>Approve</button>
                    <button className="btn-secondary btn-sm" onClick={() => setDecide({ ids: selectedRows.filter((r) => r.resolution_status === 'pending').map((r) => r.resolution_id!), approve: false })}>Reject</button>
                  </>}
                </>}
                columns={[
                  { key: 'code', header: 'Item', value: (r) => r.item_code, className: 'font-mono text-xs' },
                  { key: 'name', header: 'Name', value: (r) => r.item_name, className: 'min-w-[220px]' },
                  { key: 'planned', header: 'Planned', align: 'right', value: (r) => r.planned_qty, render: (r) => fmtQty(r.planned_qty) },
                  { key: 'disp', header: 'Dispatched', align: 'right', value: (r) => r.dispatched_qty, render: (r) => fmtQty(r.dispatched_qty) },
                  { key: 'gap', header: 'Diff', align: 'right', value: (r) => r.dispatch_gap, render: (r) => r.leg_dispatched ? <span className={r.dispatch_gap < 0 ? 'text-red-700' : r.dispatch_gap > 0 ? 'text-violet-700' : 'text-slate-400'}>{r.dispatch_gap > 0 ? '+' : ''}{fmtQty(r.dispatch_gap)}</span> : '–' },
                  { key: 'recv', header: 'Received', align: 'right', value: (r) => r.received_qty, render: (r) => fmtQty(r.received_qty) },
                  { key: 'open', header: 'In allocation store', align: 'right', value: (r) => r.open_qty, render: (r) => (r.open_qty ? <b className="text-amber-700">{fmtQty(r.open_qty)}</b> : '–') },
                  { key: 'status', header: 'Status', value: (r) => ['not_sent', 'unplanned', 'short', 'over', 'awaiting_dispatch', 'ok'].indexOf(r.dispatch_status), render: (r) => { const s = DISPATCH_STATUS[r.dispatch_status]; return <Badge tone={s.tone}>{s.label}</Badge>; } },
                  { key: 'res', header: 'Reason', value: (r) => r.resolution_status ?? (['short', 'not_sent', 'over', 'unplanned'].includes(r.dispatch_status) ? 'needs reason' : ''),
                    render: (r) => (['short', 'not_sent', 'over', 'unplanned'].includes(r.dispatch_status) ? <ResolutionBadge status={r.resolution_status} reason={r.reason_code} note={r.resolution_note} /> : null) },
                ]}
              />
            )}
          </Card>
        </>
      )}
      {explain && <ExplainModal targets={explain.targets} mode={explain.mode} onClose={() => setExplain(null)} onDone={refresh} />}
      {decide && <DecideModal ids={decide.ids} approve={decide.approve} onClose={() => setDecide(null)} onDone={refresh} />}
      {cancelOpen && <CancelModal id={alloc.id} onClose={() => setCancelOpen(false)} onDone={() => { setCancelOpen(false); load(); }} />}
    </div>
  );
}

function CancelModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  return (
    <Modal open title="Cancel allocation plan" onClose={onClose} footer={<>
      <button className="btn-secondary" onClick={onClose}>Keep</button>
      <button className="btn-danger" onClick={() => rpc('cancel_allocation', { p_id: id, p_reason: reason }).then(onDone).catch((e) => setErr(friendlyError(e)))}>Cancel plan</button>
    </>}>
      <Field label="Reason"><textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <p className="mt-2 text-xs text-slate-500">STVs already uploaded stay in the system; their plan discrepancies are no longer counted.</p>
      {err && <div className="mt-2"><Alert tone="bad">{err}</Alert></div>}
    </Modal>
  );
}
