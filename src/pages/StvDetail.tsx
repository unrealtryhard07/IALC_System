import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DataTable } from '../components/DataTable';
import { ExplainModal, ResolutionBadge, type ResolveTarget } from '../components/Resolution';
import { Alert, Badge, Card, Field, Modal, PageHeader, Spinner, Stat } from '../components/ui';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtDateTime, fmtKwd, fmtQty, sum } from '../lib/format';
import { DIRECTION } from '../lib/labels';
import { fetchAll, friendlyError, openDocument, rpc, supabase } from '../lib/supabase';
import type { DispatchItemRow, StvRow } from '../lib/types';

interface Line { line_no: number; item_code: string; barcode: string | null; item_name: string | null; unit: string | null; qty: number }
interface MatchRow { item_code: string; qty: number; receipt_date: string; receipt_doc_no: string; dispatch_id: string; receipt_id: string }
interface Unmatched { item_code: string; item_name: string | null; qty: number; unmatched_qty: number; resolution_status: 'pending' | 'approved' | 'rejected' | null; reason_code: string | null; resolution_note: string | null }

export default function StvDetail() {
  const { id } = useParams();
  const a = useAuth();
  const [stv, setStv] = useState<StvRow | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [disp, setDisp] = useState<DispatchItemRow[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [unmatched, setUnmatched] = useState<Unmatched[]>([]);
  const [plan, setPlan] = useState<{ allocation_id: string; ref: string } | null>(null);
  const [dispatchDocs, setDispatchDocs] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [voidOpen, setVoidOpen] = useState(false);
  const [explain, setExplain] = useState<{ targets: ResolveTarget[]; mode: 'explain' | 'close' } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [linkOpen, setLinkOpen] = useState(false);
  const [count, setCount] = useState<{ counted_at: string; note: string | null; lines: Record<string, number> } | null>(null);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('stvs').select('*').eq('id', id!).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('STV not found or you do not have access to it.');
      const s = data as StvRow;
      setStv(s);
      setLines(await fetchAll<Line>((f, t) => supabase.from('stv_lines').select('line_no, item_code, barcode, item_name, unit, qty').eq('stv_id', s.id).order('line_no').range(f, t)));
      if (s.direction === 'dispatch' || s.direction === 'direct') {
        setDisp(await fetchAll<DispatchItemRow>((f, t) => supabase.from('v_dispatch_items').select('*').eq('stv_id', s.id).order('item_code').range(f, t)));
        const { data: c } = await supabase.from('receive_counts').select('counted_at, note, receive_count_lines(item_code, counted_qty)').eq('dispatch_id', s.id).maybeSingle();
        const cc = c as { counted_at: string; note: string | null; receive_count_lines: { item_code: string; counted_qty: number }[] } | null;
        setCount(cc ? { counted_at: cc.counted_at, note: cc.note, lines: Object.fromEntries(cc.receive_count_lines.map((l) => [l.item_code, Number(l.counted_qty)])) } : null);
      }
      if (s.direction === 'receipt') {
        const m = await fetchAll<MatchRow>((f, t) => supabase.from('receipt_matches').select('*').eq('receipt_id', s.id).range(f, t));
        setMatches(m);
        const ids = [...new Set(m.map((x) => x.dispatch_id))];
        if (ids.length) {
          const { data: ds } = await supabase.from('stvs').select('id, doc_no').in('id', ids);
          setDispatchDocs(Object.fromEntries((ds ?? []).map((d: { id: string; doc_no: string }) => [d.id, d.doc_no])));
        }
        const { data: u } = await supabase.from('v_unmatched_receipts').select('*').eq('stv_id', s.id);
        setUnmatched((u as Unmatched[]) ?? []);
      }
      if (s.leg_id) {
        const { data: l } = await supabase.from('v_legs').select('allocation_id, ref').eq('leg_id', s.leg_id).maybeSingle();
        setPlan(l as { allocation_id: string; ref: string } | null);
      } else setPlan(null);
    } catch (e) { setErr(friendlyError(e)); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (err) return <Alert tone="bad">{err}</Alert>;
  if (!stv) return <Spinner />;
  const d = DIRECTION[stv.direction];
  const openQty = sum(disp, (r) => r.open_qty);
  const canReceiver = a.canActFor(stv.to_site_id);
  const refresh = () => { setExplain(null); setSelected(new Set()); load(); };

  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="flex items-center gap-2">STV {stv.doc_no} <Badge tone={d.tone}>{d.label}</Badge>{stv.status === 'void' && <Badge tone="bad">VOID</Badge>}</span>}
        subtitle={<>{fmtDate(stv.stv_date)} · {a.locationLabel(stv.from_code)} → {a.locationLabel(stv.to_code)} · {d.help}</>}
        actions={<>
          {stv.direction === 'dispatch' && stv.status === 'active' && canReceiver && openQty > 0 && <Link className="btn-primary" to={`/receive/${stv.id}`}>{count ? 'Open count' : 'Count what arrived'}</Link>}
          {stv.file_path && <button className="btn-secondary" onClick={() => openDocument(stv.file_path!).catch((e) => alert(friendlyError(e)))}>Original file</button>}
          {a.isAdmin && stv.status === 'active' && (stv.direction === 'dispatch' || stv.direction === 'direct') && <button className="btn-secondary" onClick={() => setLinkOpen(true)}>{stv.leg_id ? 'Change plan' : 'Link to plan'}</button>}
          {a.isAdmin && stv.status === 'active' && <button className="btn-danger" onClick={() => setVoidOpen(true)}>Void</button>}
        </>}
      />
      {stv.status === 'void' && <Alert tone="warn" title="This STV was voided and is ignored in all figures">{stv.void_reason}</Alert>}
      {stv.parse_warnings?.length > 0 && <Alert tone="warn">{stv.parse_warnings.join(' ')}</Alert>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Lines" value={stv.line_count} />
        <Stat label="Quantity" value={fmtQty(stv.total_qty)} />
        {(stv.direction === 'dispatch' || stv.direction === 'direct') && <>
          <Stat label="Waiting to be received" value={fmtQty(openQty)} tone={openQty ? 'warn' : 'good'} sub={disp.some((r) => r.cost) ? fmtKwd(sum(disp, (r) => r.open_qty * (r.cost ?? 0))) : undefined} />
          <Stat label="Plan" value={plan ? <Link className="link" to={`/allocations/${plan.allocation_id}`}>{plan.ref}</Link> : 'No plan'} tone={plan ? 'good' : 'purple'} />
        </>}
        {stv.direction === 'receipt' && <>
          <Stat label="Matched to sent STVs" value={fmtQty(sum(matches, (m) => m.qty))} tone="good" />
          <Stat label="Nobody sent this" value={fmtQty(sum(unmatched, (u) => u.unmatched_qty))} tone={unmatched.length ? 'purple' : 'neutral'} />
        </>}
      </div>
      <div className="text-xs text-slate-500">Uploaded {fmtDateTime(stv.uploaded_at)} · source {stv.source}{stv.file_name && <> · {stv.file_name}</>}</div>

      {count && (() => {
        const diffs = disp.filter((r) => (count.lines[r.item_code] ?? 0) !== Number(r.dispatched_qty));
        return <Alert tone={diffs.length ? 'warn' : 'good'} title={`Counted by ${a.siteName(stv.to_site_id)} on ${fmtDateTime(count.counted_at)}`}>
          {diffs.length ? `${diffs.length} line(s) differ from what was sent - see the "Counted" column.` : 'Everything arrived as sent.'}{count.note && <> Note: {count.note}</>}
        </Alert>;
      })()}
      {(stv.direction === 'dispatch' || stv.direction === 'direct') && (
        <Card title="Has each item been received?" pad={false}>
          <DataTable<DispatchItemRow>
            rows={disp}
            rowKey={(r) => r.item_code}
            exportName={`STV_${stv.doc_no}_receipt_status`}
            selectable={canReceiver && stv.status === 'active'}
            isSelectable={(r) => r.raw_open_qty > 0 && r.resolution_status !== 'approved'}
            selected={selected}
            onSelectedChange={setSelected}
            toolbar={selected.size > 0 && <>
              <button className="btn-primary btn-sm" onClick={() => setExplain({ mode: 'explain', targets: disp.filter((r) => selected.has(r.item_code)).map((r) => ({ kind: 'receipt_short', leg_id: null, stv_id: r.stv_id, item_code: r.item_code, gap_qty: -r.raw_open_qty, label: `${r.item_code} ${r.item_name ?? ''} (${fmtQty(r.raw_open_qty)} not received)` })) })}>Explain {selected.size} not received</button>
              {a.isAdmin && <button className="btn-secondary btn-sm" onClick={() => setExplain({ mode: 'close', targets: disp.filter((r) => selected.has(r.item_code)).map((r) => ({ kind: 'receipt_short', leg_id: null, stv_id: r.stv_id, item_code: r.item_code, gap_qty: -r.raw_open_qty })) })}>Close as HO</button>}
            </>}
            columns={[
              { key: 'code', header: 'Item', value: (r) => r.item_code, className: 'font-mono text-xs' },
              { key: 'name', header: 'Name', value: (r) => r.item_name, className: 'min-w-[220px]' },
              { key: 'sent', header: 'Sent', align: 'right', value: (r) => r.dispatched_qty, render: (r) => fmtQty(r.dispatched_qty) },
              ...(count ? [{ key: 'count', header: 'Counted', align: 'right' as const, value: (r: DispatchItemRow) => count.lines[r.item_code] ?? 0,
                render: (r: DispatchItemRow) => { const c = count.lines[r.item_code] ?? 0; return <b className={c < r.dispatched_qty ? 'text-amber-700' : c > r.dispatched_qty ? 'text-violet-700' : 'text-green-700'}>{fmtQty(c)}</b>; } }] : []),
              { key: 'recv', header: 'Received', align: 'right', value: (r) => r.received_qty, render: (r) => fmtQty(r.received_qty) },
              { key: 'open', header: 'Waiting', align: 'right', value: (r) => r.open_qty, render: (r) => (r.open_qty ? <b className="text-amber-700">{fmtQty(r.open_qty)}</b> : '–') },
              { key: 'rdocs', header: 'Received on STV', value: (r) => r.receipt_docs, render: (r) => <span className="font-mono text-xs">{r.receipt_docs ?? '–'}</span> },
              { key: 'rdate', header: 'Received on', value: (r) => r.last_receipt_date, render: (r) => fmtDate(r.last_receipt_date) },
              { key: 'st', header: 'Status', value: (r) => (r.raw_open_qty === 0 ? 'received' : r.resolution_status ?? 'open'),
                render: (r) => (r.raw_open_qty === 0 ? <Badge tone="good">Received</Badge> : r.resolution_status ? <ResolutionBadge status={r.resolution_status} reason={r.reason_code} note={r.resolution_note} /> : <Badge tone={r.age_days > a.receiptSla ? 'bad' : 'info'}>{r.received_qty > 0 ? 'Partly received' : 'In transit'} · {r.age_days} d</Badge>) },
            ]}
          />
        </Card>
      )}

      {stv.direction === 'receipt' && (
        <>
          <Card title="This receives these sent STVs" pad={false}>
            <table className="w-full">
              <thead><tr><th className="th">Dispatch STV</th><th className="th text-right">Items</th><th className="th text-right">Qty received</th></tr></thead>
              <tbody>{Object.entries(matches.reduce<Record<string, { items: Set<string>; qty: number }>>((acc, m) => {
                const g = (acc[m.dispatch_id] ??= { items: new Set(), qty: 0 });
                g.items.add(m.item_code);
                g.qty += Number(m.qty);
                return acc;
              }, {})).map(([dispatchId, g]) => (
                <tr key={dispatchId}>
                  <td className="td"><Link className="link font-mono" to={`/stvs/${dispatchId}`}>{dispatchDocs[dispatchId] ?? '…'}</Link></td>
                  <td className="td num">{g.items.size}</td>
                  <td className="td num">{fmtQty(g.qty)}</td>
                </tr>
              ))}</tbody>
            </table>
            {matches.length === 0 && <div className="p-4 text-sm text-slate-500">Nothing matched yet. If the sender uploads its dispatch STV later, it will match automatically.</div>}
          </Card>
          {unmatched.length > 0 && (
            <Card title="Received, but nobody sent it in the system" pad={false}>
              <DataTable<Unmatched>
                rows={unmatched}
                rowKey={(r) => r.item_code}
                selectable={canReceiver && stv.status === 'active'}
                isSelectable={(r) => r.resolution_status !== 'approved'}
                selected={selected}
                onSelectedChange={setSelected}
                toolbar={selected.size > 0 && <>
                  <button className="btn-primary btn-sm" onClick={() => setExplain({ mode: 'explain', targets: unmatched.filter((r) => selected.has(r.item_code)).map((r) => ({ kind: 'receipt_over', leg_id: null, stv_id: stv.id, item_code: r.item_code, gap_qty: r.unmatched_qty })) })}>Explain {selected.size}</button>
                  {a.isAdmin && <button className="btn-secondary btn-sm" onClick={() => setExplain({ mode: 'close', targets: unmatched.filter((r) => selected.has(r.item_code)).map((r) => ({ kind: 'receipt_over', leg_id: null, stv_id: stv.id, item_code: r.item_code, gap_qty: r.unmatched_qty })) })}>Close as HO</button>}
                </>}
                columns={[
                  { key: 'code', header: 'Item', value: (r) => r.item_code, className: 'font-mono text-xs' },
                  { key: 'name', header: 'Name', value: (r) => r.item_name, className: 'min-w-[220px]' },
                  { key: 'q', header: 'On receipt', align: 'right', value: (r) => r.qty, render: (r) => fmtQty(r.qty) },
                  { key: 'u', header: 'Not sent by anyone', align: 'right', value: (r) => r.unmatched_qty, render: (r) => <b className="text-violet-700">{fmtQty(r.unmatched_qty)}</b> },
                  { key: 'r', header: 'Reason', value: (r) => r.resolution_status, render: (r) => <ResolutionBadge status={r.resolution_status} reason={r.reason_code} note={r.resolution_note} /> },
                ]}
              />
            </Card>
          )}
        </>
      )}

      <Card title="Lines as printed on the STV" pad={false}>
        <DataTable<Line> rows={lines} rowKey={(r) => `${r.line_no}-${r.item_code}`} exportName={`STV_${stv.doc_no}`} pageSize={100}
          columns={[
            { key: 'no', header: 'No', align: 'right', value: (r) => r.line_no },
            { key: 'code', header: 'Item code', value: (r) => r.item_code, className: 'font-mono text-xs' },
            { key: 'bc', header: 'Barcode', value: (r) => r.barcode, className: 'font-mono text-xs' },
            { key: 'name', header: 'Item name', value: (r) => r.item_name },
            { key: 'unit', header: 'Unit', value: (r) => r.unit },
            { key: 'qty', header: 'Qty', align: 'right', value: (r) => Number(r.qty), render: (r) => fmtQty(r.qty) },
          ]} />
      </Card>

      {voidOpen && <VoidModal id={stv.id} onClose={() => setVoidOpen(false)} onDone={() => { setVoidOpen(false); load(); }} />}
      {explain && <ExplainModal targets={explain.targets} mode={explain.mode} onClose={() => setExplain(null)} onDone={refresh} />}
      {linkOpen && <LinkPlanModal stv={stv} onClose={() => setLinkOpen(false)} onDone={() => { setLinkOpen(false); load(); }} />}
    </div>
  );
}

function VoidModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  return (
    <Modal open title="Void STV" onClose={onClose} footer={<>
      <button className="btn-secondary" onClick={onClose}>Keep</button>
      <button className="btn-danger" onClick={() => rpc('void_stv', { p_id: id, p_reason: reason }).then(onDone).catch((e) => setErr(friendlyError(e)))}>Void STV</button>
    </>}>
      <p className="mb-3 text-sm text-slate-600">Use this when the wrong file was uploaded. Figures are recalculated; the STV stays visible as void for audit. The same STV number can then be uploaded again.</p>
      <Field label="Reason"><textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {err && <div className="mt-2"><Alert tone="bad">{err}</Alert></div>}
    </Modal>
  );
}

function LinkPlanModal({ stv, onClose, onDone }: { stv: StvRow; onClose: () => void; onDone: () => void }) {
  const [legs, setLegs] = useState<{ leg_id: string; ref: string; plan_date: string; planned_skus: number }[]>([]);
  const [leg, setLeg] = useState(stv.leg_id ?? '');
  const [err, setErr] = useState('');
  useEffect(() => {
    supabase.from('v_legs').select('leg_id, ref, plan_date, planned_skus').eq('from_site_id', stv.from_site_id).eq('to_site_id', stv.to_site_id)
      .eq('allocation_status', 'active').order('plan_date', { ascending: false }).limit(30).then(({ data }) => setLegs(data ?? []));
  }, [stv]);
  return (
    <Modal open title="Link this STV to a plan" onClose={onClose} footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" onClick={() => rpc('set_stv_leg', { p_stv: stv.id, p_leg: leg || null }).then(onDone).catch((e) => setErr(friendlyError(e)))}>Save</button>
    </>}>
      <Field label="Plan (same sender and receiver)">
        <select className="input" value={leg} onChange={(e) => setLeg(e.target.value)}>
          <option value="">No plan (unplanned transfer)</option>
          {legs.map((l) => <option key={l.leg_id} value={l.leg_id}>{l.ref} · {fmtDate(l.plan_date)} · {l.planned_skus} SKUs</option>)}
        </select>
      </Field>
      {err && <div className="mt-2"><Alert tone="bad">{err}</Alert></div>}
    </Modal>
  );
}
