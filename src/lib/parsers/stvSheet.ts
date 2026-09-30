// Fallback STV import from Excel/CSV: only Item Code + Qty are needed; header fields are typed in.
import { BARCODE_SYNONYMS, ITEM_CODE_SYNONYMS, NAME_SYNONYMS, cleanCode, detectHeader, toQty, type Grid } from './sheet';
import type { StvLine } from './stvLayout';

export function parseStvGrid(rows: Grid): { lines: StvLine[]; warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const hm = detectHeader(
    rows,
    { code: ITEM_CODE_SYNONYMS, qty: ['qty', 'quantity', 'item qty', 'transfer qty', 'qty sent', 'sent qty'], barcode: BARCODE_SYNONYMS, name: NAME_SYNONYMS },
    ['code', 'qty'],
  );
  if (!hm) return { lines: [], warnings, errors: ['Need an "Item Code" column and a "Qty" column.'] };
  const lines: StvLine[] = [];
  for (let r = hm.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const code = cleanCode(row[hm.cols.code!]);
    if (!code) continue;
    const q = toQty(row[hm.cols.qty!]);
    if (q === null || Number.isNaN(q) || q <= 0) {
      warnings.push(`Row ${r + 1} (item ${code}): quantity "${row[hm.cols.qty!] ?? ''}" skipped.`);
      continue;
    }
    lines.push({
      lineNo: lines.length + 1,
      itemCode: code,
      barcode: hm.cols.barcode !== undefined ? cleanCode(row[hm.cols.barcode]) : '',
      itemName: hm.cols.name !== undefined ? String(row[hm.cols.name] ?? '') : '',
      packQty: 1,
      unit: 'Piece',
      qty: q,
      expDate: null,
      page: 1,
    });
  }
  return { lines, warnings, errors: lines.length ? [] : ['No item lines with a quantity found.'] };
}
