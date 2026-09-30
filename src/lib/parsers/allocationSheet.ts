// Parses HO allocation plans in the formats already used today:
//  * Internal: "From Store | Variant | Barcode | Item Name | Egaila | Hawally | Salmiya | (SUBTOTAL copies)"
//  * DC:       "Item Code | Barcode | Item Name | STORE_NAME | DC QTY | Egaila | Hawally | Salmiya | Jahra | Total | DIF"
// Destination columns are recognised by store name/alias; any other column is ignored.
import {
  BARCODE_SYNONYMS, ITEM_CODE_SYNONYMS, NAME_SYNONYMS, cleanCode, detectHeader, norm, toQty,
  type Grid,
} from './sheet';

export interface SiteRef {
  id: number;
  name: string;
  aliases: string[]; // normalised, exact-match header names
}

export interface PlanLine {
  itemCode: string;
  barcode: string;
  itemName: string;
  qty: Record<number, number>; // siteId -> planned qty
  sourceQty: number | null; // "DC QTY" when present
}

export interface ParsedPlan {
  sourceText: string | null; // value found in "From Store"/"STORE_NAME"
  sourceSiteId: number | null;
  destinations: { siteId: number; header: string; col: number }[];
  lines: PlanLine[];
  planDate: string | null; // from file name, e.g. Jahra_DC_25-09-2026
  warnings: string[];
  errors: string[];
}

const SPEC = {
  code: ITEM_CODE_SYNONYMS,
  barcode: BARCODE_SYNONYMS,
  name: NAME_SYNONYMS,
  source: ['from store', 'store name', 'from', 'source store', 'from ds', 'from dc'],
  sourceQty: ['dc qty', 'dc quantity', 'total qty', 'available qty'],
};

export function matchSite(sites: SiteRef[], text: string | null | undefined): SiteRef | null {
  const t = norm(text ?? '');
  if (!t) return null;
  return sites.find((s) => s.aliases.includes(t) || norm(s.name) === t) ?? null;
}

export function dateFromFileName(name: string): string | null {
  const m = name.match(/(\d{1,2})[-_.](\d{1,2})[-_.](\d{4})/);
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseAllocationGrid(rows: Grid, sites: SiteRef[], fileName = ''): ParsedPlan {
  const warnings: string[] = [];
  const errors: string[] = [];
  const empty: ParsedPlan = { sourceText: null, sourceSiteId: null, destinations: [], lines: [], planDate: dateFromFileName(fileName), warnings, errors };

  const hm = detectHeader(rows, SPEC, ['code']);
  if (!hm) {
    errors.push('Could not find a header row with an item code column ("Item Code" or "Variant").');
    return empty;
  }
  const hdr = rows[hm.headerRow] ?? [];

  // Destination columns: first column whose header is exactly a store name/alias.
  const destinations: ParsedPlan['destinations'] = [];
  hdr.forEach((h, col) => {
    const site = matchSite(sites, String(h ?? ''));
    if (site && !destinations.some((d) => d.siteId === site.id) && !Object.values(hm.cols).includes(col)) {
      destinations.push({ siteId: site.id, header: String(h), col });
    }
  });
  if (destinations.length === 0) {
    errors.push(`No store columns found. Expected columns named like: ${sites.map((s) => s.name).join(', ')}.`);
    return empty;
  }

  // Source store: most common value of the "From Store"/"STORE_NAME" column, else file name.
  let sourceText: string | null = null;
  if (hm.cols.source !== undefined) {
    const counts = new Map<string, number>();
    for (let r = hm.headerRow + 1; r < rows.length; r++) {
      const v = rows[r]?.[hm.cols.source];
      if (v !== null && v !== undefined) counts.set(String(v).trim(), (counts.get(String(v).trim()) ?? 0) + 1);
    }
    sourceText = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    if (counts.size > 1) warnings.push(`The source store column has several values (${[...counts.keys()].join(', ')}). Using "${sourceText}".`);
  }
  let source = matchSite(sites, sourceText);
  if (!source && fileName) {
    const base = norm(fileName.replace(/\.[^.]+$/, '').replace(/\d/g, ' '));
    // Longest alias contained in the file name wins ("jahra dc" beats "jahra").
    const hits = sites.flatMap((s) => s.aliases.filter((a) => base.includes(a)).map((a) => ({ s, a })));
    source = hits.sort((x, y) => y.a.length - x.a.length)[0]?.s ?? null;
    if (!sourceText && source) sourceText = source.name;
  }
  const destList = destinations.filter((d) => d.siteId !== source?.id);
  if (source && destList.length < destinations.length) {
    warnings.push(`Ignored the "${source.name}" column because it is the sending store.`);
  }

  const byCode = new Map<string, PlanLine>();
  for (let r = hm.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const code = cleanCode(row[hm.cols.code!]);
    if (!code) continue;
    if (!/^[0-9A-Za-z-]+$/.test(code)) {
      warnings.push(`Row ${r + 1}: skipped - item code "${code}" is not valid.`);
      continue;
    }
    const qty: Record<number, number> = {};
    let any = false;
    for (const d of destList) {
      const q = toQty(row[d.col]);
      if (q === null || q === 0) continue;
      if (Number.isNaN(q) || q < 0) {
        warnings.push(`Row ${r + 1}, ${d.header}: quantity "${row[d.col]}" ignored.`);
        continue;
      }
      qty[d.siteId] = q;
      any = true;
    }
    if (!any) continue;
    const sourceQty = hm.cols.sourceQty !== undefined ? toQty(row[hm.cols.sourceQty]) : null;
    const existing = byCode.get(code);
    if (existing) {
      warnings.push(`Item ${code} appears more than once - quantities were added together.`);
      for (const [k, v] of Object.entries(qty)) existing.qty[Number(k)] = (existing.qty[Number(k)] ?? 0) + v;
      continue;
    }
    byCode.set(code, {
      itemCode: code,
      barcode: cleanCode(hm.cols.barcode !== undefined ? row[hm.cols.barcode] : null),
      itemName: String((hm.cols.name !== undefined ? row[hm.cols.name] : '') ?? '').trim(),
      qty,
      sourceQty: sourceQty !== null && !Number.isNaN(sourceQty) ? sourceQty : null,
    });
  }
  const lines = [...byCode.values()];
  for (const l of lines) {
    if (l.sourceQty !== null) {
      const total = Object.values(l.qty).reduce((a, b) => a + b, 0);
      if (Math.abs(total - l.sourceQty) > 1e-9) {
        warnings.push(`Item ${l.itemCode}: store split ${total} differs from DC QTY ${l.sourceQty}.`);
      }
    }
  }
  if (lines.length === 0) errors.push('No item rows with a quantity were found.');

  return {
    sourceText,
    sourceSiteId: source?.id ?? null,
    destinations: destList,
    lines,
    planDate: dateFromFileName(fileName),
    warnings,
    errors,
  };
}
