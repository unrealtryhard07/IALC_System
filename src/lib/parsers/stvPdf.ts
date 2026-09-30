import { parseStvLayout, type PdfTextItem, type StvParseResult } from './stvLayout';

// Minimal slice of the pdf.js API we use, so browser and Node builds can both be passed in.
export interface PdfJsLike {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean }): { promise: Promise<PdfDoc> };
}
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<{
    getViewport(o: { scale: number }): { height: number };
    getTextContent(): Promise<{ items: unknown[] }>;
  }>;
  destroy(): Promise<void>;
}

export async function extractPdfItems(pdfjs: PdfJsLike, data: Uint8Array) {
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const items: PdfTextItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const { height } = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    for (const raw of tc.items) {
      const it = raw as { str?: string; transform?: number[]; width?: number };
      if (typeof it.str !== 'string' || !it.transform) continue;
      items.push({ str: it.str, x: it.transform[4], y: height - it.transform[5], w: it.width ?? 0, page: p });
    }
  }
  const pageCount = doc.numPages;
  await doc.destroy();
  return { items, pageCount };
}

export async function parseStvPdf(pdfjs: PdfJsLike, data: Uint8Array): Promise<StvParseResult> {
  const { items, pageCount } = await extractPdfItems(pdfjs, data);
  return parseStvLayout(items, pageCount);
}
