import type { StvParseResult } from './parsers/stvLayout';
import type { PdfJsLike } from './parsers/stvPdf';

let loaded: Promise<PdfJsLike> | null = null;
async function pdfjs(): Promise<PdfJsLike> {
  loaded ??= (async () => {
    const lib = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib as unknown as PdfJsLike;
  })();
  return loaded;
}

export async function parseStvFile(file: File): Promise<StvParseResult> {
  const { parseStvPdf } = await import('./parsers/stvPdf');
  return parseStvPdf(await pdfjs(), new Uint8Array(await file.arrayBuffer()));
}
