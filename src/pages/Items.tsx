import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Card, FileDrop, Modal, PageHeader, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth';
import { downloadExcel } from '../lib/excel';
import { fmtDateTime, fmtQty, kwToday } from '../lib/format';
import { parseMasterlistGrid, type ParsedMasterlist } from '../lib/parsers/masterlist';
import { readSpreadsheet } from '../lib/parsers/sheet';
import { fetchAll, friendlyError, rpc, supabase, uploadDocument } from '../lib/supabase';

interface Item { item_code: string; barcode: string | null; name: string | null; category: string | null; brand: string | null; uom: string | null; cost: number | null; shelf_life_days: number | null; active: boolean; updated_at: string }
interface Import { id: number; file_name: string | null; total_rows: number; inserted: number; updated: number; uploaded_at: string }
const PAGE = 50;

export default function Items() {
  const a = useAuth();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Item[] | null>(null);
  const [count, setCount] = useState(0);
  const [imports, setImports] = useState<Import[]>([]);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setRows(null);
    let query = supabase.from('items').select('*', { count: 'exact' }).order('item_code').range(page * PAGE, page * PAGE + PAGE - 1);
    const term = q.trim().replace(/[,()%]/g, ' ');
    if (term) query = query.or(`item_code.ilike.%${term}%,barcode.ilike.%${term}%,name.ilike.%${term}%`);
    const { data, count: c, error } = await query;
    if (error) setErr(friendlyError(error));
    setRows((data as Item[]) ?? []);
    setCount(c ?? 0);
  }, [q, page]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    if (a.isHO) supabase.from('item_imports').select('*').order('uploaded_at', { ascending: false }).limit(10).then(({ data }) => setImports((data as Import[]) ?? []));
  }, [a.isHO, open]);

  const exportAll = async () => {
    const all = await fetchAll<Item>((f, t) => supabase.from('items').select('*').order('item_code').range(f, t));
    await downloadExcel(`items_masterlist_${kwToday()}`, [{
      name: 'Items',
      columns: [{ header: 'Item Code', width: 12 }, { header: 'Barcode', width: 16 }, { header: 'Item Name', width: 50 }, { header: 'Category', width: 18 }, { header: 'Brand', width: 16 }, { header: 'UOM' }, { header: 'Cost (KWD)', numFmt: '0.000' }, { header: 'Shelf life (days)' }, { header: 'Status' }],
      rows: all.map((i) => [i.item_code, i.barcode, i.name, i.category, i.brand, i.uom, i.cost, i.shelf_life_days, i.active ? 'Active' : 'Inactive']),
    }]);
  };

  const pages = Math.max(1, Math.ceil(count / PAGE));
  return (
    <div className="space-y-4">
      <PageHeader title="Items masterlist" subtitle="Item codes, names and costs used everywhere in the system. Upload the latest masterlist any time - it updates existing items and adds new ones."
        actions={<>
          <button className="btn-secondary" onClick={exportAll}>Export all</button>
          {a.isAdmin && <button className="btn-primary" onClick={() => setOpen(true)}>Update masterlist</button>}
        </>} />
      {err && <Alert tone="bad">{err}</Alert>}
      <Card pad={false}>
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
          <input className="input w-72" placeholder="Search code, barcode or name…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
          <span className="ml-auto text-xs text-slate-500">{fmtQty(count)} items</span>
        </div>
        {!rows ? <Spinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">Item code</th><th className="th">Barcode</th><th className="th">Name</th><th className="th">Category</th><th className="th">Brand</th><th className="th text-right">Cost KWD</th><th className="th text-right">Shelf life</th><th className="th">Status</th></tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.item_code} className="hover:bg-slate-50">
                    <td className="td font-mono text-xs">{i.item_code}</td><td className="td font-mono text-xs">{i.barcode}</td><td className="td">{i.name}</td>
                    <td className="td text-sm">{i.category}</td><td className="td text-sm">{i.brand}</td>
                    <td className="td num">{i.cost == null ? '–' : Number(i.cost).toFixed(3)}</td><td className="td num">{i.shelf_life_days ?? '–'}</td>
                    <td className="td">{i.active ? <Badge tone="good">Active</Badge> : <Badge>Inactive</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <div className="p-8 text-center text-sm text-slate-500">{count === 0 && !q ? 'The masterlist is empty - upload it with "Update masterlist".' : 'No items match.'}</div>}
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 px-3 py-2 text-xs">
            <button className="btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Prev</button>
            <span>Page {page + 1} / {pages}</span>
            <button className="btn-secondary btn-sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next ›</button>
          </div>
        )}
      </Card>
      {a.isHO && imports.length > 0 && (
        <Card title="Recent masterlist uploads" pad={false}>
          <table className="w-full"><tbody>
            {imports.map((i) => <tr key={i.id}><td className="td">{i.file_name}</td><td className="td text-sm text-slate-500">{fmtDateTime(i.uploaded_at)}</td><td className="td num text-sm">{fmtQty(i.total_rows)} rows · {fmtQty(i.inserted)} new · {fmtQty(i.updated)} updated</td></tr>)}
          </tbody></table>
        </Card>
      )}
      {open && <ImportModal onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(); }} />}
    </div>
  );
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedMasterlist | null>(null);
  const [progress, setProgress] = useState<{ done: number; inserted: number; updated: number } | null>(null);
  const [err, setErr] = useState('');
  const run = async () => {
    if (!parsed || !file) return;
    setErr('');
    const CHUNK = 1000;
    let importId: number | null = null;
    let inserted = 0, updated = 0;
    try {
      await uploadDocument('masterlist', file);
      for (let i = 0; i < parsed.items.length; i += CHUNK) {
        const last = i + CHUNK >= parsed.items.length;
        const r: { import_id: number; inserted: number; updated: number } = await rpc('import_items', { p_items: parsed.items.slice(i, i + CHUNK), p_file_name: file.name, p_final: last, p_import_id: importId });
        importId = r.import_id; inserted += r.inserted; updated += r.updated;
        setProgress({ done: Math.min(i + CHUNK, parsed.items.length), inserted, updated });
      }
    } catch (e) { setErr(friendlyError(e)); }
  };
  const finished = progress && parsed && progress.done >= parsed.items.length;
  return (
    <Modal open title="Update items masterlist" onClose={onClose} footer={finished ? <button className="btn-primary" onClick={onDone}>Done</button> : <>
      <button className="btn-secondary" onClick={onClose} disabled={!!progress}>Cancel</button>
      <button className="btn-primary" onClick={run} disabled={!parsed || !!parsed.errors.length || !!progress}>Import {parsed ? fmtQty(parsed.items.length) : ''} items</button>
    </>}>
      <div className="space-y-3">
        <FileDrop accept=".xlsx,.csv" onFiles={async (f) => {
          if (!f[0]) return;
          setFile(f[0]); setErr(''); setProgress(null);
          try { const s = await readSpreadsheet(f[0]); setParsed(parseMasterlistGrid(s[0]?.rows ?? [])); } catch (e) { setErr(friendlyError(e)); }
        }} label={file ? file.name : 'Drop the masterlist Excel / CSV'} />
        <p className="text-xs text-slate-500">Needed: an Item Code column (also recognised: Variant, SKU, Item No). Optional: Barcode, Item Name, Category, Brand, UOM, Cost, Shelf life, Status. Items not in the file are kept. Empty cells never erase existing data.</p>
        {parsed && <>
          {parsed.errors.map((e) => <Alert key={e} tone="bad">{e}</Alert>)}
          {parsed.warnings.map((w) => <Alert key={w} tone="warn">{w}</Alert>)}
          <div className="text-sm">Found <b>{fmtQty(parsed.items.length)}</b> items. Columns: {Object.entries(parsed.detected).map(([k, v]) => <Badge key={k}>{k}: {v}</Badge>)}</div>
        </>}
        {progress && parsed && (
          <div>
            <div className="h-2 rounded bg-slate-100"><div className="h-2 rounded bg-brand-500" style={{ width: `${(progress.done / parsed.items.length) * 100}%` }} /></div>
            <div className="mt-1 text-sm">{fmtQty(progress.done)} / {fmtQty(parsed.items.length)} · {fmtQty(progress.inserted)} new · {fmtQty(progress.updated)} updated</div>
          </div>
        )}
        {finished && <Alert tone="good">Masterlist updated.</Alert>}
        {err && <Alert tone="bad">{err}</Alert>}
      </div>
    </Modal>
  );
}
