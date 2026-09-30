import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Card, Field, FileDrop, PageHeader, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtQty, kwToday } from '../lib/format';
import { DIRECTION } from '../lib/labels';
import { readSpreadsheet } from '../lib/parsers/sheet';
import type { StvHeader, StvLine } from '../lib/parsers/stvLayout';
import { parseStvGrid } from '../lib/parsers/stvSheet';
import { parseStvFile } from '../lib/pdf';
import { fetchAll, friendlyError, rpc, supabase, uploadDocument } from '../lib/supabase';

interface LocInfo { code: string; name: string; site_id: number | null; kind: string | null; is_new: boolean; error?: string }
interface LegSuggestion { leg_id: string; ref: string; plan_date: string; title: string | null; planned_items: number; overlap: number; already_dispatched: boolean }
interface DispatchSuggestion { stv_id: string; doc_no: string; stv_date: string; from_site_id: number; items: number; overlap: number; open_qty: number }
interface Preview {
  from: LocInfo; to: LocInfo; direction: 'dispatch' | 'receipt' | 'direct' | 'other' | null; acting_site_id: number | null;
  can_submit: boolean; duplicate: { id: string; doc_no: string; uploaded_at: string } | null; unknown_items: string[];
  leg_suggestions: LegSuggestion[]; dispatch_suggestions: DispatchSuggestion[]; errors: string[];
}
interface CompareRow { item_code: string; name: string; expected: number | null; actual: number | null; diff: number; status: 'ok' | 'short' | 'missing' | 'over' | 'extra' }

interface Job {
  id: string;
  file: File;
  kind: 'pdf' | 'sheet';
  stage: 'parsing' | 'ready' | 'saving' | 'done' | 'failed';
  header: StvHeader;
  lines: StvLine[];
  warnings: string[];
  errors: string[];
  preview: Preview | null;
  legId: string; // '' = unplanned
  links: string[];
  result?: { id: string; direction: string; lines: number; qty: number };
  message?: string;
}

const emptyHeader = (): StvHeader => ({ docNo: '', date: kwToday(), fromName: '', fromCode: '', toName: '', toCode: '', postRef: '' });

export default function StvUpload() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const update = (id: string, patch: Partial<Job> | ((j: Job) => Partial<Job>)) =>
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...(typeof patch === 'function' ? patch(j) : patch) } : j)));

  const addFiles = async (files: File[]) => {
    for (const file of files) {
      const id = crypto.randomUUID();
      const isPdf = /\.pdf$/i.test(file.name);
      const job: Job = { id, file, kind: isPdf ? 'pdf' : 'sheet', stage: 'parsing', header: emptyHeader(), lines: [], warnings: [], errors: [], preview: null, legId: '', links: [] };
      setJobs((js) => [job, ...js]);
      try {
        if (isPdf) {
          const r = await parseStvFile(file);
          update(id, { header: { ...r.header, date: r.header.date ?? kwToday() }, lines: r.lines, warnings: r.warnings, errors: r.errors, stage: 'ready' });
        } else {
          const sheets = await readSpreadsheet(file);
          const r = parseStvGrid(sheets[0]?.rows ?? []);
          const docGuess = file.name.match(/(\d{4,})/)?.[1] ?? '';
          update(id, { header: { ...emptyHeader(), docNo: docGuess }, lines: r.lines, warnings: r.warnings, errors: r.errors, stage: 'ready' });
        }
      } catch (e) {
        update(id, { stage: 'failed', errors: [`Could not read the file: ${friendlyError(e)}`] });
      }
    }
  };

  return (
    <div>
      <PageHeader title="Upload STV" subtitle="Upload the Stock Transfer Voucher PDF from the ERP. Sending stores upload their dispatch STV; receiving stores upload the Allocation → D.S STV." />
      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <FileDrop accept=".pdf,.xlsx,.csv" multiple onFiles={addFiles} label="Drop STV PDF(s) here" />
        </div>
        <Card title="Which STV do I upload?">
          <ul className="space-y-2 text-sm text-slate-700">
            <li><Badge tone="info">Dispatch</Badge> You send stock: <b>your D.S / DC → other store's Allocation</b>. Upload it the same day.</li>
            <li><Badge tone="good">Receipt</Badge> Goods arrived: <b>your Allocation → your D.S</b>. Upload it as soon as you post it - until then the stock is invisible in the app.</li>
            <li className="text-xs text-slate-500">The system reads the store codes on the STV and works out which one it is.</li>
          </ul>
        </Card>
      </div>
      <div className="space-y-4">
        {jobs.map((j) => <JobCard key={j.id} job={j} update={(p) => update(j.id, p)} remove={() => setJobs((js) => js.filter((x) => x.id !== j.id))} />)}
      </div>
    </div>
  );
}

function JobCard({ job, update, remove }: { job: Job; update: (p: Partial<Job> | ((j: Job) => Partial<Job>)) => void; remove: () => void }) {
  const a = useAuth();
  const [compare, setCompare] = useState<CompareRow[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const h = job.header;
  const totalQty = job.lines.reduce((s, l) => s + l.qty, 0);
  const payloadBase = useMemo(() => ({
    doc_no: h.docNo.trim(), stv_date: h.date, from_code: h.fromCode, from_name: h.fromName, to_code: h.toCode, to_name: h.toName,
    post_ref: h.postRef,
    lines: job.lines.map((l) => ({ line_no: l.lineNo, item_code: l.itemCode, barcode: l.barcode, item_name: l.itemName, pack_qty: l.packQty, unit: l.unit, qty: l.qty, exp_date: l.expDate })),
  }), [h, job.lines]);

  // Ask the server what this STV is and what it should be matched to.
  useEffect(() => {
    if (job.stage !== 'ready' || !job.lines.length || !h.docNo || (!h.fromCode && !h.fromName) || (!h.toCode && !h.toName)) return;
    let cancel = false;
    rpc<Preview>('stv_preview', { p: payloadBase }).then((pv) => {
      if (cancel) return;
      const receiptItems = new Set(job.lines.map((l) => l.itemCode)).size;
      update((j) => ({
        preview: pv,
        legId: j.preview ? j.legId : pv.leg_suggestions[0]?.leg_id ?? '',
        links: j.preview ? j.links : pv.dispatch_suggestions.filter((d, i) => i === 0 || d.overlap >= receiptItems / 2).map((d) => d.stv_id),
      }));
    }).catch((e) => !cancel && update({ message: friendlyError(e) }));
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.stage, payloadBase]);

  // Line-by-line comparison against the chosen plan / linked dispatches.
  useEffect(() => {
    const pv = job.preview;
    if (!pv) return;
    const stvQty = new Map<string, { q: number; n: string }>();
    job.lines.forEach((l) => stvQty.set(l.itemCode, { q: (stvQty.get(l.itemCode)?.q ?? 0) + l.qty, n: l.itemName }));
    const build = (expected: Map<string, { q: number; n: string }>, missingLabel: 'missing') => {
      const rows: CompareRow[] = [];
      expected.forEach((e, code) => {
        const act = stvQty.get(code)?.q ?? 0;
        rows.push({ item_code: code, name: e.n || stvQty.get(code)?.n || '', expected: e.q, actual: act, diff: act - e.q, status: act === 0 ? missingLabel : act < e.q ? 'short' : act > e.q ? 'over' : 'ok' });
      });
      stvQty.forEach((s, code) => { if (!expected.has(code)) rows.push({ item_code: code, name: s.n, expected: null, actual: s.q, diff: s.q, status: 'extra' }); });
      return rows.sort((x, y) => (x.status === 'ok' ? 1 : 0) - (y.status === 'ok' ? 1 : 0) || x.item_code.localeCompare(y.item_code));
    };
    if ((pv.direction === 'dispatch' || pv.direction === 'direct') && job.legId) {
      supabase.from('allocation_lines').select('item_code, item_name, planned_qty').eq('leg_id', job.legId).then(({ data }) => {
        const m = new Map<string, { q: number; n: string }>();
        (data ?? []).forEach((r: { item_code: string; item_name: string | null; planned_qty: number }) => m.set(r.item_code, { q: Number(r.planned_qty), n: r.item_name ?? '' }));
        setCompare(build(m, 'missing'));
      });
    } else if (pv.direction === 'receipt' && job.links.length) {
      fetchAll<{ item_code: string; item_name: string | null; raw_open_qty: number }>((f, t) =>
        supabase.from('v_dispatch_items').select('item_code, item_name, raw_open_qty').in('stv_id', job.links).range(f, t),
      ).then((rows) => {
        const m = new Map<string, { q: number; n: string }>();
        rows.forEach((r) => { if (Number(r.raw_open_qty) > 0) m.set(r.item_code, { q: (m.get(r.item_code)?.q ?? 0) + Number(r.raw_open_qty), n: r.item_name ?? '' }); });
        setCompare(build(m, 'missing'));
      });
    } else setCompare(null);
  }, [job.preview, job.legId, job.links, job.lines]);

  const pv = job.preview;
  const dir = pv?.direction ?? null;
  const blocking = [...job.errors, ...(pv?.errors ?? [])];
  const canSave = job.stage === 'ready' && !!pv && pv.can_submit && !pv.duplicate && blocking.length === 0 && !!h.docNo && !!h.date;

  const save = async () => {
    update({ stage: 'saving', message: undefined });
    try {
      const path = await uploadDocument('stv', job.file);
      const res = await rpc<Job['result']>('submit_stv', {
        p: {
          ...payloadBase, source: job.kind === 'pdf' ? 'pdf' : 'excel', file_path: path, file_name: job.file.name, warnings: job.warnings,
          leg_id: dir === 'dispatch' || dir === 'direct' ? job.legId || null : null,
          link_dispatch_ids: dir === 'receipt' ? job.links : [],
        },
      });
      update({ stage: 'done', result: res });
    } catch (e) {
      update({ stage: 'ready', message: friendlyError(e) });
    }
  };

  const counts = compare && {
    ok: compare.filter((c) => c.status === 'ok').length,
    short: compare.filter((c) => c.status === 'short').length,
    missing: compare.filter((c) => c.status === 'missing').length,
    over: compare.filter((c) => c.status === 'over').length,
    extra: compare.filter((c) => c.status === 'extra').length,
  };
  const siteOf = (l?: LocInfo | null) => (l?.site_id ? a.siteName(l.site_id) : '?');

  return (
    <Card
      title={<span className="flex flex-wrap items-center gap-2">📄 {job.file.name}{dir && <Badge tone={DIRECTION[dir].tone}>{DIRECTION[dir].label}</Badge>}{job.stage === 'done' && <Badge tone="good">Saved</Badge>}</span>}
      actions={job.stage !== 'saving' && <button className="btn-ghost btn-sm" onClick={remove}>{job.stage === 'done' ? 'Close' : 'Discard'}</button>}>
      {job.stage === 'parsing' && <Spinner label="Reading STV…" />}
      {job.stage === 'failed' && <Alert tone="bad">{job.errors.join(' ')}</Alert>}
      {job.stage === 'done' && job.result && (
        <Alert tone="good" title={`STV ${h.docNo} saved - ${job.result.lines} lines, ${fmtQty(job.result.qty)} pcs.`}>
          <Link className="link" to={`/stvs/${job.result.id}`}>Open STV →</Link>
        </Alert>
      )}
      {(job.stage === 'ready' || job.stage === 'saving') && (
        <div className="space-y-4">
          {/* header */}
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="STV No."><input className="input font-mono" value={h.docNo} disabled={job.kind === 'pdf'} onChange={(e) => update({ header: { ...h, docNo: e.target.value }, preview: null })} /></Field>
            <Field label="STV date"><input className="input" type="date" value={h.date ?? ''} onChange={(e) => update({ header: { ...h, date: e.target.value } })} /></Field>
            {job.kind === 'pdf' ? (
              <>
                <Field label="From store"><div className="input bg-slate-50">{h.fromName} <span className="text-slate-400">{h.fromCode}</span></div></Field>
                <Field label="To store"><div className="input bg-slate-50">{h.toName} <span className="text-slate-400">{h.toCode}</span></div></Field>
              </>
            ) : (
              <>
                <LocationPicker label="From store" value={h.fromCode} onChange={(code, name) => update({ header: { ...h, fromCode: code, fromName: name }, preview: null })} />
                <LocationPicker label="To store" value={h.toCode} onChange={(code, name) => update({ header: { ...h, toCode: code, toName: name }, preview: null })} />
              </>
            )}
          </div>
          <div className="text-sm text-slate-600">
            <b>{job.lines.length}</b> lines · <b>{fmtQty(totalQty)}</b> pcs
            {pv && dir && <> · {dir === 'dispatch' && <>Goes from <b>{siteOf(pv.from)}</b> into <b>{pv.to.name}</b> - waits there until <b>{siteOf(pv.to)}</b> receives it.</>}
              {dir === 'receipt' && <><b>{siteOf(pv.to)}</b> moves stock from <b>{pv.from.name}</b> into its D.S (stock becomes sellable).</>}
              {dir === 'direct' && <>Direct transfer {siteOf(pv.from)} → {siteOf(pv.to)} (no Allocation store).</>}
              {dir === 'other' && <>This is not an allocation movement; it will be recorded for head office review.</>}</>}
          </div>

          {[...blocking].map((e) => <Alert key={e} tone="bad">{e}</Alert>)}
          {pv?.duplicate && <Alert tone="bad" title="Already uploaded">STV {pv.duplicate.doc_no} is already in the system. <Link className="link" to={`/stvs/${pv.duplicate.id}`}>View it</Link></Alert>}
          {pv && !pv.can_submit && !pv.duplicate && blocking.length === 0 && (
            <Alert tone="bad">This STV belongs to {pv.acting_site_id ? a.siteName(pv.acting_site_id) : 'another store'}. Only that store (or head office) can upload it.</Alert>
          )}
          {(pv?.from.is_new || pv?.to.is_new) && !blocking.length && (
            <Alert tone="info">New ERP store code will be registered automatically: {[pv.from, pv.to].filter((l) => l.is_new).map((l) => `${l.name} ${l.code} → ${siteOf(l)} (${l.kind})`).join(', ')}. Head office can correct it in Settings.</Alert>
          )}
          {job.warnings.map((w) => <Alert key={w} tone="warn">{w}</Alert>)}
          {pv && pv.unknown_items.length > 0 && <Alert tone="warn">{pv.unknown_items.length} item code(s) are not in the masterlist: {pv.unknown_items.slice(0, 8).join(', ')}{pv.unknown_items.length > 8 ? '…' : ''}</Alert>}

          {/* plan link for dispatches */}
          {pv && (dir === 'dispatch' || dir === 'direct') && pv.can_submit && (
            <div>
              <div className="label">Allocation plan this STV fulfils</div>
              <div className="space-y-1.5">
                {pv.leg_suggestions.map((s) => (
                  <label key={s.leg_id} className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                    <input type="radio" name={`leg-${job.id}`} checked={job.legId === s.leg_id} onChange={() => update({ legId: s.leg_id })} />
                    <b>{s.ref}</b> <span className="text-slate-500">{fmtDate(s.plan_date)}</span> {s.title && <span className="truncate text-slate-500">· {s.title}</span>}
                    <span className="ml-auto text-xs text-slate-600">{s.overlap}/{s.planned_items} planned items on this STV</span>
                    {s.already_dispatched && <Badge tone="warn">already has an STV</Badge>}
                  </label>
                ))}
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                  <input type="radio" name={`leg-${job.id}`} checked={job.legId === ''} onChange={() => update({ legId: '' })} />
                  No plan - unplanned transfer <span className="text-xs text-slate-500">(head office will be asked to review it)</span>
                </label>
              </div>
            </div>
          )}

          {/* dispatch links for receipts */}
          {pv && dir === 'receipt' && pv.can_submit && (
            <div>
              <div className="label">Which transfers are you receiving?</div>
              {pv.dispatch_suggestions.length === 0 ? (
                <Alert tone="warn">No open dispatch into {pv.from.name} matches these items. You can still save - the quantities will be flagged as "received without dispatch" (e.g. old stock sitting in the Allocation store).</Alert>
              ) : (
                <div className="space-y-1.5">
                  {pv.dispatch_suggestions.map((d) => (
                    <label key={d.stv_id} className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
                      <input type="checkbox" checked={job.links.includes(d.stv_id)}
                        onChange={(e) => update({ links: e.target.checked ? [...job.links, d.stv_id] : job.links.filter((x) => x !== d.stv_id) })} />
                      STV <b>{d.doc_no}</b> <span className="text-slate-500">{fmtDate(d.stv_date)} from {a.siteName(d.from_site_id)}</span>
                      <span className="ml-auto text-xs text-slate-600">{d.overlap}/{d.items} items match · {fmtQty(d.open_qty)} pcs open</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* comparison */}
          {compare && counts && (
            <div className="rounded-md border border-slate-200">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                <b>{dir === 'receipt' ? 'Compared with what was dispatched' : 'Compared with the allocation plan'}:</b>
                <Badge tone="good">{counts.ok} match</Badge>
                {counts.short > 0 && <Badge tone="warn">{counts.short} short</Badge>}
                {counts.missing > 0 && <Badge tone="bad">{counts.missing} {dir === 'receipt' ? 'not received' : 'not sent'}</Badge>}
                {counts.over > 0 && <Badge tone="purple">{counts.over} over</Badge>}
                {counts.extra > 0 && <Badge tone="purple">{counts.extra} {dir === 'receipt' ? 'not dispatched' : 'not in plan'}</Badge>}
                <button className="btn-ghost btn-sm ml-auto" onClick={() => setShowAll(!showAll)}>{showAll ? 'Only differences' : 'Show all lines'}</button>
              </div>
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full">
                  <thead><tr><th className="th">Item</th><th className="th">Name</th><th className="th text-right">{dir === 'receipt' ? 'Open (sent)' : 'Planned'}</th><th className="th text-right">On STV</th><th className="th text-right">Diff</th><th className="th">Status</th></tr></thead>
                  <tbody>
                    {compare.filter((c) => showAll || c.status !== 'ok').map((c) => (
                      <tr key={c.item_code}>
                        <td className="td font-mono text-xs">{c.item_code}</td><td className="td">{c.name}</td>
                        <td className="td num">{fmtQty(c.expected)}</td><td className="td num">{fmtQty(c.actual)}</td>
                        <td className={`td num font-medium ${c.diff < 0 ? 'text-red-700' : c.diff > 0 ? 'text-violet-700' : ''}`}>{c.diff > 0 ? '+' : ''}{fmtQty(c.diff)}</td>
                        <td className="td">{{ ok: <Badge tone="good">Match</Badge>, short: <Badge tone="warn">Short</Badge>, missing: <Badge tone="bad">{dir === 'receipt' ? 'Not received' : 'Not sent'}</Badge>, over: <Badge tone="purple">Over</Badge>, extra: <Badge tone="purple">{dir === 'receipt' ? 'Not dispatched' : 'Not in plan'}</Badge> }[c.status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!showAll && compare.every((c) => c.status === 'ok') && <div className="p-3 text-sm text-green-700">✔ Every line matches.</div>}
              </div>
              {compare.some((c) => c.status !== 'ok') && (
                <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-600">
                  You can still save. Differences go to <b>Discrepancies</b>, where {dir === 'receipt' ? 'the receiving store' : 'the sending store'} gives a reason and head office approves.
                </div>
              )}
            </div>
          )}

          {job.message && <Alert tone="bad">{job.message}</Alert>}
          <div className="flex justify-end">
            <button className="btn-primary" disabled={!canSave || job.stage === 'saving'} onClick={save}>
              {job.stage === 'saving' ? 'Saving…' : 'Save STV'}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function LocationPicker({ label, value, onChange }: { label: string; value: string; onChange: (code: string, name: string) => void }) {
  const a = useAuth();
  return (
    <Field label={label}>
      <select className="input" value={value} onChange={(e) => {
        const l = a.locations.find((x) => x.code === e.target.value);
        onChange(e.target.value, l?.erp_name ?? '');
      }}>
        <option value="">Choose ERP store…</option>
        {a.locations.map((l) => <option key={l.code} value={l.code}>{l.erp_name} ({l.code})</option>)}
      </select>
    </Field>
  );
}
