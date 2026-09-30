// Printable pick list for the sending store: exactly what the plan says, with boxes to tick and sign.
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Alert, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtDateTime, fmtQty, sum } from '../lib/format';
import { fetchAll, friendlyError, supabase } from '../lib/supabase';

interface Alloc { id: string; ref: string; title: string | null; notes: string | null; plan_date: string; from_site_id: number; status: string }
interface Leg { id: string; to_site_id: number }
interface PLine { leg_id: string; item_code: string; item_name: string | null; barcode: string | null; planned_qty: number }
interface ItemInfo { item_code: string; name: string | null; barcode: string | null; category: string | null; uom: string | null }

export default function PickList() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const a = useAuth();
  const [d, setD] = useState<{ alloc: Alloc; legs: Leg[]; lines: PLine[]; items: Map<string, ItemInfo> } | null>(null);
  const [err, setErr] = useState('');
  const [which, setWhich] = useState(params.get('leg') ?? 'all');
  const [sortBy, setSortBy] = useState<'category' | 'code' | 'name'>('category');

  useEffect(() => {
    (async () => {
      try {
        const al = await supabase.from('allocations').select('*').eq('id', id).maybeSingle();
        if (al.error) throw al.error;
        if (!al.data) throw new Error('Allocation not found or you do not have access to it.');
        const legs = ((await supabase.from('allocation_legs').select('id, to_site_id').eq('allocation_id', id)).data ?? []) as Leg[];
        const lines = await fetchAll<PLine>((f, t) => supabase.from('allocation_lines').select('*').in('leg_id', legs.map((l) => l.id)).range(f, t));
        const codes = [...new Set(lines.map((l) => l.item_code))];
        const items = new Map<string, ItemInfo>();
        for (let i = 0; i < codes.length; i += 300) {
          const { data } = await supabase.from('items').select('item_code, name, barcode, category, uom').in('item_code', codes.slice(i, i + 300));
          (data ?? []).forEach((x: ItemInfo) => items.set(x.item_code, x));
        }
        setD({ alloc: al.data as Alloc, legs: legs.sort((x, y) => x.to_site_id - y.to_site_id), lines, items });
      } catch (e) { setErr(friendlyError(e)); }
    })();
  }, [id]);

  if (err) return <Alert tone="bad">{err}</Alert>;
  if (!d) return <Spinner />;
  const legs = d.legs.filter((l) => which === 'all' || l.id === which);
  const info = (l: PLine) => d.items.get(l.item_code);
  const sorted = (ls: PLine[]) => [...ls].sort((x, y) => {
    if (sortBy === 'code') return x.item_code.localeCompare(y.item_code);
    const nx = info(x)?.name ?? x.item_name ?? '', ny = info(y)?.name ?? y.item_name ?? '';
    if (sortBy === 'category') return (info(x)?.category ?? '~').localeCompare(info(y)?.category ?? '~') || nx.localeCompare(ny);
    return nx.localeCompare(ny);
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Link to={`/allocations/${id}`} className="btn-ghost"><Icon name="arrowLeft" className="h-4 w-4" />Back</Link>
        <select className="input w-auto" value={which} onChange={(e) => setWhich(e.target.value)} aria-label="Destination">
          {d.legs.length > 1 && <option value="all">All destinations ({d.legs.length} pages)</option>}
          {d.legs.map((l) => <option key={l.id} value={l.id}>To {a.siteName(l.to_site_id)}</option>)}
        </select>
        <select className="input w-auto" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} aria-label="Sort">
          <option value="category">Sort by category (walk order)</option>
          <option value="name">Sort by name</option>
          <option value="code">Sort by item code</option>
        </select>
        <button className="btn-primary ml-auto" onClick={() => window.print()}><Icon name="print" className="h-4 w-4" />Print</button>
      </div>
      {d.alloc.status !== 'active' && <div className="mb-3 print:hidden"><Alert tone="warn">This plan is cancelled - do not pick it.</Alert></div>}

      {legs.map((leg, i) => {
        const ls = sorted(d.lines.filter((l) => l.leg_id === leg.id));
        return (
          <section key={leg.id} className={`card mb-6 p-6 print:mb-0 print:rounded-none print:border-0 print:p-0 print:shadow-none ${i < legs.length - 1 ? 'print:break-after-page' : ''}`}>
            <header className="flex items-start justify-between gap-4 border-b-2 border-slate-900 pb-3">
              <div>
                <img src="/circle-logo.png" alt="Circle" className="h-6 w-auto" />
                <h1 className="mt-2 text-xl font-bold">Pick list · {d.alloc.ref}</h1>
                <div className="text-sm text-slate-600">{d.alloc.title}</div>
              </div>
              <table className="text-sm">
                <tbody>
                  <tr><td className="pr-3 text-slate-500">From</td><td className="font-semibold">{a.siteName(d.alloc.from_site_id)}</td></tr>
                  <tr><td className="pr-3 text-slate-500">To</td><td className="text-lg font-bold">{a.siteName(leg.to_site_id)}</td></tr>
                  <tr><td className="pr-3 text-slate-500">Plan date</td><td>{fmtDate(d.alloc.plan_date)}</td></tr>
                  <tr><td className="pr-3 text-slate-500">Lines / pcs</td><td>{ls.length} / {fmtQty(sum(ls, (l) => l.planned_qty))}</td></tr>
                </tbody>
              </table>
            </header>
            {d.alloc.notes && <p className="mt-2 text-sm"><b>Note:</b> {d.alloc.notes}</p>}
            <table className="mt-3 w-full border-collapse text-[13px] print:text-[11px]">
              <thead>
                <tr className="border-b border-slate-400 text-left">
                  <th className="py-1.5 pr-2 w-8">#</th><th className="py-1.5 pr-2">Item code</th><th className="py-1.5 pr-2">Barcode</th><th className="py-1.5 pr-2">Item name</th>
                  <th className="py-1.5 pr-2 text-right">Qty</th><th className="py-1.5 pr-2 text-center w-20">Picked</th><th className="py-1.5 text-center w-16">Check</th>
                </tr>
              </thead>
              <tbody>
                {ls.map((l, n) => (
                  <tr key={l.item_code} className="border-b border-slate-200 break-inside-avoid">
                    <td className="py-1.5 pr-2 text-slate-500">{n + 1}</td>
                    <td className="py-1.5 pr-2 font-mono">{l.item_code}</td>
                    <td className="py-1.5 pr-2 font-mono">{info(l)?.barcode ?? l.barcode ?? ''}</td>
                    <td className="py-1.5 pr-2">{info(l)?.name ?? l.item_name}{sortBy === 'category' && info(l)?.category && <span className="ml-1 text-slate-400">· {info(l)!.category}</span>}</td>
                    <td className="py-1.5 pr-2 text-right text-base font-bold tabular-nums print:text-[12px]">{fmtQty(l.planned_qty)}</td>
                    <td className="py-1.5 pr-2"><div className="mx-auto h-5 w-14 border border-slate-400" /></td>
                    <td className="py-1.5"><div className="mx-auto h-4 w-4 border border-slate-400" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <footer className="mt-6 grid grid-cols-3 gap-6 text-sm break-inside-avoid">
              {['Picked by', 'Checked by', 'STV number'].map((t) => (
                <div key={t}><div className="h-10 border-b border-slate-500" /><div className="mt-1 text-slate-500">{t}</div></div>
              ))}
            </footer>
            <p className="mt-4 text-[11px] text-slate-400">Send exactly these quantities. If something is short, send what you have and explain the difference in the app after uploading the STV. Printed {fmtDateTime(new Date().toISOString())}.</p>
          </section>
        );
      })}
    </div>
  );
}
