// Phone receiving: the receiving store counts what arrived, line by line (or by scanning barcodes),
// then gets the exact list to key into the ERP as the receiving STV (Allocation -> D.S).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Alert, Badge, Card, Empty, PageHeader, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth';
import { downloadExcel } from '../lib/excel';
import { fmtDate, fmtDateTime, fmtQty, kwToday, sum } from '../lib/format';
import { fetchAll, friendlyError, rpc, supabase } from '../lib/supabase';
import type { DispatchItemRow, ReceiveCount } from '../lib/types';

interface Incoming { stv_id: string; doc_no: string; stv_date: string; from_site_id: number; to_site_id: number; to_code: string; lines: number; qty: number; open: number; age: number; count: ReceiveCount | null }

export default function ReceiveList() {
  const a = useAuth();
  const [rows, setRows] = useState<Incoming[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    Promise.all([
      fetchAll<DispatchItemRow>((f, t) => supabase.from('v_dispatch_items').select('*').eq('direction', 'dispatch').gt('raw_open_qty', 0).range(f, t)),
      fetchAll<ReceiveCount>((f, t) => supabase.from('receive_counts').select('*').range(f, t)),
    ]).then(([items, counts]) => {
      const mine = items.filter((r) => a.isHO || a.mySiteIds.includes(r.to_site_id));
      const by = new Map<string, Incoming>();
      for (const r of mine) {
        const e = by.get(r.stv_id) ?? { stv_id: r.stv_id, doc_no: r.doc_no, stv_date: r.stv_date, from_site_id: r.from_site_id, to_site_id: r.to_site_id,
          to_code: r.to_code, lines: 0, qty: 0, open: 0, age: r.age_days, count: counts.find((c) => c.dispatch_id === r.stv_id) ?? null };
        e.lines += 1; e.qty += Number(r.dispatched_qty); e.open += Number(r.raw_open_qty);
        by.set(r.stv_id, e);
      }
      setRows([...by.values()].sort((x, y) => x.stv_date.localeCompare(y.stv_date)));
    }).catch((e) => setErr(friendlyError(e)));
  }, [a]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Receive stock" subtitle="Transfers sent to your store that are not received yet. Open one when the goods arrive and count them - on your phone is fine." />
      {err && <Alert tone="bad">{err}</Alert>}
      {!rows ? <Spinner /> : rows.length === 0 ? (
        <Card><Empty><Icon name="checkCircle" className="mx-auto mb-2 h-8 w-8 text-green-600" />Nothing is waiting to be received.</Empty></Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.stv_id}>
              <Link to={`/receive/${r.stv_id}`} className="card flex items-center gap-4 p-4 transition hover:border-brand-200 hover:shadow-md">
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${r.age > a.receiptSla ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-brand-600'}`}><Icon name="truck" className="h-6 w-6" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">STV {r.doc_no} <span className="font-normal text-slate-500">from {a.siteName(r.from_site_id)}</span></span>
                  <span className="block text-sm text-slate-500">{fmtDate(r.stv_date)} · {r.lines} items · {fmtQty(r.open)} of {fmtQty(r.qty)} pcs to receive{a.isHO ? ` · to ${a.siteName(r.to_site_id)}` : ''}</span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {r.age > a.receiptSla ? <Badge tone="bad">{r.age} days - late</Badge> : <Badge tone="info">{r.age} day(s)</Badge>}
                    {r.count && <Badge tone={r.count.short_lines + r.count.over_lines ? 'warn' : 'good'}>Counted{r.count.short_lines + r.count.over_lines ? ` · ${r.count.short_lines + r.count.over_lines} difference(s)` : ' · all OK'}</Badge>}
                  </span>
                </span>
                <span className="hidden text-sm font-medium text-brand-600 sm:block">{r.count ? 'Open' : 'Count'}</span>
                <Icon name="chevronRight" className="h-5 w-5 text-slate-300" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface Line { item_code: string; name: string | null; barcode: string | null; expected: number; received: number; extra?: boolean }
type Filter = 'all' | 'todo' | 'diff';

export function ReceiveCountPage() {
  const { id = '' } = useParams();
  const a = useAuth();
  const nav = useNavigate();
  const [head, setHead] = useState<{ doc_no: string; stv_date: string; from_site_id: number; to_site_id: number; to_code: string } | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [prev, setPrev] = useState<ReceiveCount | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [scan, setScan] = useState('');
  const [flash, setFlash] = useState<{ text: string; tone: 'good' | 'bad' } | null>(null);
  const [hit, setHit] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const draftKey = `receive-draft-${id}`;

  useEffect(() => {
    (async () => {
      try {
        const [items, cnt] = await Promise.all([
          fetchAll<DispatchItemRow>((f, t) => supabase.from('v_dispatch_items').select('*').eq('stv_id', id).range(f, t)),
          supabase.from('receive_counts').select('*, receive_count_lines(*)').eq('dispatch_id', id).maybeSingle(),
        ]);
        if (!items.length) { setErr('Transfer not found, or you cannot see it.'); return; }
        const codes = items.map((r) => r.item_code);
        const { data: master } = await supabase.from('items').select('item_code, barcode, name').in('item_code', codes);
        const { data: stvBarcodes } = await supabase.from('stv_lines').select('item_code, barcode').eq('stv_id', id);
        const bc = new Map<string, string | null>();
        (stvBarcodes ?? []).forEach((l: { item_code: string; barcode: string | null }) => l.barcode && bc.set(l.item_code, l.barcode));
        (master ?? []).forEach((m: { item_code: string; barcode: string | null }) => m.barcode && !bc.has(m.item_code) && bc.set(m.item_code, m.barcode));
        const r0 = items[0];
        setHead({ doc_no: r0.doc_no, stv_date: r0.stv_date, from_site_id: r0.from_site_id, to_site_id: r0.to_site_id, to_code: r0.to_code });
        const ls: Line[] = items.map((r) => ({ item_code: r.item_code, name: r.item_name, barcode: bc.get(r.item_code) ?? null, expected: Number(r.dispatched_qty), received: Number(r.received_qty) }))
          .sort((x, y) => (x.name ?? x.item_code).localeCompare(y.name ?? y.item_code));
        const c = cnt.data as (ReceiveCount & { receive_count_lines: { item_code: string; expected_qty: number; counted_qty: number }[] }) | null;
        const init: Record<string, number | null> = {};
        if (c) {
          setPrev(c);
          setNote(c.note ?? '');
          for (const l of c.receive_count_lines) {
            init[l.item_code] = Number(l.counted_qty);
            if (!ls.some((x) => x.item_code === l.item_code)) ls.push({ item_code: l.item_code, name: null, barcode: null, expected: 0, received: 0, extra: true });
          }
        }
        try {
          const draft = JSON.parse(localStorage.getItem(draftKey) ?? 'null') as { counts: Record<string, number | null>; extras: Line[] } | null;
          if (draft) {
            Object.assign(init, draft.counts);
            draft.extras?.forEach((x) => !ls.some((l) => l.item_code === x.item_code) && ls.push(x));
          }
        } catch { /* storage unavailable */ }
        setLines(ls);
        setCounts(init);
      } catch (e) { setErr(friendlyError(e)); }
    })();
  }, [id, draftKey]);

  // keep an unsent count on this device in case the page is closed
  useEffect(() => {
    if (!lines || saved) return;
    try { localStorage.setItem(draftKey, JSON.stringify({ counts, extras: lines.filter((l) => l.extra) })); } catch { /* ignore */ }
  }, [counts, lines, draftKey, saved]);

  const setQty = (code: string, v: number | null) => setCounts((c) => ({ ...c, [code]: v == null ? null : Math.max(0, v) }));
  const show = (text: string, tone: 'good' | 'bad') => { setFlash({ text, tone }); setTimeout(() => setFlash(null), 2500); };

  const onScan = useCallback(async () => {
    const t = scan.trim();
    if (!t || !lines) return;
    setScan('');
    const l = lines.find((x) => x.barcode === t || x.item_code === t);
    if (l) {
      setCounts((c) => ({ ...c, [l.item_code]: (c[l.item_code] ?? 0) + 1 }));
      setHit(l.item_code);
      document.getElementById(`line-${l.item_code}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      show(`+1 ${l.name ?? l.item_code}`, 'good');
      return;
    }
    // not on the voucher: look it up so it can be recorded as an extra item
    if (!/^[\w.-]+$/.test(t)) { show(`"${t}" is not on this transfer`, 'bad'); return; }
    const { data } = await supabase.from('items').select('item_code, name, barcode').or(`item_code.eq.${t},barcode.eq.${t}`).limit(1);
    const m = (data ?? [])[0] as { item_code: string; name: string | null; barcode: string | null } | undefined;
    if (m && window.confirm(`${m.name ?? m.item_code} is NOT on this transfer. Record it as an extra item that arrived?`)) {
      setLines((ls) => [...(ls ?? []), { item_code: m.item_code, name: m.name, barcode: m.barcode, expected: 0, received: 0, extra: true }]);
      setCounts((c) => ({ ...c, [m.item_code]: (c[m.item_code] ?? 0) + 1 }));
      show(`Extra item added: ${m.name ?? m.item_code}`, 'bad');
    } else if (!m) show(`"${t}" is not on this transfer and not in the items list`, 'bad');
  }, [scan, lines]);

  const stats = useMemo(() => {
    const ls = lines ?? [];
    const checked = ls.filter((l) => counts[l.item_code] != null);
    const diff = checked.filter((l) => counts[l.item_code] !== l.expected);
    return {
      checked: checked.length, total: ls.length, diff,
      expected: sum(ls, (l) => l.expected), counted: sum(checked, (l) => counts[l.item_code] ?? 0),
      short: diff.filter((l) => (counts[l.item_code] ?? 0) < l.expected), over: diff.filter((l) => (counts[l.item_code] ?? 0) > l.expected),
    };
  }, [lines, counts]);

  if (err && !lines) return <Alert tone="bad">{err}</Alert>;
  if (!lines || !head) return <Spinner />;
  const canCount = a.canActFor(head.to_site_id);
  const fromLoc = a.locations.find((l) => l.code === head.to_code);
  const dsLoc = a.locations.find((l) => l.site_id === head.to_site_id && l.kind !== 'allocation');
  const shown = lines.filter((l) => filter === 'all' || (filter === 'todo' ? counts[l.item_code] == null : counts[l.item_code] != null && counts[l.item_code] !== l.expected));

  const exportErp = () => downloadExcel(`receive_${head.doc_no}_${kwToday()}`, [{
    name: 'Receive in ERP',
    title: `Receiving STV for ${head.doc_no}: ${fromLoc?.erp_name ?? head.to_code} (${head.to_code}) -> ${dsLoc?.erp_name ?? a.siteName(head.to_site_id)}${dsLoc ? ` (${dsLoc.code})` : ''}`,
    columns: [{ header: 'Item code', width: 14 }, { header: 'Barcode', width: 16 }, { header: 'Item name', width: 42 }, { header: 'Sent', width: 10, numFmt: '#,##0' }, { header: 'Counted - key this', width: 18, numFmt: '#,##0' }, { header: 'Difference', width: 12, numFmt: '#,##0' }],
    rows: lines.filter((l) => (counts[l.item_code] ?? 0) > 0 || l.expected > 0).map((l) => [l.item_code, l.barcode, l.name, l.expected, counts[l.item_code] ?? 0, (counts[l.item_code] ?? 0) - l.expected]),
  }]);

  if (saved) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <PageHeader title="Count saved" subtitle={`STV ${head.doc_no} from ${a.siteName(head.from_site_id)}`} />
        <Alert tone={stats.diff.length ? 'warn' : 'good'} title={stats.diff.length ? `${stats.diff.length} line(s) differ from what was sent` : 'Everything arrived as sent'}>
          {stats.diff.length ? `${stats.short.length} short, ${stats.over.length} extra. Head office can see your count.` : 'Head office can see your count.'}
        </Alert>
        <Card title="Next: make the receiving STV in the ERP">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
            <li>In the ERP create an STV <b>from {fromLoc?.erp_name ?? head.to_code} ({head.to_code})</b> to <b>{dsLoc ? `${dsLoc.erp_name} (${dsLoc.code})` : `your D.S`}</b>.</li>
            <li>Key in the <b>counted</b> quantities - download the list below.</li>
            <li>Upload that STV here. Any line that differs then shows as a problem to explain.</li>
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={exportErp}><Icon name="download" className="h-4 w-4" />Download list for the ERP</button>
            <Link to="/upload" className="btn-primary"><Icon name="upload" className="h-4 w-4" />Upload receiving STV</Link>
            <button className="btn-ghost" onClick={() => nav('/receive')}>Back to list</button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl pb-28">
      <Link to="/receive" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><Icon name="arrowLeft" className="h-4 w-4" />All transfers</Link>
      <PageHeader title={`Receive STV ${head.doc_no}`} subtitle={`From ${a.siteName(head.from_site_id)} to ${a.siteName(head.to_site_id)} · sent ${fmtDate(head.stv_date)}`}
        actions={<button className="btn-secondary btn-sm" onClick={exportErp}><Icon name="download" className="h-4 w-4" />Excel</button>} />
      {prev && <div className="mb-3"><Alert tone="info">Already counted on {fmtDateTime(prev.counted_at)}. Saving again replaces that count.</Alert></div>}
      {!canCount && <div className="mb-3"><Alert tone="warn">Only the receiving store (or head office admin) can save a count. You can still look.</Alert></div>}

      <div className="sticky top-[57px] z-20 -mx-4 mb-3 border-b border-slate-200 bg-slate-50/95 px-4 pb-3 pt-1 backdrop-blur print:hidden">
        <form onSubmit={(e) => { e.preventDefault(); onScan(); }} className="flex gap-2">
          <div className="relative flex-1">
            <Icon name="scan" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input ref={scanRef} value={scan} onChange={(e) => setScan(e.target.value)} inputMode="numeric" autoComplete="off"
              placeholder="Scan barcode or type item code" aria-label="Scan barcode or type item code"
              className="input h-12 pl-10 text-base" />
          </div>
          <button className="btn-secondary h-12 px-4" type="submit">Add 1</button>
        </form>
        {flash && <div className={`mt-2 rounded-lg px-3 py-1.5 text-sm font-medium ${flash.tone === 'good' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`} role="status">{flash.text}</div>}
        <div className="mt-2 flex items-center gap-3">
          <div className="h-2 flex-1 rounded-full bg-slate-200"><div className="h-2 rounded-full bg-brand-500 transition-all" style={{ width: `${stats.total ? (stats.checked / stats.total) * 100 : 0}%` }} /></div>
          <span className="text-sm tabular-nums text-slate-600">{stats.checked}/{stats.total} checked</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {([['all', `All ${stats.total}`], ['todo', `Not checked ${stats.total - stats.checked}`], ['diff', `Differences ${stats.diff.length}`]] as [Filter, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={`rounded-full border px-3 py-1 text-sm ${filter === k ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700' : 'border-slate-200 bg-white text-slate-600'}`}>{l}</button>
          ))}
          <button className="btn-ghost btn-sm ml-auto" onClick={() => setCounts(Object.fromEntries(lines.map((l) => [l.item_code, counts[l.item_code] ?? l.expected])))}>
            <Icon name="check" className="h-4 w-4" />Rest arrived as sent
          </button>
        </div>
      </div>

      <ul className="space-y-2">
        {shown.map((l) => {
          const c = counts[l.item_code];
          const st = c == null ? 'todo' : c === l.expected ? 'ok' : c < l.expected ? 'short' : 'over';
          const ring = { todo: 'border-slate-200', ok: 'border-green-300 bg-green-50/50', short: 'border-amber-300 bg-amber-50/60', over: 'border-violet-300 bg-violet-50/60' }[st];
          return (
            <li key={l.item_code} id={`line-${l.item_code}`} className={`card border p-3 transition ${ring} ${hit === l.item_code ? 'ring-2 ring-brand-400' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium leading-snug">{l.name ?? 'Unknown item'}{l.extra && <Badge tone="purple">Not on the STV</Badge>}</div>
                  <div className="font-mono text-xs text-slate-500">{l.item_code}{l.barcode ? ` · ${l.barcode}` : ''}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xs text-slate-500">Sent</div>
                  <div className="text-lg font-semibold tabular-nums">{fmtQty(l.expected)}</div>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" className="btn-secondary h-11 w-11 justify-center p-0" aria-label="Minus one" onClick={() => setQty(l.item_code, (c ?? l.expected) - 1)}><Icon name="minus" /></button>
                <input className="input h-11 w-24 text-center text-lg font-semibold tabular-nums" inputMode="numeric" aria-label={`Counted ${l.item_code}`}
                  value={c ?? ''} placeholder="–" onChange={(e) => setQty(l.item_code, e.target.value === '' ? null : Number(e.target.value.replace(/[^\d.]/g, '')))} />
                <button type="button" className="btn-secondary h-11 w-11 justify-center p-0" aria-label="Plus one" onClick={() => setQty(l.item_code, (c ?? 0) + 1)}><Icon name="plus" /></button>
                {l.expected > 0 && <button type="button" className={`h-11 flex-1 rounded-lg border text-sm font-medium ${st === 'ok' ? 'border-green-600 bg-green-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                  onClick={() => setQty(l.item_code, l.expected)}><Icon name="check" className="mr-1 inline h-4 w-4" />All {fmtQty(l.expected)}</button>}
              </div>
              {st === 'short' && <div className="mt-1.5 text-sm font-medium text-amber-800">{fmtQty(l.expected - (c ?? 0))} short</div>}
              {st === 'over' && <div className="mt-1.5 text-sm font-medium text-violet-800">{fmtQty((c ?? 0) - l.expected)} more than sent</div>}
            </li>
          );
        })}
        {shown.length === 0 && <li className="card"><Empty>Nothing in this list.</Empty></li>}
      </ul>

      <div className="mt-4">
        <label className="label" htmlFor="rc-note">Note for head office (optional)</label>
        <textarea id="rc-note" className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 2 boxes damaged, driver informed" />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur print:hidden lg:left-64">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-semibold tabular-nums">{fmtQty(stats.counted)} of {fmtQty(stats.expected)} pcs</div>
            <div className="text-slate-500">{stats.checked < stats.total ? `${stats.total - stats.checked} line(s) not checked - they count as 0` : stats.diff.length ? `${stats.diff.length} difference(s)` : 'All lines match'}</div>
          </div>
          {err && <span className="text-sm text-red-700">{err}</span>}
          <button className="btn-primary h-12 px-6" disabled={!canCount || busy || stats.checked === 0} onClick={async () => {
            setBusy(true); setErr('');
            try {
              await rpc('save_receive_count', { p: { dispatch_id: id, note, lines: lines.map((l) => ({ item_code: l.item_code, counted_qty: counts[l.item_code] ?? 0 })) } });
              try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
              setSaved(true);
              window.scrollTo(0, 0);
            } catch (e) { setErr(friendlyError(e)); }
            setBusy(false);
          }}>{busy ? 'Saving…' : 'Save count'}</button>
        </div>
      </div>
    </div>
  );
}
