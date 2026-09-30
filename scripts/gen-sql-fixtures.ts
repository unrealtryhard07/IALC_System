// Generates supabase/tests/10_fixtures.sql from the real sample files using the app's own parsers.
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { parseAllocationGrid, type SiteRef } from '../src/lib/parsers/allocationSheet';
import { readXlsx } from '../src/lib/parsers/sheet';
import { parseFixtureStv, fixture } from '../tests/helpers';

const SITES: SiteRef[] = [
  { id: 1, name: 'Jahra', aliases: ['jahra', 'jahraa', 'jahra ds'] },
  { id: 2, name: 'Egaila', aliases: ['egaila'] },
  { id: 3, name: 'Salmiya', aliases: ['salmiya'] },
  { id: 4, name: 'Hawally', aliases: ['hawally'] },
  { id: 5, name: 'Jahra DC', aliases: ['jahra dc'] },
];
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const out: string[] = ['create table public.test_fx (name text primary key, data jsonb);', 'grant select on public.test_fx to authenticated;'];

async function plan(file: string, name: string) {
  const b = fs.readFileSync(fixture(file));
  const [s] = await readXlsx(ExcelJS, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  const p = parseAllocationGrid(s.rows, SITES, file);
  const payload = {
    from_site_id: p.sourceSiteId, plan_date: p.planDate ?? '2026-09-15', title: file,
    legs: p.destinations.map((d) => ({
      to_site_id: d.siteId,
      lines: p.lines.filter((l) => l.qty[d.siteId]).map((l) => ({ item_code: l.itemCode, item_name: l.itemName, barcode: l.barcode, qty: l.qty[d.siteId] })),
    })),
  };
  out.push(`insert into public.test_fx values (${q(name)}, ${q(JSON.stringify(payload))});`);
}
async function stv(file: string, name: string) {
  const r = await parseFixtureStv(file);
  const payload = {
    doc_no: r.header.docNo, stv_date: r.header.date, from_code: r.header.fromCode, from_name: r.header.fromName,
    to_code: r.header.toCode, to_name: r.header.toName, post_ref: r.header.postRef, source: 'pdf', warnings: r.warnings,
    lines: r.lines.map((l) => ({ line_no: l.lineNo, item_code: l.itemCode, barcode: l.barcode, item_name: l.itemName, pack_qty: l.packQty, unit: l.unit, qty: l.qty })),
  };
  out.push(`insert into public.test_fx values (${q(name)}, ${q(JSON.stringify(payload))});`);
}
await plan('From_Jahra_DS.xlsx', 'plan_jahra');
await plan('Jahra_DC_25-09-2026_1.xlsx', 'plan_dc');
await stv('stv_39126_jahra_to_hawally.pdf', 'stv_39126');
await stv('stv_39109_jahra_to_egaila.pdf', 'stv_39109');
await stv('stv_40493_dc_to_hawally.pdf', 'stv_40493');
fs.writeFileSync('supabase/tests/10_fixtures.sql', out.join('\n') + '\n');
console.log('wrote', out.length, 'statements');
