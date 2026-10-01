import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseAllocationGrid, type SiteRef } from '../src/lib/parsers/allocationSheet';
import { parseMasterlistGrid } from '../src/lib/parsers/masterlist';
import { readCsv, readXlsx } from '../src/lib/parsers/sheet';
import { parseSnapshotGrid } from '../src/lib/parsers/snapshot';
import { parseStvGrid } from '../src/lib/parsers/stvSheet';
import { HAS_FIXTURES, fixture } from './helpers';

const SITES: SiteRef[] = [
  { id: 1, name: 'Jahra', aliases: ['jahra', 'jahraa', 'jahra ds', 'jahraa d s', 'jahraa ds'] },
  { id: 2, name: 'Egaila', aliases: ['egaila', 'egaila ds', 'egaila d s'] },
  { id: 3, name: 'Hawally', aliases: ['hawally', 'hawally ds', 'hawally d s', 'hawalli'] },
  { id: 4, name: 'Salmiya', aliases: ['salmiya', 'salmiya ds', 'salmiya d s'] },
  { id: 5, name: 'Jahra DC', aliases: ['jahra dc', 'jahraa dc', 'dc'] },
];
const load = async (f: string) => {
  const b = fs.readFileSync(fixture(f));
  return readXlsx(ExcelJS, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
};

describe.skipIf(!HAS_FIXTURES)('allocation sheets', () => {
  it('parses the internal "From Jahra DS" format and ignores SUBTOTAL columns', async () => {
    const [s] = await load('From_Jahra_DS.xlsx');
    const p = parseAllocationGrid(s.rows, SITES, 'From_Jahra_DS.xlsx');
    expect(p.errors).toEqual([]);
    expect(p.sourceSiteId).toBe(1);
    expect(p.destinations.map((d) => d.siteId)).toEqual([2, 3, 4]);
    expect(p.lines).toHaveLength(62);
    const count = (id: number) => p.lines.filter((l) => l.qty[id]).length;
    const sum = (id: number) => p.lines.reduce((a, l) => a + (l.qty[id] ?? 0), 0);
    expect([count(2), count(3), count(4)]).toEqual([16, 32, 16]);
    expect(sum(3)).toBe(1013);
    expect(sum(2)).toBe(299);
    expect(p.lines.find((l) => l.itemCode === '1000987')?.qty).toEqual({ 2: 160, 3: 324 });
  });

  it('parses the DC format with Jahra as a destination and checks DC QTY', async () => {
    const [s] = await load('Jahra_DC_25-09-2026_1.xlsx');
    const p = parseAllocationGrid(s.rows, SITES, 'Jahra_DC_25-09-2026_1.xlsx');
    expect(p.errors).toEqual([]);
    expect(p.sourceSiteId).toBe(5);
    expect(p.planDate).toBe('2026-09-25');
    expect(p.destinations.map((d) => d.siteId).sort()).toEqual([1, 2, 3, 4]);
    expect(p.lines).toHaveLength(64);
    expect(p.lines.reduce((a, l) => a + (l.qty[3] ?? 0), 0)).toBe(1144);
    expect(p.warnings).toEqual([]);
  });
});

describe('other imports', () => {
  it('masterlist detects columns and cost', () => {
    const [s] = readCsv('Item Code,Barcode,Item Name,Category,Cost Price,Status\n1002710,6271002112518,Kdd Choco Milk,Dairy,0.125,Active\n1001242,80001218,"Loacker, Wafer",Snacks,,Inactive\n');
    const p = parseMasterlistGrid(s.rows);
    expect(p.errors).toEqual([]);
    expect(p.items).toEqual([
      expect.objectContaining({ item_code: '1002710', cost: 0.125, category: 'Dairy', active: true }),
      expect.objectContaining({ item_code: '1001242', name: 'Loacker, Wafer', cost: null, active: false }),
    ]);
  });
  it('snapshot needs code + qty', () => {
    const [s] = readCsv('Item No;Description;Qty On Hand;Last Receipt Date\n1002710;Milk;12;03/04/2025\n1001242;Wafer;0;\n');
    const p = parseSnapshotGrid(s.rows);
    expect(p.rows).toEqual([expect.objectContaining({ itemCode: '1002710', qty: 12, sinceDate: '2025-04-03' })]);
  });
  it('STV sheet fallback', () => {
    const [s] = readCsv('ITEM CODE,ITEM NAME,QTY\n1002710,Milk,259\n1021309,Karak,7\n');
    const p = parseStvGrid(s.rows);
    expect(p.lines.map((l) => [l.itemCode, l.qty])).toEqual([['1002710', 259], ['1021309', 7]]);
  });
});

describe('item name column', () => {
  it('never takes the supplier column as the item name', () => {
    const rows = [
      ['Item Code', 'Barcode', 'Supplier Name', 'Description', 'STORE_NAME', 'Egaila', 'Hawally'],
      ['1208123', '8684493000406', 'GLOBAL EQUATION COMPANY', 'Jojo Jelly Sour Licorice Strawberry 80g', 'Jahra DC', 22, 4],
    ];
    const p = parseAllocationGrid(rows, SITES, 'From_Jahra_DC_09-22-2026.xlsx');
    expect(p.errors).toEqual([]);
    expect(p.lines[0].itemName).toBe('Jojo Jelly Sour Licorice Strawberry 80g');
  });
  it('prefers "Item Name" over a supplier column that comes first', () => {
    const rows = [
      ['Variant', 'Vendor Name', 'Item Name', 'Egaila'],
      ['1000005', 'GULF TRADING REFRIGERATING CO', 'Sheba succulent chicken breast 85g', 8],
    ];
    expect(parseAllocationGrid(rows, SITES, 'From_Jahra_DS.xlsx').lines[0].itemName).toBe('Sheba succulent chicken breast 85g');
  });
  it('leaves the name empty rather than using a supplier column', () => {
    const rows = [['Item Code', 'Supplier Name', 'Egaila'], ['1000005', 'GULF TRADING REFRIGERATING CO', 8]];
    expect(parseAllocationGrid(rows, SITES, 'From_Jahra_DS.xlsx').lines[0].itemName).toBe('');
  });
});
