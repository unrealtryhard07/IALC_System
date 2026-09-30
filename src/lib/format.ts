const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
const kwd = new Intl.NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export const fmtQty = (n: number | null | undefined) => (n === null || n === undefined ? '–' : nf.format(Number(n)));
export const fmtKwd = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `KWD ${kwd.format(Number(n))}`);
export const fmtPct = (num: number, den: number) => (den > 0 ? `${((num / den) * 100).toFixed(1)}%` : '–');

/** yyyy-mm-dd -> dd-mm-yyyy (the format used on the STVs) */
export const fmtDate = (d: string | null | undefined) => {
  if (!d) return '–';
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
};
export const fmtDateTime = (d: string | null | undefined) => {
  if (!d) return '–';
  const dt = new Date(d);
  return `${fmtDate(dt.toLocaleDateString('en-CA', { timeZone: 'Asia/Kuwait' }))} ${dt.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuwait', hour: '2-digit', minute: '2-digit' })}`;
};

/** Today in Kuwait as yyyy-mm-dd */
export const kwToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuwait' });
export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86400000);

export const sum = <T,>(rows: T[], f: (r: T) => number | null | undefined) => rows.reduce((s, r) => s + Number(f(r) ?? 0), 0);

export const AGE_BUCKETS = [
  { key: 'b0', label: '0–1 days', min: 0, max: 1, color: 'var(--age-1)' },
  { key: 'b1', label: '2–3 days', min: 2, max: 3, color: 'var(--age-2)' },
  { key: 'b2', label: '4–7 days', min: 4, max: 7, color: 'var(--age-3)' },
  { key: 'b3', label: '8–30 days', min: 8, max: 30, color: 'var(--age-4)' },
  { key: 'b4', label: '30+ days', min: 31, max: Infinity, color: 'var(--age-5)' },
] as const;
export const ageBucket = (days: number) => AGE_BUCKETS.find((b) => days >= b.min && days <= b.max) ?? AGE_BUCKETS[4];
