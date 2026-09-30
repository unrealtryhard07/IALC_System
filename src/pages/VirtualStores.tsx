import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable } from '../components/DataTable';
import { Alert, Badge, Card, Field, FileDrop, Modal, PageHeader, Spinner, Stat, Tabs } from '../components/ui';
import { useAuth } from '../lib/auth';
import { AGE_BUCKETS, ageBucket, fmtDate, fmtDateTime, fmtKwd, fmtQty, kwToday, sum } from '../lib/format';
import { VS_STATUS } from '../lib/labels';
import { readSpreadsheet } from '../lib/parsers/sheet';
import { parseSnapshotGrid, type SnapshotRow } from '../lib/parsers/snapshot';
import { norm } from '../lib/parsers/sheet';
import { fetchAll, friendlyError, rpc, supabase, uploadDocument } from '../lib/supabase';
import type { VsRow } from '../lib/types';

interface Snap { id: string; location_code: string; snapshot_date: string; file_name: string | null; line_count: number; total_qty: number; uploaded_at: string }

export default function VirtualStores() {
  const a = useAuth();
  const allocs = a.locations.filter((l) => l.kind === 'allocation' && (a.isHO || a.mySiteIds.includes(l.site_id)));
  const [loc, setLoc] = useState<string>('all');
  const [rows, setRows] = useState<VsRow[] | null>(null);
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [status, setStatus] = useState('');
  const [upload, setUpload] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    setRows(null);
    Promise.all([
      fetchAll<VsRow>((f, t) => supabase.from('v_vs_latest').select('*').range(f, t)),
      supabase.from('vs_snapshots').select('*').order('snapshot_date', { ascending: false }).limit(60),
    ]).then(([r, s]) => { setRows(r); setSnaps((s.data as Snap[]) ?? []); }).catch((e) => setErr(friendlyError(e)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => (rows ?? []).filter((r) => (loc === 'all' || r.location_code === loc) && (!status || r.match_status === status)), [rows, loc, status]);
  const scope = (rows ?? []).filter((r) => loc === 'all' || r.location_code === loc);
  const erpRows = scope.filter((r) => r.erp_qty > 0);
  const canUpload = a.isAdmin || (a.profile?.role === 'store' && allocs.length > 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Stuck stock check"
        subtitle="Upload the ERP stock report of each Allocation (virtual) store. The system tells you which stock is stuck there, for how long, and why - so it can be received before it expires."
        actions={canUpload && <button className="btn-primary" onClick={() => setUpload(true)}>Upload ERP stock report</button>} />
      {err && <Alert tone="bad">{err}</Alert>}
      <Tabs value={loc} onChange={setLoc} tabs={[{ value: 'all', label: 'All allocation stores' }, ...allocs.map((l) => ({ value: l.code, label: `${l.erp_name} (${l.code})` }))]} />
      {!rows ? <Spinner /> : (
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
