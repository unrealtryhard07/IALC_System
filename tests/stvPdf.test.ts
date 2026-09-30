import { describe, expect, it } from 'vitest';
import { HAS_FIXTURES, parseFixtureStv } from './helpers';

describe.skipIf(!HAS_FIXTURES)('STV PDF parser', () => {
  it('reads STV 39126 Jahra DS -> Hawally Allocation (2 pages, wrapped names)', async () => {
    const r = await parseFixtureStv('stv_39126_jahra_to_hawally.pdf');
    expect(r.errors).toEqual([]);
    expect(r.header).toMatchObject({
      docNo: '39126', date: '2026-09-16', fromName: 'Jahraa D.S', fromCode: '303',
      toName: 'Hawally Allocation', toCode: '502', postRef: '1',
    });
    expect(r.lines).toHaveLength(28);
    expect(r.lines.map((l) => l.lineNo)).toEqual(Array.from({ length: 28 }, (_, i) => i + 1));
    expect(r.lines.reduce((s, l) => s + l.qty, 0)).toBe(978);
    expect(r.lines[1]).toMatchObject({ itemCode: '1002710', barcode: '6271002112518', qty: 259 });
    expect(r.lines[3].itemName).toBe('Americana Chunks Tuna in Sunflower Oil 3 × 160g');
    // barcode with ERP suffix
    expect(r.lines[25]).toMatchObject({ itemCode: '1002206', barcode: '6251897600307-D', qty: 12 });
    // Arabic unit row
    expect(r.lines[23]).toMatchObject({ itemCode: '1001242', unit: 'Piece', packQty: 1, qty: 10 });
  });

  it('reads STV 39109 Jahra DS -> Egaila Allocation', async () => {
    const r = await parseFixtureStv('stv_39109_jahra_to_egaila.pdf');
    expect(r.errors).toEqual([]);
    expect(r.header).toMatchObject({ docNo: '39109', fromCode: '303', toName: 'Egaila Allocation', toCode: '505' });
    expect(r.lines).toHaveLength(16);
    expect(r.lines.reduce((s, l) => s + l.qty, 0)).toBe(290);
    expect(r.lines.find((l) => l.itemCode === '1002390')?.qty).toBe(2);
    expect(r.lines[0].itemName).toBe('Samyang Original Hot Chicken Flavor Ramen Fried 140g');
  });

  it('reads STV 40493 Jahra DC -> Hawally Allocation (3 pages, name continues across page break)', async () => {
    const r = await parseFixtureStv('stv_40493_dc_to_hawally.pdf');
    expect(r.errors).toEqual([]);
    expect(r.header).toMatchObject({ docNo: '40493', date: '2026-09-26', fromName: 'Jahra DC', fromCode: '603', toCode: '502' });
    expect(r.pageCount).toBe(3);
    expect(r.lines).toHaveLength(64);
    expect(r.lines.reduce((s, l) => s + l.qty, 0)).toBe(1144);
    const l31 = r.lines.find((l) => l.lineNo === 31)!;
    expect(l31.itemName).toBe('Fancy Feast Grilled Salmon In Gravy Canned Cat Food 85g');
    const l61 = r.lines.find((l) => l.lineNo === 61)!;
    expect(l61.itemName).toBe('Fancy Feast Puree Kiss Tuna Puree with Tuna Flakes, 10g x 4');
    expect(r.lines.find((l) => l.lineNo === 6)?.itemName).toBe('Fancy Feast Savory Salmon Cat Food 85g');
  });
});
