import fs from 'node:fs';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseStvPdf, type PdfJsLike } from '../src/lib/parsers/stvPdf';

/** Real STVs / allocation sheets are company documents: kept out of git, tests skip without them. */
export const HAS_FIXTURES = fs.existsSync(path.join(__dirname, 'fixtures', 'stv_39126_jahra_to_hawally.pdf'));
export const fixture = (name: string) => path.join(__dirname, 'fixtures', name);
export const readFixture = (name: string) => new Uint8Array(fs.readFileSync(fixture(name)));
export const parseFixtureStv = (name: string) => parseStvPdf(pdfjs as unknown as PdfJsLike, readFixture(name));
