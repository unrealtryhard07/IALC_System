import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DataTable } from '../components/DataTable';
import { Icon } from '../components/Icon';
import { Alert, Badge, Card, Field, FileDrop, Modal, PageHeader, Spinner, Stat, Tabs } from '../components/ui';
import { useAuth } from '../lib/auth';
import { AGE_BUCKETS, ageBucket, fmtDate, fmtDateTime, fmtKwd, fmtQty, kwToday, sum } from '../lib/format';
import { BACKLOG_ACTION, BACKLOG_STATUS, VS_STATUS } from '../lib/labels';
import { readSpreadsheet } from '../lib/parsers/sheet';
import { parseSnapshotGrid, type SnapshotRow } from '../lib/parsers/snapshot';
import { norm } from '../lib/parsers/sheet';
import { fetchAll, friendlyError, rpc, supabase, uploadDocument } from '../lib/supabase';
import type { BacklogActionRow, VsRow } from '../lib/types';

interface Snap { id: string; location_code: string; snapshot_date: string; file_name: string | null; line_count: number; total_qty: number; uploaded_at: string }

export default function VirtualStores() {
  const a = useAuth();
  const allocs = a.locations.filter((l) => l.kind === 'allocation' && (a.isHO || a.mySiteIds.includes(l.site_id)));
  const [loc, setLoc] = useState<string>('all');
  const [rows, setRows] = useState<VsRow[] | null>(null);
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [actions, setActions] = useState<BacklogActionRow[]>([]);
  const [sp, setSp] = useSearchParams();
  const view = sp.get('tab') === 'cleanup' ? 'cleanup' : 'check';
  const [status, setStatus] = useState('');
  const [upload, setUpload] = useState(false);
  const [err, setErr] = useState('');

  // refreshes in place (the page stays on screen, so messages after an action are kept)
  const load = useCallback(() => {
    Promise.all([
      fetchAll<VsRow>((f, t) => supabase.from('v_vs_latest').select('*').range(f, t)),
      supabase.from('vs_snapshots').select('*').order('snapshot_date', { ascending: false }).limit(60),
      fetchAll<BacklogActionRow>((f, t) => supabase.from('v_backlog_actions').select('*').neq('status', 'rejected').range(f, t)),
      fetchAll<BacklogActionRow>((f, t) => supabase.from('v_backlog_actions').select('*').eq('status', 'rejected').gte('decided_at', new Date(Date.now() - 30 * 864e5).toISOString()).range(f, t)),
    ]).then(([r, s, ac, rj]) => { setRows(r); setSnaps((s.data as Snap[]) ?? []); setActions([...ac, ...rj]); }).catch((e) => setErr(friendlyError(e)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => (rows ?? []).filter((r) => (loc === 'all' || r.location_code === loc) && (!status || r.match_status === status)), [rows, loc, status]);
  const scope = (rows ?? []).filter((r) => loc === 'all' || r.location_code === loc);
  const erpRows = scope.filter((r) => r.erp_qty > 0);
  const canUpload = a.isAdmin || (a.profile?.role === 'store' && allocs.length > 0);

  return (
    <div className="space-y-4">
      <PageHeader title={view === 'cleanup' ? 'Old stock clean-up' : 'Stuck stock check'}
        subtitle={view === 'cleanup'
          ? 'Decide what happens to every item stuck in an Allocation (virtual) store. Head office approves, the ERP transfer is made, and the next ERP stock report shows it cleared.'
          : 'Upload the ERP stock report of each Allocation (virtual) store. The system tells you which stock is stuck there, for how long, and why - so it can be received before it expires.'}
        actions={<>
          {allocs.length > 1 && (
            <select className="input w-auto" value={loc} onChange={(e) => setLoc(e.target.value)} aria-label="Allocation store">
              <option value="all">All allocation stores</option>
              {allocs.map((l) => <option key={l.code} value={l.code}>{l.erp_name} ({l.code})</option>)}
            </select>
          )}
          {canUpload && <button className="btn-primary" onClick={() => setUpload(true)}><Icon name="upload" className="h-4 w-4" />Upload ERP stock report</button>}
        </>} />
      {err && <Alert tone="bad">{err}</Alert>}
      <Tabs value={view} onChange={(v) => setSp(v === 'cleanup' ? { tab: 'cleanup' } : {}, { replace: true })}
        tabs={[{ value: 'check', label: 'Check' }, { value: 'cleanup', label: <>Clean-up{actions.some((x) => x.status === 'pending') && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-xs text-amber-800">{actions.filter((x) => x.status === 'pending').length}</span>}</> }]} />
      {!rows ? <Spinner /> : view === 'cleanup' ? (
        <Cleanup rows={scope} actions={actions.filter((x) => loc === 'all' || x.location_code === loc)} snaps={snaps.filter((x) => loc === 'all' || x.location_code === loc)} onChanged={load} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Stock in virtual stores" value={`${fmtQty(sum(erpRows, (r) => r.erp_qty))} pcs`} sub={`${erpRows.length} SKUs`} tone="info" />
            <Stat label="Value" value={fmtKwd(sum(erpRows, (r) => r.erp_value ?? 0))} sub="needs cost in masterlist" />
            <Stat label="Unknown stuck stock" value={scope.filter((r) => r.match_status === 'not_in_system').length} sub={`${fmtQty(sum(scope.filter((r) => r.match_status === 'not_in_system'), (r) => r.erp_qty))} pcs - backlog / untracked`} tone="bad" onClick={() => setStatus('not_in_system')} />
            <Stat label="Received, not uploaded" value={scope.filter((r) => r.match_status === 'receipt_not_uploaded').length} sub="posted in ERP, missing here" tone="purple" onClick={() => setStatus('receipt_not_uploaded')} />
            <Stat label="Oldest item" value={`${Math.max(0, ...erpRows.map((r) => r.age_days ?? 0))} days`} sub={loc !== 'all' && scope[0]?.snapshot_date ? `snapshot ${fmtDate(scope[0].snapshot_date)}` : undefined} tone="warn" />
          </div>
          <AgeStrip rows={erpRows} />
          <Card pad={false}>
            <DataTable<VsRow>
              rows={shown}
              rowKey={(r) => `${r.location_code}-${r.item_code}`}
              exportName={`virtual_store_${loc}_${kwToday()}`}
              initialSort={{ key: 'age', dir: -1 }}
              empty={snaps.length ? 'Nothing here.' : 'No ERP stock report uploaded yet.'}
              toolbar={
                <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">All statuses</option>
                  {Object.entries(VS_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>}
              columns={[
                { key: 'loc', header: 'Store', value: (r) => r.location_code, render: (r) => <span title={r.erp_name} className="font-mono text-xs">{r.location_code}</span> },
                { key: 'code', header: 'Item', value: (r) => r.item_code, className: 'font-mono text-xs' },
                { key: 'name', header: 'Name', value: (r) => r.item_name, className: 'min-w-[220px]' },
                { key: 'erp', header: 'In ERP', align: 'right', value: (r) => r.erp_qty, render: (r) => fmtQty(r.erp_qty) },
                { key: 'sys', header: 'Expected (on the way)', align: 'right', value: (r) => r.system_open_qty, render: (r) => fmtQty(r.system_open_qty) },
                { key: 'diff', header: 'Unexplained', align: 'right', value: (r) => r.diff_qty, render: (r) => <b className={r.diff_qty > 0 ? 'text-red-700' : r.diff_qty < 0 ? 'text-violet-700' : 'text-slate-400'}>{fmtQty(r.diff_qty)}</b> },
                { key: 'val', header: 'Value KWD', align: 'right', value: (r) => (r.erp_value ? Number(Number(r.erp_value).toFixed(3)) : null) },
                { key: 'since', header: 'In store since', value: (r) => r.since_date, render: (r) => fmtDate(r.since_date) },
                { key: 'age', header: 'Age (days)', align: 'right', value: (r) => r.age_days, render: (r) => (r.age_days == null ? '–' : <Badge tone={r.age_days > 30 ? 'bad' : r.age_days > a.receiptSla ? 'warn' : 'info'}>{r.age_days}</Badge>) },
                { key: 'st', header: 'Status', value: (r) => VS_STATUS[r.match_status].label, render: (r) => <Badge tone={VS_STATUS[r.match_status].tone} title={VS_STATUS[r.match_status].help}>{VS_STATUS[r.match_status].label}</Badge> },
              ]}
            />
          </Card>
          <Card title="Uploaded ERP reports" pad={false}>
            {snaps.length === 0 ? <div className="p-4 text-sm text-slate-500">None yet. Export the stock-on-hand of each Allocation store from the ERP (Excel/CSV with item code + quantity) and upload it here, ideally every week.</div> : (
              <table className="w-full"><tbody>
                {snaps.map((s) => (
                  <tr key={s.id}><td className="td">{a.locationLabel(s.location_code)}</td><td className="td">{fmtDate(s.snapshot_date)}</td><td className="td num">{s.line_count} SKUs · {fmtQty(s.total_qty)} pcs</td><td className="td text-sm text-slate-500">{s.file_name} · {fmtDateTime(s.uploaded_at)}</td></tr>
                ))}
              </tbody></table>
            )}
          </Card>
        </>
      )}
      {upload && <UploadSnapshot allowed={allocs.map((l) => l.code)} onClose={() => setUpload(false)} onDone={() => { setUpload(false); load(); }} />}
    </div>
  );
}

function AgeStrip({ rows }: { rows: VsRow[] }) {
  const total = sum(rows, (r) => r.erp_qty);
  if (!total) return null;
  const parts = AGE_BUCKETS.map((b) => ({ b, qty: sum(rows.filter((r) => ageBucket(r.age_days ?? 0).key === b.key), (r) => r.erp_qty) })).filter((p) => p.qty > 0);
  return (
    <Card title="ERP virtual-store stock by age">
      <div className="flex h-6 gap-[2px]" role="img" aria-label="Stock by age">
        {parts.map((p, i) => <div key={p.b.key} title={`${p.b.label}: ${fmtQty(p.qty)} pcs`} className={i === parts.length - 1 ? 'rounded-r' : ''} style={{ flexGrow: p.qty, background: p.b.color }} />)}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
        {parts.map((p) => <span key={p.b.key} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.b.color }} />{p.b.label}: <b>{fmtQty(p.qty)}</b> pcs ({((p.qty / total) * 100).toFixed(0)}%)</span>)}
      </div>
    </Card>
  );
}

function UploadSnapshot({ allowed, onClose, onDone }: { allowed: string[]; onClose: () => void; onDone: () => void }) {
  const a = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<{ rows: SnapshotRow[]; detected: Record<string, string>; warnings: string[]; errors: string[] } | null>(null);
  const [loc, setLoc] = useState(allowed[0] ?? '');
  const [date, setDate] = useState(kwToday());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // If the report has a store column, rows are split by it; otherwise everything goes to the chosen store.
  const matchLoc = (text: string | null) => {
    if (!text) return null;
    const t = norm(text);
    return a.locations.find((l) => l.kind === 'allocation' && (norm(l.code) === t || norm(l.erp_name) === t || t.includes(norm(l.erp_name)) || t.split(' ').includes(l.code)))?.code ?? null;
  };
  const groups = useMemo(() => {
    if (!parsed) return new Map<string, SnapshotRow[]>();
    const m = new Map<string, SnapshotRow[]>();
    const hasLoc = parsed.rows.some((r) => r.location);
    for (const r of parsed.rows) {
      const code = hasLoc ? matchLoc(r.location) ?? `?${r.location}` : loc;
      m.set(code, [...(m.get(code) ?? []), r]);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, loc]);
  const unknownGroups = [...groups.keys()].filter((k) => k.startsWith('?') || !allowed.includes(k));

  return (
    <Modal open wide title="Upload ERP stock report (Allocation stores)" onClose={onClose} footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={!parsed || busy || !!parsed.errors.length || groups.size === 0}
        onClick={async () => {
          setBusy(true); setErr('');
          try {
            const path = file ? await uploadDocument('snapshots', file) : null;
            for (const [code, rs] of groups) {
              if (!allowed.includes(code)) continue;
              await rpc('upload_snapshot', { p: { location_code: code, snapshot_date: date, file_name: file?.name, file_path: path,
                rows: rs.map((r) => ({ item_code: r.itemCode, item_name: r.name, qty: r.qty, value: r.value, since_date: r.sinceDate })) } });
            }
            onDone();
          } catch (e) { setErr(friendlyError(e)); setBusy(false); }
        }}>{busy ? 'Saving…' : 'Save snapshot'}</button>
    </>}>
      <div className="space-y-3">
        <FileDrop accept=".xlsx,.csv" onFiles={async (f) => {
          if (!f[0]) return;
          setFile(f[0]); setErr('');
          try { const s = await readSpreadsheet(f[0]); setParsed(parseSnapshotGrid(s[0]?.rows ?? [])); } catch (e) { setErr(friendlyError(e)); }
        }} label={file ? file.name : 'Drop the ERP stock report'} />
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Snapshot date (stock as of)"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          {parsed && !parsed.rows.some((r) => r.location) && (
            <Field label="Allocation store in this report">
              <select className="input" value={loc} onChange={(e) => setLoc(e.target.value)}>
                {allowed.map((c) => <option key={c} value={c}>{a.locationLabel(c)}</option>)}
              </select>
            </Field>
          )}
        </div>
        {parsed && <>
          {parsed.errors.map((e) => <Alert key={e} tone="bad">{e}</Alert>)}
          {parsed.warnings.map((w) => <Alert key={w} tone="warn">{w}</Alert>)}
          <div className="text-xs text-slate-500">Columns used: {Object.entries(parsed.detected).map(([k, v]) => `${k} = "${v}"`).join(', ')}</div>
          <table className="w-full"><tbody>
            {[...groups.entries()].map(([code, rs]) => (
              <tr key={code}><td className="td">{code.startsWith('?') ? <Badge tone="bad">Unknown store "{code.slice(1)}"</Badge> : a.locationLabel(code)}</td><td className="td num">{rs.length} SKUs</td><td className="td num">{fmtQty(sum(rs, (r) => r.qty))} pcs</td></tr>
            ))}
          </tbody></table>
          {unknownGroups.length > 0 && <Alert tone="warn">Rows for unknown or not-permitted stores will be skipped: {unknownGroups.join(', ')}</Alert>}
          <p className="text-xs text-slate-500">If the report has a date column (last receipt / movement), it is used as "in store since". Otherwise the age counts from the first report the item appears in - so upload regularly.</p>
        </>}
        {err && <Alert tone="bad">{err}</Alert>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Old stock clean-up: one row per item with unexplained stock in an Allocation store (plus decided items already cleared).

interface CleanRow {
  key: string; location_code: string; site_id: number; item_code: string; item_name: string | null; stuck_qty: number; value: number;
  age_days: number | null; since_date: string | null; act: BacklogActionRow | null; state: 'none' | 'pending' | 'approved' | 'rejected' | 'cleared';
}

function Cleanup({ rows, actions, snaps, onChanged }: { rows: VsRow[]; actions: BacklogActionRow[]; snaps: Snap[]; onChanged: () => void }) {
  const a = useAuth();
  const [filter, setFilter] = useState<string>('open');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [decide, setDecide] = useState(false);
  const [review, setReview] = useState<'approve' | 'reject' | null>(null);
  const [msg, setMsg] = useState('');

  const data = useMemo(() => {
    const live = new Map<string, BacklogActionRow>();
    // latest decision per item: pending/approved win over an older rejection
    for (const x of actions) {
      const k = `${x.location_code}|${x.item_code}`;
      const cur = live.get(k);
      if (!cur || (cur.status === 'rejected' && x.status !== 'rejected') || (cur.status === x.status && x.requested_at > cur.requested_at)) live.set(k, x);
    }
    const out: CleanRow[] = rows.filter((r) => r.diff_qty > 0).map((r) => {
      const act = live.get(`${r.location_code}|${r.item_code}`) ?? null;
      return {
        key: `${r.location_code}|${r.item_code}`, location_code: r.location_code, site_id: r.site_id, item_code: r.item_code, item_name: r.item_name,
        stuck_qty: Number(r.diff_qty), value: Number(r.diff_qty) * Number(r.cost ?? 0), age_days: r.age_days, since_date: r.since_date, act,
        state: !act ? 'none' : act.cleared ? 'cleared' : act.status,
      };
    });
    const seen = new Set(out.map((r) => r.key));
    for (const [k, act] of live) {
      if (seen.has(k) || act.status === 'rejected') continue;
      out.push({ key: k, location_code: act.location_code, site_id: act.site_id, item_code: act.item_code, item_name: act.item_name, stuck_qty: 0,
        value: 0, age_days: null, since_date: null, act, state: act.cleared || Number(act.latest_erp_qty) <= 0 ? 'cleared' : act.status });
    }
    return out;
  }, [rows, actions]);

  const count = (st: string) => data.filter((r) => r.state === st).length;
  const shown = data.filter((r) => filter === 'all' || (filter === 'open' ? ['none', 'rejected'].includes(r.state) : r.state === filter));
  const selectedRows = data.filter((r) => sel.has(r.key));
  const canDecide = (r: CleanRow) => a.canActFor(r.site_id) && ['none', 'rejected', 'pending'].includes(r.state) && r.stuck_qty > 0;
  const canReview = (r: CleanRow) => a.isAdmin && r.state === 'pending';
  const selectable = (r: CleanRow) => (filter === 'pending' ? canReview(r) : canDecide(r));

  // progress: first ERP report vs latest, per store in scope
  const byLoc = new Map<string, Snap[]>();
  [...snaps].sort((x, y) => x.snapshot_date.localeCompare(y.snapshot_date)).forEach((s) => byLoc.set(s.location_code, [...(byLoc.get(s.location_code) ?? []), s]));
  const first = [...byLoc.values()].reduce((t, l) => t + Number(l[0].total_qty), 0);
  const last = [...byLoc.values()].reduce((t, l) => t + Number(l[l.length - 1].total_qty), 0);
  const progress = first > 0 ? Math.max(0, Math.min(100, ((first - last) / first) * 100)) : 0;
  const decided = data.filter((r) => r.state !== 'none' && r.state !== 'rejected').length;

  return (
    <div className="space-y-4">
      {msg && <Alert tone="good">{msg}</Alert>}
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="text-xs font-medium text-slate-500">Cleared since the first ERP report</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums">{first ? `${progress.toFixed(1)}%` : '–'}</div>
            </div>
            <div className="text-right text-sm text-slate-500">{first ? <>{fmtQty(first)} pcs at the start → <b className="text-slate-800">{fmtQty(last)} pcs</b> now</> : 'Upload ERP stock reports to track progress'}</div>
          </div>
          <div className="mt-3 h-3 rounded-full bg-slate-100"><div className="h-3 rounded-full bg-green-600 transition-all" style={{ width: `${progress}%` }} /></div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
            <span>Items stuck: <b>{data.filter((r) => r.stuck_qty > 0).length}</b></span>
            <span>Decided: <b>{decided}</b></span>
            <span>Cleared: <b className="text-green-700">{count('cleared')}</b></span>
            <span>Value still stuck: <b>{fmtKwd(sum(data, (r) => r.value))}</b></span>
          </div>
        </div>
        <div className="card p-4 text-sm text-slate-600">
          <div className="mb-1.5 font-semibold text-slate-800">How it works</div>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Tick items and choose what to do with them.</li>
            <li>Head office approves (their own decisions are approved at once).</li>
            <li>Make the transfer or adjustment in the ERP - download the approved list for the ERP team.</li>
            <li>Upload the next ERP stock report: items that are gone show as <b>Cleared</b>.</li>
          </ol>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter">
        {([['open', 'To decide', count('none') + count('rejected')], ['pending', 'Waiting for approval', count('pending')], ['approved', 'Approved - do in ERP', count('approved')],
          ['cleared', 'Cleared', count('cleared')], ['all', 'All', data.length]] as [string, string, number][]).map(([k, label, n]) => (
          <button key={k} onClick={() => { setFilter(k); setSel(new Set()); }}
            className={`rounded-full border px-3 py-1 text-sm ${filter === k ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
            {label} <span className="tabular-nums text-slate-400">{n}</span>
          </button>
        ))}
      </div>

      <Card pad={false}>
        <DataTable<CleanRow>
          rows={shown}
          rowKey={(r) => r.key}
          exportName={`old_stock_${filter}_${kwToday()}`}
          initialSort={{ key: 'age', dir: -1 }}
          selectable selected={sel} onSelectedChange={setSel} isSelectable={selectable}
          empty={rows.length ? 'Nothing in this list.' : 'Upload an ERP stock report of the Allocation stores first (Check tab).'}
          toolbar={<>
            {filter === 'pending' && a.isAdmin ? (<>
              <button className="btn-primary btn-sm" disabled={!sel.size} onClick={() => setReview('approve')}><Icon name="check" className="h-4 w-4" />Approve {sel.size || ''}</button>
              <button className="btn-secondary btn-sm" disabled={!sel.size} onClick={() => setReview('reject')}>Reject</button>
            </>) : (
              <button className="btn-primary btn-sm" disabled={!sel.size} onClick={() => setDecide(true)}>Decide for {sel.size || ''} selected</button>
            )}
          </>}
          columns={[
            { key: 'loc', header: 'Store', value: (r) => r.location_code, render: (r) => <span className="font-mono text-xs" title={a.locationLabel(r.location_code)}>{r.location_code}</span> },
            { key: 'code', header: 'Item', value: (r) => r.item_code, className: 'font-mono text-xs' },
            { key: 'name', header: 'Name', value: (r) => r.item_name, className: 'min-w-[200px]' },
            { key: 'qty', header: 'Stuck (pcs)', align: 'right', value: (r) => r.stuck_qty, render: (r) => <b>{fmtQty(r.stuck_qty)}</b> },
            { key: 'val', header: 'Value KWD', align: 'right', value: (r) => (r.value ? Number(r.value.toFixed(3)) : null) },
            { key: 'age', header: 'Age (days)', align: 'right', value: (r) => r.age_days, render: (r) => (r.age_days == null ? '–' : <Badge tone={r.age_days > 90 ? 'bad' : r.age_days > 30 ? 'warn' : 'info'}>{r.age_days}</Badge>) },
            { key: 'act', header: 'Decision', value: (r) => (r.act && r.state !== 'rejected' ? BACKLOG_ACTION[r.act.action].label : ''), render: (r) => r.act && r.state !== 'rejected'
              ? <span title={BACKLOG_ACTION[r.act.action].help}>{BACKLOG_ACTION[r.act.action].label}{r.act.note && <span className="block text-xs text-slate-500">{r.act.note}</span>}</span> : <span className="text-slate-400">–</span> },
            { key: 'st', header: 'Status', value: (r) => BACKLOG_STATUS[r.state].label, render: (r) => <span>
              <Badge tone={BACKLOG_STATUS[r.state].tone}>{BACKLOG_STATUS[r.state].label}</Badge>
              {r.state === 'rejected' && r.act?.decision_note && <span className="block text-xs text-red-700">{r.act.decision_note}</span>}
            </span> },
            { key: 'when', header: 'Decided', value: (r) => r.act?.decided_at ?? r.act?.requested_at ?? null, render: (r) => (r.act ? fmtDate((r.act.decided_at ?? r.act.requested_at).slice(0, 10)) : '–') },
          ]}
        />
      </Card>

      {decide && <DecideModal rows={selectedRows} onClose={() => setDecide(false)} onDone={(t) => { setDecide(false); setSel(new Set()); setMsg(t); onChanged(); }} />}
      {review && <ReviewModal approve={review === 'approve'} ids={selectedRows.map((r) => r.act!.id)} onClose={() => setReview(null)}
        onDone={(t) => { setReview(null); setSel(new Set()); setMsg(t); onChanged(); }} />}
    </div>
  );
}

function DecideModal({ rows, onClose, onDone }: { rows: CleanRow[]; onClose: () => void; onDone: (msg: string) => void }) {
  const a = useAuth();
  const [action, setAction] = useState('to_store');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const needsNote = action === 'write_off' || action === 'investigate';
  return (
    <Modal open title={`Decide for ${rows.length} item(s) · ${fmtQty(sum(rows, (r) => r.stuck_qty))} pcs`} onClose={onClose} footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={busy || (needsNote && !note.trim())} onClick={async () => {
        setBusy(true); setErr('');
        try {
          const byLoc = new Map<string, CleanRow[]>();
          rows.forEach((r) => byLoc.set(r.location_code, [...(byLoc.get(r.location_code) ?? []), r]));
          let saved = 0;
          for (const [code, rs] of byLoc) {
            const r = await rpc<{ saved: number }>('propose_backlog', { p: { location_code: code, action, note, items: rs.map((x) => ({ item_code: x.item_code, qty: x.stuck_qty })) } });
            saved += r.saved;
          }
          onDone(a.isAdmin ? `${saved} item(s) decided and approved. Download the "Approved" list for the ERP team.` : `${saved} item(s) sent to head office for approval.`);
        } catch (e) { setErr(friendlyError(e)); setBusy(false); }
      }}>{busy ? 'Saving…' : a.isAdmin ? 'Save & approve' : 'Send for approval'}</button>
    </>}>
      <div className="space-y-3">
        <div className="space-y-2">
          {Object.entries(BACKLOG_ACTION).map(([k, v]) => (
            <label key={k} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${action === k ? 'border-brand-400 bg-brand-50/50' : 'border-slate-200 hover:bg-slate-50'}`}>
              <input type="radio" name="action" className="mt-1 accent-brand-600" checked={action === k} onChange={() => setAction(k)} />
              <span><span className="block text-sm font-medium">{v.label}</span><span className="block text-xs text-slate-500">{v.help}</span></span>
            </label>
          ))}
        </div>
        <Field label={needsNote ? 'Note (required)' : 'Note (optional)'}>
          <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. counted in the store on 30-09, all expired" />
        </Field>
        {err && <Alert tone="bad">{err}</Alert>}
      </div>
    </Modal>
  );
}

function ReviewModal({ approve, ids, onClose, onDone }: { approve: boolean; ids: string[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Modal open title={`${approve ? 'Approve' : 'Reject'} ${ids.length} decision(s)`} onClose={onClose} footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className={approve ? 'btn-primary' : 'btn-danger'} disabled={busy || (!approve && !note.trim())} onClick={async () => {
        setBusy(true); setErr('');
        try {
          const n = await rpc<number>('decide_backlog', { p_ids: ids, p_approve: approve, p_note: note });
          onDone(`${n} decision(s) ${approve ? 'approved' : 'rejected'}.`);
        } catch (e) { setErr(friendlyError(e)); setBusy(false); }
      }}>{busy ? 'Saving…' : approve ? 'Approve' : 'Reject'}</button>
    </>}>
      <Field label={approve ? 'Note (optional)' : 'Why is it rejected? (the store sees this)'}>
        <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {err && <div className="mt-3"><Alert tone="bad">{err}</Alert></div>}
    </Modal>
  );
}
