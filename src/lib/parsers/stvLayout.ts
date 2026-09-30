// Layout parser for the Oracle Reports "Stock Transfer Voucher" (STV) PDF.
//
// pdf.js hands us one text item per printed cell with its position. The STV is a
// fixed-column report, so we:
//   1. read the header block (Doc. No., date, From Store, To Store, Stock Post Ref.)
//   2. calibrate column zones from the table header row (NO, ITEM CODE, Barcode, ...)
//   3. anchor every table row on its ITEM CODE cell (all cells of a row share its y)
//   4. attach wrapped item-name lines to the row above (also across page breaks)
// This function is pure so it can be unit-tested in Node against real STV PDFs.

export interface PdfTextItem {
  str: string;
  x: number; // left edge
  y: number; // distance from top of page (top-down)
  w: number; // width
  page: number; // 1-based
}

export interface StvHeader {
  docNo: string;
  date: string | null; // ISO yyyy-mm-dd
  fromName: string;
  fromCode: string;
  toName: string;
  toCode: string;
  postRef: string;
}

export interface StvLine {
  lineNo: number;
  itemCode: string;
  barcode: string;
  itemName: string;
  packQty: number;
  unit: string;
  qty: number;
  expDate: string | null;
  page: number;
}

export interface StvParseResult {
  header: StvHeader;
  lines: StvLine[];
  pageCount: number;
  warnings: string[];
  errors: string[];
}

interface Zones {
  no: number; // right boundary of NO column
  code: number; // right boundary of ITEM CODE
  barcode: number; // right boundary of Barcode
  name: number; // right boundary of ITEM NAME
  pack: number; // right boundary of UNIT QTY (pack size)
  unit: number; // right boundary of Unit
  qty: number; // right boundary of Qty
  tableTop: number; // y of the table header row
}

// Defaults measured on the standard A4-ish (576x756) Oracle layout.
const DEFAULT_ZONES: Omit<Zones, 'tableTop'> = {
  no: 50,
  code: 112,
  barcode: 187,
  name: 380,
  pack: 414,
  unit: 456,
  qty: 494,
};

const SAME_LINE = 3.5; // pts tolerance for "same row"
const ARABIC = /[؀-ۿﭐ-﷿ﹰ-﻿]/;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const center = (it: PdfTextItem) => it.x + it.w / 2;
const isNum = (s: string) => /^-?\d[\d,]*(\.\d+)?$/.test(s);
const toNum = (s: string) => Number(s.replace(/,/g, ''));

export function parseDate(s: string): string | null {
  const m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function findLabel(items: PdfTextItem[], re: RegExp) {
  return items.find((it) => re.test(clean(it.str)));
}

/** Values printed on the same line as a label, between the label and the Arabic caption. */
function valuesRightOf(items: PdfTextItem[], label: PdfTextItem): PdfTextItem[] {
  return items
    .filter(
      (it) =>
        it.page === label.page &&
        Math.abs(it.y - label.y) < 4 &&
        it.x > label.x + label.w - 1 &&
        it.x < 476 &&
        clean(it.str) !== '' &&
        clean(it.str) !== ':' &&
        !ARABIC.test(it.str),
    )
    .sort((a, b) => a.x - b.x);
}

function parseStoreLine(items: PdfTextItem[], re: RegExp): { name: string; code: string } {
  const label = findLabel(items, re);
  if (!label) return { name: '', code: '' };
  const vals = valuesRightOf(items, label);
  // Code is the right-most pure number; everything else is the store name.
  let code = '';
  const nameParts: string[] = [];
  for (let i = vals.length - 1; i >= 0; i--) {
    const s = clean(vals[i].str);
    if (!code && /^\d+$/.test(s) && vals[i].x > 380) code = s;
    else nameParts.unshift(s);
  }
  let name = clean(nameParts.join(' ').replace(/^:\s*/, ''));
  // Some renderers merge "Name 303" into one item.
  if (!code) {
    const m = name.match(/^(.*?)\s+(\d{2,})$/);
    if (m) {
      name = m[1];
      code = m[2];
    }
  }
  return { name, code };
}

function calibrateZones(items: PdfTextItem[]): Zones | null {
  const byText = (re: RegExp) => items.find((it) => re.test(clean(it.str)));
  const codeH = byText(/^ITEM CODE$/i);
  const qtyH = items.find((it) => clean(it.str) === 'Qty');
  if (!codeH || !qtyH) return null;
  const noH = byText(/^NO$/);
  const barH = byText(/^Barcode$/i);
  const packH = byText(/^UNIT QTY$/i);
  const unitH = items.find((it) => clean(it.str) === 'Unit');
  const expH = byText(/^Exp\.? ?Date$/i);
  const z: Zones = { ...DEFAULT_ZONES, tableTop: codeH.y };
  if (noH) z.no = (noH.x + noH.w + codeH.x) / 2;
  if (barH) z.code = (codeH.x + codeH.w + barH.x) / 2 + 2;
  if (barH) z.barcode = barH.x + barH.w + 18;
  if (packH) z.name = packH.x + 8;
  if (packH && unitH) z.pack = (packH.x + packH.w + unitH.x) / 2 + 2;
  if (unitH) z.unit = qtyH.x - 10;
  z.qty = expH ? (qtyH.x + qtyH.w + expH.x) / 2 : qtyH.x + qtyH.w + 12;
  return z;
}

export function parseStvLayout(allItems: PdfTextItem[], pageCount: number): StvParseResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const items = allItems.filter((it) => clean(it.str) !== '');

  // ---------- header ----------
  const page1 = items.filter((it) => it.page === 1);
  const docLabel = findLabel(page1, /^Doc\.?\s*No/i);
  let docNo = '';
  if (docLabel) {
    const v = valuesRightOf(page1, docLabel).find((it) => /^\d+$/.test(clean(it.str)));
    if (v) docNo = clean(v.str);
    else {
      const m = clean(docLabel.str).match(/(\d{3,})/);
      if (m) docNo = m[1];
    }
  }
  let date: string | null = null;
  for (const it of page1) {
    if (it.y < 150) {
      const d = parseDate(clean(it.str));
      if (d) {
        date = d;
        break;
      }
    }
  }
  const from = parseStoreLine(page1, /^From Store/i);
  const to = parseStoreLine(page1, /^To Store/i);
  const postLabel = findLabel(page1, /^Stock Post Ref/i);
  const postRef = postLabel
    ? clean(valuesRightOf(page1, postLabel).map((i) => i.str).join(' '))
    : '';

  const header: StvHeader = {
    docNo,
    date,
    fromName: from.name,
    fromCode: from.code,
    toName: to.name,
    toCode: to.code,
    postRef,
  };
  if (!docNo) errors.push('Could not read the STV document number (Doc. No.).');
  if (!date) warnings.push('Could not read the STV date - please enter it manually.');
  if (!from.name && !from.code) errors.push('Could not read "From Store".');
  if (!to.name && !to.code) errors.push('Could not read "To Store".');

  // ---------- table ----------
  interface Row {
    line: StvLine;
    y: number;
    nameParts: { y: number; x: number; s: string }[];
    unitParts: { x: number; s: string }[];
    expParts: string[];
    qtyFound: boolean;
  }
  const rows: Row[] = [];
  let lastRowPrevPages: Row | null = null;

  for (let p = 1; p <= pageCount; p++) {
    const pageItems = items.filter((it) => it.page === p);
    const zones = calibrateZones(pageItems);
    if (!zones) {
      // A trailing page may carry only signatures; that is fine if we already have rows.
      if (pageItems.some((it) => /^\d{4,}$/.test(clean(it.str)) && it.x < 112 && it.x > 50)) {
        errors.push(`Page ${p}: table header not found - cannot read this page.`);
      }
      continue;
    }
    // Footer ("management / recipient / Storekeeper" or the Arabic declaration) ends the table.
    const footer = pageItems
      .filter((it) => /^(management|recipient|Storekeeper)$/i.test(clean(it.str)))
      .reduce((m, it) => Math.min(m, it.y), Infinity);
    // Table body: below the header row (and its Arabic caption line), above the footer.
    // Arabic text only matters in the Unit column ("قطعة 1" = 1 piece).
    const inUnitCol = (it: PdfTextItem) => center(it) > zones.pack && center(it) <= zones.unit;
    const body = pageItems.filter(
      (it) =>
        it.y > zones.tableTop + 6 && it.y < footer - 1 && (!ARABIC.test(it.str) || inUnitCol(it)),
    );

    // Anchor rows on item codes.
    const pageRows: Row[] = [];
    for (const it of body) {
      const s = clean(it.str);
      const c = center(it);
      if (c > zones.no && c <= zones.code && /^\d{3,}$/.test(s)) {
        const noItem = body.find(
          (o) => Math.abs(o.y - it.y) < SAME_LINE && center(o) <= zones.no && /^\d+$/.test(clean(o.str)),
        );
        pageRows.push({
          line: {
            lineNo: noItem ? Number(clean(noItem.str)) : 0,
            itemCode: s,
            barcode: '',
            itemName: '',
            packQty: 1,
            unit: '',
            qty: 0,
            expDate: null,
            page: p,
          },
          y: it.y,
          nameParts: [],
          unitParts: [],
          expParts: [],
          qtyFound: false,
        });
      }
    }
    pageRows.sort((a, b) => a.y - b.y);

    for (const it of body) {
      const s = clean(it.str);
      const c = center(it);
      if (c > zones.no && c <= zones.code && /^\d{3,}$/.test(s)) continue; // anchor itself
      const row = pageRows.find((r) => Math.abs(r.y - it.y) < SAME_LINE);
      const x0 = it.x;
      if (row) {
        if (c <= zones.no) continue; // serial NO
        if (c <= zones.barcode && x0 < zones.barcode - 20 && c > zones.code) {
          row.line.barcode = row.line.barcode ? row.line.barcode + s : s;
        } else if (x0 < zones.name && c <= zones.name) {
          row.nameParts.push({ y: it.y, x: it.x, s });
        } else if (c <= zones.pack) {
          if (isNum(s)) row.line.packQty = toNum(s);
        } else if (c <= zones.unit) {
          row.unitParts.push({ x: it.x, s });
        } else if (c <= zones.qty) {
          if (isNum(s)) {
            row.line.qty = toNum(s);
            row.qtyFound = true;
          } else warnings.push(`Line ${row.line.lineNo}: unreadable quantity "${s}".`);
        } else {
          row.expParts.push(s);
        }
      } else if (x0 >= zones.barcode - 8 && c <= zones.name) {
        // Wrapped item-name line: belongs to the closest row above it,
        // or to the last row of the previous page when it tops a new page.
        const above = [...pageRows].reverse().find((r) => r.y < it.y);
        const target = above ?? lastRowPrevPages;
        if (target) target.nameParts.push({ y: above ? it.y : 1e6 + it.y, x: it.x, s });
      }
    }

    rows.push(...pageRows);
    if (pageRows.length) lastRowPrevPages = pageRows[pageRows.length - 1];
  }

  const lines: StvLine[] = rows.map((r) => {
    const name = r.nameParts
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((p) => p.s)
      .join(' ');
    const unitRaw = clean(r.unitParts.sort((a, b) => a.x - b.x).map((u) => u.s).join(' '));
    // Arabic unit is printed as e.g. "قطعة 1" / "1 قطعة" (= 1 piece).
    const unit = ARABIC.test(unitRaw) ? 'Piece' : unitRaw || 'Piece';
    const exp = r.expParts.length ? parseDate(r.expParts.join(' ')) ?? clean(r.expParts.join(' ')) : null;
    if (!r.qtyFound) errors.push(`Line ${r.line.lineNo} (item ${r.line.itemCode}): quantity not found.`);
    return { ...r.line, itemName: clean(name), unit, expDate: exp };
  });

  // ---------- integrity checks ----------
  if (lines.length === 0) errors.push('No item lines were found in this PDF. Is it an STV?');
  const nos = lines.map((l) => l.lineNo);
  const missing: number[] = [];
  const maxNo = Math.max(0, ...nos);
  for (let n = 1; n <= maxNo; n++) if (!nos.includes(n)) missing.push(n);
  if (missing.length) errors.push(`Line number(s) ${missing.join(', ')} could not be read - totals would be wrong.`);
  const dupNos = nos.filter((n, i) => nos.indexOf(n) !== i);
  if (dupNos.length) warnings.push(`Line number(s) ${[...new Set(dupNos)].join(', ')} appear twice.`);
  if (lines.some((l) => l.packQty !== 1)) {
    warnings.push('Some lines use a pack size other than 1 - quantities are taken as printed in the Qty column.');
  }
  const codes = lines.map((l) => l.itemCode);
  const dupCodes = [...new Set(codes.filter((c, i) => codes.indexOf(c) !== i))];
  if (dupCodes.length) warnings.push(`Item(s) ${dupCodes.join(', ')} appear on more than one line; quantities will be added together.`);

  return { header, lines, pageCount, warnings, errors };
}
