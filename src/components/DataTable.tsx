import { useMemo, useState, type ReactNode } from 'react';
import { downloadExcel, type XlsColumn } from '../lib/excel';
import { Icon } from './Icon';
import { Empty } from './ui';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** plain value used for sorting, searching and Excel export */
  value?: (row: T) => string | number | null | undefined;
  render?: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  exportHeader?: string;
  exportFmt?: string;
  noExport?: boolean;
  className?: string;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  searchPlaceholder?: string;
  exportName?: string;
  pageSize?: number;
  empty?: ReactNode;
  toolbar?: ReactNode;
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (s: Set<string>) => void;
  isSelectable?: (row: T) => boolean;
  rowClassName?: (row: T) => string;
  initialSort?: { key: string; dir: 1 | -1 };
}

export function DataTable<T>(p: Props<T>) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(p.initialSort ?? null);
  const [page, setPage] = useState(0);
  const pageSize = p.pageSize ?? 50;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let rows = p.rows;
    if (term) {
      rows = rows.filter((r) => p.columns.some((c) => c.value && String(c.value(r) ?? '').toLowerCase().includes(term)));
    }
    if (sort) {
      const col = p.columns.find((c) => c.key === sort.key);
      if (col?.value) {
        const v = col.value;
        rows = [...rows].sort((a, b) => {
          const x = v(a), y = v(b);
          if (x === y) return 0;
          if (x === null || x === undefined || x === '') return 1;
          if (y === null || y === undefined || y === '') return -1;
          return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.dir;
        });
      }
    }
    return rows;
  }, [p.rows, p.columns, q, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const shown = filtered.slice(cur * pageSize, cur * pageSize + pageSize);
  const selectableRows = p.selectable ? filtered.filter((r) => (p.isSelectable ? p.isSelectable(r) : true)) : [];
  const allSelected = selectableRows.length > 0 && selectableRows.every((r) => p.selected?.has(p.rowKey(r)));

  const doExport = () => {
    const cols = p.columns.filter((c) => !c.noExport && c.value);
    const columns: XlsColumn[] = cols.map((c) => ({ header: c.exportHeader ?? String(typeof c.header === 'string' ? c.header : c.key), numFmt: c.exportFmt }));
    return downloadExcel(p.exportName ?? 'export', [{ name: 'Data', columns, rows: filtered.map((r) => cols.map((c) => c.value!(r) ?? null)) }]);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
        <input className="input w-60" placeholder={p.searchPlaceholder ?? 'Search…'} value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        {p.toolbar}
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          <span>{filtered.length.toLocaleString()} rows</span>
          {p.exportName && <button className="btn-secondary btn-sm" onClick={doExport} disabled={!filtered.length}><Icon name="download" className="h-3.5 w-3.5" />Excel</button>}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {p.selectable && (
                <th className="th w-8">
                  <input type="checkbox" aria-label="Select all" checked={allSelected}
                    onChange={(e) => {
                      const s = new Set(p.selected);
                      selectableRows.forEach((r) => (e.target.checked ? s.add(p.rowKey(r)) : s.delete(p.rowKey(r))));
                      p.onSelectedChange?.(s);
                    }} />
                </th>
              )}
              {p.columns.map((c) => (
                <th key={c.key} className={`th ${c.align === 'right' ? 'text-right' : ''} ${c.value ? 'cursor-pointer select-none hover:text-slate-800' : ''}`}
                  onClick={() => c.value && setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))}>
                  {c.header}
                  {sort?.key === c.key && <span aria-hidden> {sort.dir === 1 ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const k = p.rowKey(r);
              const canSel = p.selectable && (p.isSelectable ? p.isSelectable(r) : true);
              return (
                <tr key={k} className={`hover:bg-slate-50 ${p.rowClassName?.(r) ?? ''}`}>
                  {p.selectable && (
                    <td className="td">
                      {canSel && (
                        <input type="checkbox" aria-label="Select row" checked={p.selected?.has(k) ?? false}
                          onChange={(e) => {
                            const s = new Set(p.selected);
                            if (e.target.checked) s.add(k); else s.delete(k);
                            p.onSelectedChange?.(s);
                          }} />
                      )}
                    </td>
                  )}
                  {p.columns.map((c) => (
                    <td key={c.key} className={`td ${c.align === 'right' ? 'num' : ''} ${c.className ?? ''}`}>
                      {c.render ? c.render(r) : c.value ? String(c.value(r) ?? '–') : null}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <Empty>{p.empty ?? 'Nothing to show.'}</Empty>}
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 px-3 py-2 text-xs text-slate-600">
          <button className="btn-secondary btn-sm" disabled={cur === 0} onClick={() => setPage(cur - 1)}>‹ Prev</button>
          <span>Page {cur + 1} / {pages}</span>
          <button className="btn-secondary btn-sm" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next ›</button>
        </div>
      )}
    </div>
  );
}
