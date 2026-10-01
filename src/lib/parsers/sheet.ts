// Spreadsheet reading helpers shared by every Excel/CSV import.
import type ExcelJS from 'exceljs';

export type Cell = string | number | null;
export type Grid = Cell[][];

export interface SheetData {
  name: string;
  rows: Grid;
}

/** Turns an exceljs cell value (formula, rich text, hyperlink, date...) into a plain value. */
export function plainCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return plainCell(o.result); // formula
    if ('richText' in o && Array.isArray(o.richText)) {
      return plainCell((o.richText as { text: string }[]).map((t) => t.text).join(''));
    }
    if ('text' in o) return plainCell(o.text); // hyperlink
    if ('error' in o) return null;
  }
  return String(v);
}

export async function readXlsx(Excel: typeof ExcelJS, data: ArrayBuffer): Promise<SheetData[]> {
  const wb = new Excel.Workbook();
  await wb.xlsx.load(data);
  const out: SheetData[] = [];
  wb.eachSheet((ws) => {
    const rows: Grid = [];
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const vals: Cell[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        vals[col - 1] = plainCell(cell.value);
      });
      for (let i = 0; i < vals.length; i++) if (vals[i] === undefined) vals[i] = null;
      rows[rowNumber - 1] = vals;
    });
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    out.push({ name: ws.name, rows });
  });
  return out;
}

/** RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF, ; or tab delimiters). */
export function readCsv(text: string): SheetData[] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows: Grid = [];
  let row: Cell[] = [];
  let field = '';
  let quoted = false;
  const pushField = () => {
    const t = field.trim();
    row.push(t === '' ? null : t);
    field = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) pushField();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      pushField();
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) {
    pushField();
    rows.push(row);
  }
  return [{ name: 'CSV', rows }];
}

export async function readSpreadsheet(file: File | { name: string; arrayBuffer(): Promise<ArrayBuffer> }): Promise<SheetData[]> {
  const lower = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    return readCsv(new TextDecoder('utf-8').decode(buf).replace(/^﻿/, ''));
  }
  if (lower.endsWith('.xls')) {
    throw new Error('Old .xls format is not supported. Open it in Excel and "Save As" .xlsx or .csv, then upload again.');
  }
  const Excel = (await import('exceljs')).default;
  return readXlsx(Excel, buf);
}

// ---------------------------------------------------------------------------
// Header detection

export const norm = (v: Cell | undefined) =>
  String(v ?? '')
    .toLowerCase()
    .replace(/[_\-./]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export type ColumnSpec<K extends string> = Record<K, string[]>; // key -> header synonyms (normalised)

export interface HeaderMatch<K extends string> {
  headerRow: number; // index into rows
  cols: Partial<Record<K, number>>;
  headers: string[];
}

/** Finds the header row (first 25 rows) that matches the most wanted columns. First matching column wins. */
// Headers that are never an item's own name / code, even though they contain "name" or "code".
const NOT_ITEM = /\b(supplier|vendor|brand|category|sub ?category|department|dept|group|class|company|manufacturer|store|branch|location|customer)\b/;

export function detectHeader<K extends string>(rows: Grid, spec: ColumnSpec<K>, required: NoInfer<K>[]): HeaderMatch<K> | null {
  let best: HeaderMatch<K> | null = null;
  let bestScore = 0;
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const headers = (rows[r] ?? []).map((c) => norm(c));
    const cols: Partial<Record<K, number>> = {};
    let score = 0;
    for (const key of Object.keys(spec) as K[]) {
      const syns = spec[key];
      const taken = (i: number) => Object.values(cols).includes(i);
      const allowed = (h: string) => !(key === 'name' || key === 'code') || !NOT_ITEM.test(h);
      // exact synonym first, in the synonym's order of preference ("item name" beats "name"), then "contains"
      let idx = -1;
      for (const syn of syns) {
        idx = headers.findIndex((h, i) => h === syn && allowed(h) && !taken(i));
        if (idx >= 0) break;
      }
      if (idx < 0) idx = headers.findIndex((h, i) => h !== '' && allowed(h) && !taken(i) && syns.some((s) => s.length > 3 && h.includes(s)));
      if (idx >= 0) {
        cols[key] = idx;
        score += required.includes(key) ? 10 : 1;
      }
    }
    if (required.every((k) => cols[k] !== undefined) && score > bestScore) {
      best = { headerRow: r, cols, headers: (rows[r] ?? []).map((c) => String(c ?? '').trim()) };
      bestScore = score;
    }
  }
  return best;
}

/** Item codes arrive as numbers (1002710) or text ("1002710", "1002710.0"). */
export function cleanCode(v: Cell | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  return String(v).trim().replace(/\.0+$/, '');
}

export function toQty(v: Cell | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/,/g, '').trim();
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export const ITEM_CODE_SYNONYMS = ['item code', 'itemcode', 'variant', 'item no', 'item number', 'sku', 'code', 'variant code', 'item id', 'product code'];
export const BARCODE_SYNONYMS = ['barcode', 'bar code', 'ean', 'upc', 'gtin'];
export const NAME_SYNONYMS = ['item name', 'item description', 'product name', 'description', 'item desc', 'name', 'product', 'item'];
