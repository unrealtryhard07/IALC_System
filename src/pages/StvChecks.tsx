// STV checks for head office: the same transfer uploaded twice under two numbers, and STV numbers that are missing.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Card, Field, Modal, PageHeader, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtQty } from '../lib/format';
import { DIRECTION } from '../lib/labels';
import { friendlyError, rpc, supabase } from '../lib/supabase';

interface Dup { key: string; a_id: string; a_doc: string; a_date: string; b_id: string; b_doc: string; b_date: string; direction: string; from_site_id: number; to_site_id: number; lines: number; qty: number }
interface Gap { key: string; series: string; first_missing: number; last_missing: number; missing: number; before_doc: string; before_date: string; before_id: string; after_doc: string; after_date: string; after_id: string }
interface Dismissal { kind: string; key: string; note: string; dismissed_at: string }

export default function StvChecks() {
  const a = useAuth();
  const [days, setDays] = useState(60);
  const [dups, setDups] = useState<Dup[] | null>(null);
  const [gaps, setGaps] = useState<Gap[] | null>(null);
  const [done, setDone] = useState<Dismissal[]>([]);
  const [dismiss, setDismiss] = useState<{ kind: 'duplicate' | 'gap'; id: string; label: string } | null>(null);
  const [err, setErr] = useState('');
  const mode = String(a.settings.stv_numbering ?? 'global');

  const load = useCallback(() => {
    setDups(null); setGaps(null);
    Promise.all([
      rpc<Dup[]>('stv_duplicate_pairs'),
      rpc<Gap[]>('stv_number_gaps', { p_days: days }),
      supabase.from('stv_check_dismissals').select('*').order('dismissed_at', { ascending: false }).limit(30),
    ]).then(([d, g, x]) => { setDups(d); setGaps(g); setDone((x.data as Dismissal[]) ?? []); }).catch((e) => setErr(friendlyError(e)));
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const range = (g: Gap) => (g.first_missing === g.last_missing ? String(g.first_missing) : `${g.first_missing} – ${g.last_missing}`);
  return (
    <div className="space-y-5">
      <PageHeader title="STV checks" subtitle="Catches vouchers that were uploaded twice, and vouchers that were probably never uploaded." />
      {err && <Alert tone="bad">{err}</Alert>}

      <Card title={<>Possible duplicates {dups && <Badge tone={dups.length ? 'bad' : 'good'}>{dups.length}</Badge>}</>} pad={false}>
        <p className="px-4 pt-3 text-sm text-slate-500">Two different STV numbers on the same route, within 3 days, with exactly the same items and quantities. Usually the same stock posted twice in the ERP - which inflates what the receiver is expected to receive.</p>
        {!dups ? <Spinner /> : dups.length === 0 ? <div className="p-4 text-sm text-green-700">No duplicates found.</div> : (
          <div className="overflow-x-auto"><table className="w-full"><thead><tr>
            <th className="th">STVs</th><th className="th">Type</th><th className="th">Route</th><th className="th text-right">Lines / pcs</th><th className="th" />
          </tr></thead><tbody>
            {dups.map((d) => (
              <tr key={d.key}>
                <td className="td"><Link className="link" to={`/stvs/${d.a_id}`}>{d.a_doc}</Link> <span className="text-slate-400">({fmtDate(d.a_date)})</span> and <Link className="link" to={`/stvs/${d.b_id}`}>{d.b_doc}</Link> <span className="text-slate-400">({fmtDate(d.b_date)})</span></td>
                <td className="td"><Badge tone={DIRECTION[d.direction]?.tone ?? 'neutral'}>{DIRECTION[d.direction]?.label ?? d.direction}</Badge></td>
                <td className="td">{a.siteName(d.from_site_id)} → {a.siteName(d.to_site_id)}</td>
                <td className="td num">{d.lines} / {fmtQty(d.qty)}</td>
                <td className="td text-right whitespace-nowrap">
                  {a.isAdmin && <button className="btn-secondary btn-sm" onClick={() => setDismiss({ kind: 'duplicate', id: d.key, label: `${d.a_doc} and ${d.b_doc}` })}>Both are real</button>}
                </td>
              </tr>
            ))}
          </tbody></table></div>
        )}
        {dups && dups.length > 0 && <p className="px-4 pb-3 text-xs text-slate-500">If one is a mistake: reverse it in the ERP, then void it here (open the STV → Void).</p>}
      </Card>

      <Card title={<>Missing STV numbers {gaps && <Badge tone={gaps.length ? 'warn' : 'good'}>{gaps.reduce((s, g) => s + g.missing, 0)}</Badge>}</>} pad={false}
        actions={<select className="input w-auto py-1 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
          {[30, 60, 90, 180].map((n) => <option key={n} value={n}>Last {n} days</option>)}
        </select>}>
        <p className="px-4 pt-3 text-sm text-slate-500">
          STV numbers between two uploaded vouchers that are not in the system. A missing number may be a transfer nobody uploaded - check it in the ERP.
          {' '}{mode === 'per_store' ? 'Each sending ERP store has its own number series.' : 'The whole company shares one number series.'} Jumps bigger than {String(a.settings.stv_gap_max ?? 30)} numbers are treated as another series. Both can be changed in Settings.
        </p>
        {!gaps ? <Spinner /> : gaps.length === 0 ? <div className="p-4 text-sm text-green-700">No missing numbers.</div> : (
          <div className="overflow-x-auto"><table className="w-full"><thead><tr>
            <th className="th">Missing</th><th className="th text-right">How many</th><th className="th">Between</th>{mode === 'per_store' && <th className="th">Series</th>}<th className="th" />
          </tr></thead><tbody>
            {gaps.map((g) => (
              <tr key={g.key}>
                <td className="td font-mono font-semibold">{range(g)}</td>
                <td className="td num">{g.missing}</td>
                <td className="td text-sm"><Link className="link" to={`/stvs/${g.before_id}`}>{g.before_doc}</Link> ({fmtDate(g.before_date)}) and <Link className="link" to={`/stvs/${g.after_id}`}>{g.after_doc}</Link> ({fmtDate(g.after_date)})</td>
                {mode === 'per_store' && <td className="td">{a.locationLabel(g.series)}</td>}
                <td className="td text-right whitespace-nowrap">
                  {a.isAdmin && <button className="btn-secondary btn-sm" onClick={() => setDismiss({ kind: 'gap', id: g.key, label: `STV ${range(g)}` })}>Checked - not a transfer</button>}
                </td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </Card>

      {done.length > 0 && (
        <Card title="Checked and marked OK" pad={false}>
          <table className="w-full"><tbody>
            {done.map((x) => <tr key={x.kind + x.key}><td className="td"><Badge>{x.kind === 'gap' ? 'Missing number' : 'Duplicate'}</Badge></td><td className="td font-mono text-sm">{x.key.replace(/^(all|\d+):/, '')}</td><td className="td text-sm text-slate-600">{x.note}</td><td className="td text-sm text-slate-500">{fmtDate(x.dismissed_at.slice(0, 10))}</td></tr>)}
          </tbody></table>
        </Card>
      )}

      {dismiss && <DismissModal kind={dismiss.kind} id={dismiss.id} label={dismiss.label} onClose={() => setDismiss(null)} onDone={() => { setDismiss(null); load(); }} />}
    </div>
  );
}

function DismissModal({ kind, id, label, onClose, onDone }: { kind: 'duplicate' | 'gap'; id: string; label: string; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Modal open title={`Mark ${label} as checked`} onClose={onClose} footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={busy || !note.trim()} onClick={async () => {
        setBusy(true); setErr('');
        try { await rpc('dismiss_stv_check', { p_kind: kind, p_key: id, p_note: note }); onDone(); } catch (e) { setErr(friendlyError(e)); setBusy(false); }
      }}>{busy ? 'Saving…' : 'Mark as checked'}</button>
    </>}>
      <Field label={kind === 'gap' ? 'What were these numbers used for?' : 'Why are both correct?'}>
        <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={kind === 'gap' ? 'e.g. supplier returns / damages, checked in the ERP' : 'e.g. two separate deliveries of the same order'} />
      </Field>
      {err && <div className="mt-3"><Alert tone="bad">{err}</Alert></div>}
    </Modal>
  );
}
