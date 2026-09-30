import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Card, Field, FileDrop, PageHeader, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth';
import { fmtQty, kwToday } from '../lib/format';
import { parseAllocationGrid, type ParsedPlan } from '../lib/parsers/allocationSheet';
import { readSpreadsheet, type SheetData } from '../lib/parsers/sheet';
import { friendlyError, rpc, supabase, uploadDocument } from '../lib/supabase';

export default function AllocationNew() {
  const a = useAuth();
  const nav = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [plan, setPlan] = useState<ParsedPlan | null>(null);
  const [source, setSource] = useState<number | ''>('');
  const [date, setDate] = useState(kwToday());
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [unknown, setUnknown] = useState<string[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (f: File) => {
    setErr('');
    setPlan(null);
    try {
      const s = await readSpreadsheet(f);
      setFile(f);
      setSheets(s);
      setSheetIdx(0);
      setTitle(f.name.replace(/\.[^.]+$/, ''));
    } catch (e) {
      setErr(friendlyError(e));
    }
  };

  useEffect(() => {
    if (!sheets[sheetIdx] || !file) return;
    const p = parseAllocationGrid(sheets[sheetIdx].rows, a.sites.map((s) => ({ id: s.id, name: s.name, aliases: s.aliases })), file.name);
    setPlan(p);
    setSource(p.sourceSiteId ?? '');
    if (p.planDate) setDate(p.planDate);
    // which item codes are not in the masterlist?
    const codes = [...new Set(p.lines.map((l) => l.itemCode))];
    setUnknown(null);
    (async () => {
      const known = new Set<string>();
      for (let i = 0; i < codes.length; i += 300) {
        const { data } = await supabase.from('items').select('item_code').in('item_code', codes.slice(i, i + 300));
        (data ?? []).forEach((r: { item_code: string }) => known.add(r.item_code));
      }
      setUnknown(codes.filter((c) => !known.has(c)));
    })();
  }, [sheets, sheetIdx, file, a.sites]);

  const dests = plan?.destinations.filter((d) => d.siteId !== source) ?? [];
  const submit = async () => {
    if (!plan || !source || !file) return;
    setBusy(true);
    setErr('');
    try {
      const path = await uploadDocument('plans', file);
      const res = await rpc<{ id: string; ref: string }>('create_allocation', {
        p: {
          from_site_id: source, plan_date: date, title, notes, source_file: path,
          legs: dests.map((d) => ({
            to_site_id: d.siteId,
            lines: plan.lines.filter((l) => l.qty[d.siteId]).map((l) => ({ item_code: l.itemCode, item_name: l.itemName, barcode: l.barcode, qty: l.qty[d.siteId] })),
          })).filter((leg) => leg.lines.length),
        },
      });
      nav(`/allocations/${res.id}`);
    } catch (e) {
      setErr(friendlyError(e));
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl">
      <PageHeader title="Upload allocation plan" subtitle="Use the same Excel you send to stores today - internal (From Store / Variant / Barcode / Item Name / store columns) or DC (Item Code / … / DC QTY / store columns)." />
      <FileDrop accept=".xlsx,.csv" onFiles={(f) => f[0] && load(f[0])} label={file ? `Loaded: ${file.name} - drop another to replace` : 'Drop the allocation Excel here'} />
      {err && <div className="mt-3"><Alert tone="bad">{err}</Alert></div>}
      {sheets.length > 1 && (
        <div className="mt-3 w-64"><Field label="Sheet"><select className="input" value={sheetIdx} onChange={(e) => setSheetIdx(Number(e.target.value))}>{sheets.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}</select></Field></div>
      )}
      {plan && (
        <div className="mt-4 space-y-4">
          {plan.errors.map((e) => <Alert key={e} tone="bad">{e}</Alert>)}
          {plan.warnings.map((w) => <Alert key={w} tone="warn">{w}</Alert>)}
          {plan.errors.length === 0 && (
            <>
              <Card title="Plan details">
                <div className="grid gap-3 md:grid-cols-4">
                  <Field label="Sending store / DC" hint={plan.sourceText ? `Found in file: "${plan.sourceText}"` : 'Not found in the file - choose it'}>
                    <select className="input" value={source} onChange={(e) => setSource(e.target.value ? Number(e.target.value) : '')}>
                      <option value="">Choose…</option>
                      {a.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Plan date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
                  <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
                  <Field label="Notes for stores"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
                </div>
              </Card>
              <Card title="What each store will receive" pad={false}>
                <table className="w-full">
                  <thead><tr><th className="th">Destination</th><th className="th text-right">SKUs</th><th className="th text-right">Pieces</th><th className="th">Excel column</th></tr></thead>
                  <tbody>
                    {dests.map((d) => {
                      const ls = plan.lines.filter((l) => l.qty[d.siteId]);
                      return (
                        <tr key={d.siteId}>
                          <td className="td font-medium">{a.siteName(d.siteId)}</td>
                          <td className="td num">{ls.length}</td>
                          <td className="td num">{fmtQty(ls.reduce((s, l) => s + l.qty[d.siteId], 0))}</td>
                          <td className="td text-sm text-slate-500">{d.header}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
              {unknown === null ? <Spinner label="Checking items against masterlist…" /> : unknown.length > 0 && (
                <Alert tone="warn" title={`${unknown.length} item code(s) are not in the masterlist`}>
                  {unknown.slice(0, 15).join(', ')}{unknown.length > 15 ? '…' : ''} - the plan can still be saved; update the masterlist to see names and values.
                </Alert>
              )}
              <div className="flex justify-end gap-2">
                <button className="btn-secondary" onClick={() => nav('/allocations')}>Cancel</button>
                <button className="btn-primary" disabled={!source || busy || dests.length === 0} onClick={submit}>
                  {busy ? 'Creating…' : `Create allocation (${dests.length} store${dests.length === 1 ? '' : 's'})`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
