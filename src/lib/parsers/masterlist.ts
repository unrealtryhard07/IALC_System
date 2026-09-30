// Item masterlist import: auto-detects columns; only Item Code is mandatory.
import { BARCODE_SYNONYMS, ITEM_CODE_SYNONYMS, NAME_SYNONYMS, cleanCode, detectHeader, toQty, type Grid } from './sheet';

export interface MasterItem {
  item_code: string;
  barcode: string | null;
  name: string | null;
  category: string | null;
  brand: string | null;
  uom: string | null;
  cost: number | null;
  shelf_life_days: number | null;
  active: boolean;
}

export const MASTER_SPEC = {
  code: ITEM_CODE_SYNONYMS,
  barcode: BARCODE_SYNONYMS,
  name: NAME_SYNONYMS,
  category: ['category', 'department', 'dept', 'sub category', 'subcategory', 'class', 'group', 'item group'],
  brand: ['brand', 'brand name', 'manufacturer', 'supplier'],
  uom: ['uom', 'unit', 'unit of measure', 'base unit'],
  cost: ['cost', 'cost price', 'unit cost', 'avg cost', 'average cost', 'last cost', 'purchase price', 'cost kwd'],
  shelfLife: ['shelf life', 'shelf life days', 'shelf life (days)', 'shelflife'],
  status: ['status', 'active', 'item status'],
};

export interface ParsedMasterlist {
  items: MasterItem[];
  detected: Record<string, string>; // field -> header used
  warnings: string[];
  errors: string[];
}

export function parseMasterlistGrid(rows: Grid): ParsedMasterlist {
  const warnings: string[] = [];
  const errors: string[] = [];
  const hm = detectHeader(rows, MASTER_SPEC, ['code']);
  if (!hm) return { items: [], detected: {}, warnings, errors: ['No "Item Code" (or "Variant"/"SKU") column found.'] };
  const detected: Record<string, string> = {};
  for (const [k, idx] of Object.entries(hm.cols)) detected[k] = hm.headers[idx as number];
  const get = (row: Grid[number], k: keyof typeof MASTER_SPEC) => (hm.cols[k] !== undefined ? row[hm.cols[k]!] : null);
  const txt = (v: unknown) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());

  const map = new Map<string, MasterItem>();
  let dup = 0;
  for (let r = hm.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const code = cleanCode(get(row, 'code'));
    if (!code) continue;
    const cost = toQty(get(row, 'cost'));
    const shelf = toQty(get(row, 'shelfLife'));
    const status = txt(get(row, 'status'))?.toLowerCase();
    if (map.has(code)) dup++;
    map.set(code, {
      item_code: code,
      barcode: txt(cleanCode(get(row, 'barcode'))),
      name: txt(get(row, 'name')),
      category: txt(get(row, 'category')),
      brand: txt(get(row, 'brand')),
      uom: txt(get(row, 'uom')),
      cost: cost !== null && !Number.isNaN(cost) && cost >= 0 ? cost : null,
      shelf_life_days: shelf !== null && !Number.isNaN(shelf) ? Math.round(shelf) : null,
      active: !status || !['inactive', 'no', 'n', '0', 'false', 'blocked', 'discontinued', 'delisted'].includes(status),
    });
  }
  if (dup) warnings.push(`${dup} duplicate item code row(s) - the last row for each code was kept.`);
  if (hm.cols.cost === undefined) warnings.push('No cost column found - KWD values will not be shown for these items.');
  if (map.size === 0) errors.push('No items found under the header row.');
  return { items: [...map.values()], detected, warnings, errors };
}
