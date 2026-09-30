import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { DISC_KIND } from '../lib/labels';
import { friendlyError, rpc } from '../lib/supabase';
import type { DiscKind, ResStatus } from '../lib/types';
import { Alert, Badge, Field, Modal } from './ui';

export interface ResolveTarget {
  kind: DiscKind;
  leg_id: string | null;
  stv_id: string | null;
  item_code: string;
  gap_qty: number | null;
  label?: string; // shown in the modal
}

const payload = (t: ResolveTarget) => ({
  kind: t.kind,
  // leg-based discrepancies are keyed by leg, STV-based ones by STV
  leg_id: ['dispatch_short', 'dispatch_over', 'unplanned_item'].includes(t.kind) ? t.leg_id : null,
  stv_id: ['unplanned_stv', 'receipt_short', 'receipt_over'].includes(t.kind) ? t.stv_id : null,
  item_code: t.item_code,
  gap_qty: t.gap_qty,
});

/** Store (or HO) explains one or more discrepancy lines; HO can also close them directly. */
export function ExplainModal({ targets, mode, onClose, onDone }: { targets: ResolveTarget[]; mode: 'explain' | 'close'; onClose: () => void; onDone: () => void }) {
  const a = useAuth();
  const kinds = [...new Set(targets.map((t) => t.kind))];
  const reasons = a.reasons.filter((r) => r.active && kinds.every((k) => r.applies_to.includes(k)));
  const [reason, setReason] = useState(reasons[0]?.code ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(0);

  const submit = async () => {
    if (!reason) return setErr('Choose a reason.');
    if (reason === 'OTHER' && !note.trim()) return setErr('Please explain in the note.');
    setBusy(true);
    setErr('');
    const failed: string[] = [];
    let n = 0;
    for (const t of targets) {
      try {
        await rpc(mode === 'close' ? 'close_discrepancy' : 'request_resolution', { p: { ...payload(t), reason_code: reason, note } });
      } catch (e) {
        failed.push(`${t.item_code}: ${friendlyError(e)}`);
      }
      setDone(++n);
    }
    setBusy(false);
    if (failed.length) setErr(failed.slice(0, 5).join('\n'));
    else onDone();
  };

  return (
    <Modal open title={mode === 'close' ? `Close ${targets.length} line(s) as head office` : `Explain ${targets.length} line(s)`} onClose={onClose}
      footer={<>
        <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? `Saving ${done}/${targets.length}…` : mode === 'close' ? 'Close lines' : 'Send to head office'}</button>
      </>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1">{kinds.map((k) => <Badge key={k} tone="warn">{DISC_KIND[k].label}</Badge>)}</div>
        {targets.length <= 5 && <ul className="text-sm text-slate-600">{targets.map((t) => <li key={`${t.kind}${t.leg_id}${t.stv_id}${t.item_code}`}>• {t.label ?? t.item_code}</li>)}</ul>}
        {reasons.length === 0 ? <Alert tone="warn">No reason fits all selected line types - select lines of one type.</Alert> : (
          <Field label="Reason">
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
              {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
          </Field>
        )}
        <Field label="Note (optional unless reason is Other)"><textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {mode === 'explain' && <p className="text-xs text-slate-500">Head office reviews your reason and approves or rejects it. The line stays open until then.</p>}
        {mode === 'close' && kinds.includes('receipt_short') && (
          <Alert tone="warn">Closing a "not received" line removes it from in-transit here. If the stock really is lost, also adjust it out of the Allocation store in the ERP.</Alert>
        )}
        {err && <Alert tone="bad"><pre className="whitespace-pre-wrap font-sans">{err}</pre></Alert>}
      </div>
    </Modal>
  );
}

/** HO approves or rejects pending explanations (bulk). */
export function DecideModal({ ids, approve, onClose, onDone }: { ids: string[]; approve: boolean; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    if (!approve && !note.trim()) return setErr('Write why it is rejected - the store will see it.');
    setBusy(true);
    const failed: string[] = [];
    for (const id of ids) {
      try { await rpc('decide_resolution', { p_id: id, p_approve: approve, p_note: note }); } catch (e) { failed.push(friendlyError(e)); }
    }
    setBusy(false);
    if (failed.length) setErr(failed.slice(0, 5).join('\n')); else onDone();
  };
  return (
    <Modal open title={`${approve ? 'Approve' : 'Reject'} ${ids.length} explanation(s)`} onClose={onClose}
      footer={<>
        <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className={approve ? 'btn-primary' : 'btn-danger'} onClick={submit} disabled={busy}>{busy ? 'Saving…' : approve ? 'Approve' : 'Reject'}</button>
      </>}>
      <Field label={approve ? 'Note (optional)' : 'Reason for rejecting'}><textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {approve && <p className="mt-2 text-xs text-slate-500">Approved lines are closed and stop counting as open discrepancies.</p>}
      {err && <div className="mt-2"><Alert tone="bad"><pre className="whitespace-pre-wrap font-sans">{err}</pre></Alert></div>}
    </Modal>
  );
}

export function ResolutionBadge({ status, reason, note }: { status: ResStatus | null; reason?: string | null; note?: string | null }) {
  const a = useAuth();
  if (!status) return <Badge tone="bad">Needs reason</Badge>;
  const label = a.reasons.find((r) => r.code === reason)?.label ?? reason ?? '';
  const title = [label, note].filter(Boolean).join(' - ');
  if (status === 'pending') return <Badge tone="warn" title={title}>Awaiting HO · {label}</Badge>;
  if (status === 'approved') return <Badge tone="good" title={title}>Closed · {label}</Badge>;
  return <Badge tone="bad" title={title}>Rejected - explain again</Badge>;
}
