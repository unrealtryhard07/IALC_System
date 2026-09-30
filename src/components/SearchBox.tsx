// Header search: STV number, allocation ref / title, item code, barcode or item name.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtQty } from '../lib/format';
import { DIRECTION } from '../lib/labels';
import { rpc } from '../lib/supabase';
import { Icon } from './Icon';

interface Result {
  stvs: { id: string; doc_no: string; stv_date: string; direction: string; from_site_id: number; to_site_id: number; status: string; total_qty: number }[];
  allocations: { id: string; ref: string; title: string | null; plan_date: string; from_site_id: number; status: string }[];
  items: { item_code: string; name: string | null; barcode: string | null }[];
}
interface Hit { key: string; to: string; title: string; sub: string; group: string }

export function SearchBox() {
  const a = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(null); return; }
    let live = true;
    const t = setTimeout(() => {
      rpc<Result>('global_search', { p_q: term }).then((r) => {
        if (!live) return;
        setSel(0);
        setHits([
          ...r.stvs.map((s) => ({ key: `s${s.id}`, to: `/stvs/${s.id}`, group: 'STVs', title: `STV ${s.doc_no}${s.status === 'void' ? ' (void)' : ''}`,
            sub: `${DIRECTION[s.direction]?.label ?? s.direction} · ${a.siteName(s.from_site_id)} → ${a.siteName(s.to_site_id)} · ${fmtDate(s.stv_date)} · ${fmtQty(s.total_qty)} pcs` })),
          ...r.allocations.map((x) => ({ key: `a${x.id}`, to: `/allocations/${x.id}`, group: 'Allocations', title: `${x.ref}${x.title ? ` - ${x.title}` : ''}`,
            sub: `From ${a.siteName(x.from_site_id)} · ${fmtDate(x.plan_date)}${x.status === 'cancelled' ? ' · cancelled' : ''}` })),
          ...r.items.map((i) => ({ key: `i${i.item_code}`, to: `/items/${encodeURIComponent(i.item_code)}`, group: 'Items', title: i.name ?? i.item_code,
            sub: `${i.item_code}${i.barcode ? ` · ${i.barcode}` : ''}` })),
        ]);
      }).catch(() => live && setHits([]));
    }, 220);
    return () => { live = false; clearTimeout(t); };
  }, [q, a]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); };
  }, []);

  const go = (h: Hit) => { setOpen(false); setQ(''); input.current?.blur(); nav(h.to); };
  return (
    <div ref={box} className="relative w-full max-w-md">
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!hits?.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(hits.length - 1, s + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
          if (e.key === 'Enter') { e.preventDefault(); go(hits[sel]); }
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="Search STV no., plan, item code, barcode…" aria-label="Search"
        className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-9 text-sm outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-slate-200 bg-white px-1.5 text-[10px] text-slate-400 md:block">/</kbd>
      {open && hits && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1.5 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
          {hits.length === 0 && <div className="px-4 py-3 text-sm text-slate-500">Nothing found for “{q.trim()}”</div>}
          {hits.map((h, i) => (
            <div key={h.key}>
              {(i === 0 || hits[i - 1].group !== h.group) && <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{h.group}</div>}
              <button type="button" onMouseEnter={() => setSel(i)} onClick={() => go(h)}
                className={`block w-full px-4 py-2 text-left ${i === sel ? 'bg-brand-50' : ''}`}>
                <div className="truncate text-sm font-medium text-slate-800">{h.title}</div>
                <div className="truncate text-xs text-slate-500">{h.sub}</div>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
