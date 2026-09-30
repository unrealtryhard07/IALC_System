// ERP stock-on-hand report for the Allocation (virtual) stores.
import { ITEM_CODE_SYNONYMS, NAME_SYNONYMS, cleanCode, detectHeader, toQty, type Grid } from './sheet';
import { parseDate } from './stvLayout';

export const SNAPSHOT_SPEC = {
  code: ITEM_CODE_SYNONYMS,
  qty: ['qty', 'quantity', 'stock', 'on hand', 'onhand', 'soh', 'balance', 'stock qty', 'qty on hand', 'closing qty', 'closing stock', 'available', 'available qty'],
  name: NAME_SYNONYMS,
  location: ['store', 'store code', 'location', 'warehouse', 'store name', 'loc', 'store no'],
  value: ['value', 'stock value', 'total cost', 'amount', 'cost value'],
  date: ['date', 'last movement', 'last movement date', 'last receipt date', 'receipt date', 'last in date', 'trans date', 'transaction date'],
};

export interface SnapshotRow {
  itemCode: string;
  qty: number;
  name: string | null;
  location: string | null;
  value: number | null;
  sinceDate: string | null;
}

export function parseSnapshotGrid(rows: Grid): { rows: SnapshotRow[]; detected: Record<string, string>; warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const hm = detectHeader(rows, SNAPSHOT_SPEC, ['code', 'qty']);
  if (!hm) return { rows: [], detected: {}, warnings, errors: ['Need at least an item code column and a quantity/stock column.'] };
  const detected: Record<string, string> = {};
  for (const [k, idx] of Object.entries(hm.cols)) detected[k] = hm.headers[idx as number];
  const out: SnapshotRow[] = [];
  for (let r = hm.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const code = cleanCode(row[hm.cols.code!]);
    if (!code || !/^[0-9A-Za-z-]+$/.test(code)) continue;
    const q = toQty(row[hm.cols.qty!]);
    if (q === null || Number.isNaN(q)) continue;
    if (q === 0) continue;
    const v = hm.cols.value !== undefined ? toQty(row[hm.cols.value]) : null;
    const d = hm.cols.date !== undefined ? row[hm.cols.date] : null;
    out.push({
      itemCode: code,
      qty: q,
      name: hm.cols.name !== undefined && row[hm.cols.name] !== null ? String(row[hm.cols.name]) : null,
      location: hm.cols.location !== undefined && row[hm.cols.location] !== null ? String(row[hm.cols.location]).trim() : null,
      value: v !== null && !Number.isNaN(v) ? v : null,
      sinceDate: d === null ? null : parseDate(String(d)) ?? (/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? String(d) : null),
    });
  }
  const neg = out.filter((r) => r.qty < 0).length;
  if (neg) warnings.push(`${neg} item(s) have negative stock in the report - kept as-is.`);
  return { rows: out, detected, warnings, errors: out.length ? [] : ['No rows with stock were found.'] };
}
