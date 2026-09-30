// Styled Excel exports (head office works in Excel).
export interface XlsColumn {
  header: string;
  width?: number;
  numFmt?: string; // e.g. '#,##0' or '0.000' or '0.0%'
}
export interface XlsSheet {
  name: string;
  columns: XlsColumn[];
  rows: (string | number | null | undefined)[][];
  title?: string; // optional title row above the header
  headerGroups?: { label: string; from: number; to: number }[]; // merged group header row (1-based columns)
}

export async function downloadExcel(fileName: string, sheets: XlsSheet[]) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'IALC System';
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
    let r = 1;
    if (s.title) {
      ws.getCell(r, 1).value = s.title;
      ws.getCell(r, 1).font = { bold: true, size: 13 };
      r += 2;
    }
    if (s.headerGroups?.length) {
      for (const g of s.headerGroups) {
        if (g.to > g.from) ws.mergeCells(r, g.from, r, g.to);
        const c = ws.getCell(r, g.from);
        c.value = g.label;
        c.alignment = { horizontal: 'center' };
        c.font = { bold: true, color: { argb: 'FF1C5CAB' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3EEFB' } };
      }
      r += 1;
    }
    const headerRow = ws.getRow(r);
    s.columns.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C5CAB' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      ws.getColumn(i + 1).width = c.width ?? Math.min(Math.max(c.header.length + 2, 10), 45);
      if (c.numFmt) ws.getColumn(i + 1).numFmt = c.numFmt;
    });
    headerRow.height = 30;
    const headerIndex = r;
    for (const row of s.rows) {
      r += 1;
      ws.getRow(r).values = row.map((v) => (v === undefined ? null : v));
    }
    ws.views = [{ state: 'frozen', ySplit: headerIndex }];
    if (s.rows.length) ws.autoFilter = { from: { row: headerIndex, column: 1 }, to: { row: headerIndex, column: s.columns.length } };
  }
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
