// Month-end close: head office reviews a month, closes it (nothing dated in it can change after that),
// and keeps a frozen sign-off report. Can be reopened with a reason.
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Alert, Badge, Card, Field, Modal, PageHeader, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth';
import { downloadExcel } from '../lib/excel';
import { fmtDateTime, fmtKwd, fmtQty, kwToday } from '../lib/format';
import { fmtP, lastMonths, monthLabel, pct } from '../lib/metrics';
import { friendlyError, rpc, supabase } from '../lib/supabase';
import type { MonthSummary, PeriodLock, Profile } from '../lib/types';

export default function MonthEnd() {
  const a = useAuth();
  const months = lastMonths(7).reverse(); // current month first
  const [sel, setSel] = useState(months[1]);
  const [locks, setLocks] = useState<PeriodLock[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [live, setLive] = useState<MonthSummary | null>(null);
  const [modal, setModal] = useState<'lock' | 'unlock' | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    supabase.from('period_locks').select('*').order('month', { ascending: false }).then(({ data }) => setLocks((data as PeriodLock[]) ?? []));
    supabase.from('profiles').select('user_id, full_name').then(({ data }) => setNames(Object.fromEntries(((data ?? []) as Profile[]).map((p) => [p.user_id, p.full_name]))));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let live = true; // ignore an answer for a month that is no longer selected
    setLive(null); setErr('');
    rpc<MonthSummary>('month_summary', { p_month: sel }).then((r) => live && setLive(r)).catch((e) => live && setErr(friendlyError(e)));
    return () => { live = false; };
  }, [sel, locks]);

  const lock = locks.find((l) => l.month.slice(0, 7) === sel.slice(0, 7));
  const s = lock?.summary ?? live;
  const ended = sel.slice(0, 7) < kwToday().slice(0, 7);
  const checks = live ? [
    { ok: live.legs_not_sent === 0, text: `${live.legs_not_sent} allocation(s) from this month not sent`, good: 'Every allocation was sent' },
    { ok: Number(live.open_qty) === 0, text: `${fmtQty(live.open_qty)} pcs sent this month still not received`, good: 'Everything sent was received' },
    { ok: live.problems_open === 0, text: `${live.problems_open} problem(s) not closed`, good: 'Every problem is explained and approved' },
  ] : [];

  const exportReport = () => s && downloadExcel(`month_end_${sel.slice(0, 7)}`, [{
    name: 'Month-end',
    title: `Month-end ${monthLabel(sel, true)} - ${lock ? `closed ${fmtDateTime(lock.locked_at)} by ${names[lock.locked_by ?? ''] ?? '?'}` : 'NOT CLOSED (live figures)'}`,
    columns: [{ header: 'Figure', width: 42 }, { header: 'Value', width: 18, numFmt: '#,##0.###' }],
    rows: [
      ['Plans', s.plans], ['Allocations (plan x store)', s.legs], ['Pieces planned', s.planned_qty], ['Allocations not sent', s.legs_not_sent],
      ['STVs uploaded', s.stvs], ['Pieces sent', s.sent_qty], ['Pieces received', s.received_qty],
      ['Pieces sent this month still not received', s.open_qty], ['Value not received (KWD)', s.open_value],
      ['Problems', s.problems], ['Problems still open', s.problems_open], ['Problems approved', s.problems_approved],
      ['Approved shortages value (KWD)', s.approved_loss_value], ['Stuck in virtual stores at month end (pcs)', s.stuck_qty], ['Stuck value (KWD)', s.stuck_value],
    ],
  }, {
    name: 'By store',
    columns: [{ header: 'Store', width: 18 }, { header: 'Pieces sent', width: 14, numFmt: '#,##0' }, { header: 'Pieces received', width: 16, numFmt: '#,##0' }, { header: 'Not received (pcs)', width: 18, numFmt: '#,##0' }, { header: 'Open problems', width: 14 }],
    rows: s.stores.map((x) => [a.siteName(x.site_id), x.sent_qty, x.received_qty, x.open_qty, x.problems_open]),
  }]);

  return (
    <div className="space-y-5">
      <PageHeader title="Month-end close" subtitle="Check a month, then close it. After closing, no STV, plan or ERP report dated in that month can be added, voided or changed - the figures are frozen for the sign-off report." />
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Month">
        {months.map((m) => {
          const l = locks.find((x) => x.month.slice(0, 7) === m.slice(0, 7));
          return (
            <button key={m} role="tab" aria-selected={sel === m} onClick={() => setSel(m)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${sel === m ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              {l ? <Icon name="lock" className="h-3.5 w-3.5 text-green-700" /> : null}{monthLabel(m, true)}
            </button>
          );
        })}
      </div>
      {err && <Alert tone="bad">{err}</Alert>}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title={monthLabel(sel, true)} className="lg:col-span-2" actions={s && <button className="btn-secondary btn-sm" onClick={exportReport}><Icon name="download" className="h-4 w-4" />Sign-off report</button>}>
          {!s ? <Spinner /> : (
            <div className="space-y-4">
              {lock ? <Alert tone="good" title="Closed">By {names[lock.locked_by ?? ''] ?? 'head office'} on {fmtDateTime(lock.locked_at)}{lock.note ? ` - ${lock.note}` : ''}. Figures below are frozen at closing.</Alert>
                : !ended ? <Alert tone="info">This month is still running. It can be closed from the 1st of next month.</Alert>
                : <Alert tone="warn">Not closed yet. Figures are live.</Alert>}
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
                {[
                  ['Plans / allocations', `${s.plans} / ${s.legs}`], ['Pieces planned', fmtQty(s.planned_qty)], ['Not sent', String(s.legs_not_sent)],
                  ['STVs uploaded', String(s.stvs)], ['Pieces sent', fmtQty(s.sent_qty)], ['Pieces received', `${fmtQty(s.received_qty)} (${fmtP(pct(Number(s.received_qty), Number(s.sent_qty)))})`],
                  ['Sent, not received', `${fmtQty(s.open_qty)} pcs · ${fmtKwd(s.open_value)}`], ['Problems open / total', `${s.problems_open} / ${s.problems}`],
                  ['Approved shortages', fmtKwd(s.approved_loss_value)], ['Stuck in virtual stores', `${fmtQty(s.stuck_qty)} pcs · ${fmtKwd(s.stuck_value)}`],
                ].map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-semibold tabular-nums">{v}</dd></div>)}
              </dl>
              <table className="w-full text-sm">
                <thead><tr><th className="th">Store</th><th className="th text-right">Sent</th><th className="th text-right">Received</th><th className="th text-right">Not received</th><th className="th text-right">Open problems</th></tr></thead>
                <tbody>{s.stores.map((x) => (
                  <tr key={x.site_id}><td className="td">{a.siteName(x.site_id)}</td><td className="td num">{fmtQty(x.sent_qty)}</td><td className="td num">{fmtQty(x.received_qty)}</td>
                    <td className="td num">{Number(x.open_qty) ? <b className="text-red-700">{fmtQty(x.open_qty)}</b> : '–'}</td><td className="td num">{x.problems_open || '–'}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Before closing">
          {!live ? <Spinner /> : (
            <div className="space-y-3">
              <ul className="space-y-2 text-sm">
                {checks.map((c) => (
                  <li key={c.good} className="flex gap-2">
                    <Icon name={c.ok ? 'checkCircle' : 'alert'} className={`h-5 w-5 shrink-0 ${c.ok ? 'text-green-600' : 'text-amber-600'}`} />
                    <span className={c.ok ? 'text-slate-600' : 'font-medium text-slate-800'}>{c.ok ? c.good : c.text}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate-500">You can close a month with open items - they stay open and can still be explained and approved. Only new or changed STVs, plans and ERP reports dated in the month are blocked.</p>
              {a.isAdmin && ended && !lock && <button className="btn-primary w-full" onClick={() => setModal('lock')}><Icon name="lock" className="h-4 w-4" />Close {monthLabel(sel, true)}</button>}
              {a.isAdmin && lock && <button className="btn-secondary w-full" onClick={() => setModal('unlock')}><Icon name="unlock" className="h-4 w-4" />Reopen month</button>}
              {!a.isAdmin && <Badge>Only a head office admin can close a month</Badge>}
            </div>
          )}
        </Card>
      </div>
      {modal && <LockModal month={sel} unlock={modal === 'unlock'} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
    </div>
  );
}

function LockModal({ month, unlock, onClose, onDone }: { month: string; unlock: boolean; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Modal open title={`${unlock ? 'Reopen' : 'Close'} ${monthLabel(month, true)}`} onClose={onClose} footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className={unlock ? 'btn-danger' : 'btn-primary'} disabled={busy || (unlock && !note.trim())} onClick={async () => {
        setBusy(true); setErr('');
        try {
          if (unlock) await rpc('unlock_month', { p_month: month, p_reason: note });
          else await rpc('lock_month', { p_month: month, p_note: note });
          onDone();
        } catch (e) { setErr(friendlyError(e)); setBusy(false); }
      }}>{busy ? 'Saving…' : unlock ? 'Reopen' : 'Close month'}</button>
    </>}>
      <p className="mb-3 text-sm text-slate-600">{unlock
        ? 'Stores can post STVs dated in this month again. The reason is kept in the activity log.'
        : 'After closing, nobody can upload, void or change STVs, plans or ERP reports dated in this month. The current figures are saved as the sign-off report.'}</p>
      <Field label={unlock ? 'Reason (required)' : 'Note (optional)'}>
        <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={unlock ? 'e.g. late STV from Hawally found' : 'e.g. checked with finance'} />
      </Field>
      {err && <div className="mt-3"><Alert tone="bad">{err}</Alert></div>}
    </Modal>
  );
}
