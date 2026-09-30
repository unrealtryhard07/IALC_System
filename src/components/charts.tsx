// Lightweight SVG/HTML charts: donut, grouped columns, horizontal bars.
// Colors: validated categorical palette (fixed order, never cycled) + reserved status colors.
import { useRef, useState, type ReactNode } from 'react';

export const CAT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
export const STATUS_COLOR = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b', neutral: '#a3a3a0', info: '#2a78d6' };
export const BRAND = '#e40071';

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
export const compact = (n: number) => (Math.abs(n) >= 10000 ? `${nf.format(n / 1000)}k` : nf.format(n));

function useTip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  const show = (e: React.MouseEvent, body: ReactNode) => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setTip({ x: e.clientX - r.left, y: e.clientY - r.top, body });
  };
  const el = tip && (
    <div className="pointer-events-none absolute z-20 min-w-[120px] rounded-lg bg-slate-900/95 px-2.5 py-1.5 text-xs text-white shadow-lg"
      style={{ left: Math.min(tip.x + 14, (ref.current?.clientWidth ?? 400) - 170), top: tip.y + 14 }}>{tip.body}</div>
  );
  return { ref, show, hide: () => setTip(null), el };
}

export function Legend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}{i.value && <b className="font-semibold text-slate-800">{i.value}</b>}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
export interface Slice { label: string; value: number; color: string }
export function Donut({ data, center, sub, format = compact, empty = 'No data yet' }: { data: Slice[]; center?: string; sub?: string; format?: (n: number) => string; empty?: string }) {
  const t = useTip();
  const [active, setActive] = useState<string | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0);
  const R = 70, r = 48, C = 90;
  let a0 = -Math.PI / 2;
  const arcs = data.filter((d) => d.value > 0).map((d) => {
    const ang = (d.value / total) * Math.PI * 2;
    const gap = data.filter((x) => x.value > 0).length > 1 ? 0.025 : 0; // 2px surface gap between slices
    const s = a0 + gap / 2, e = a0 + ang - gap / 2;
    a0 += ang;
    const large = e - s > Math.PI ? 1 : 0;
    const p = (rad: number, ang2: number) => `${C + rad * Math.cos(ang2)} ${C + rad * Math.sin(ang2)}`;
    const path = ang >= Math.PI * 2 - 0.001
      ? `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - 0.01} ${C - R} L ${C - 0.01} ${C - r} A ${r} ${r} 0 1 0 ${C} ${C - r} Z`
      : `M ${p(R, s)} A ${R} ${R} 0 ${large} 1 ${p(R, e)} L ${p(r, e)} A ${r} ${r} 0 ${large} 0 ${p(r, s)} Z`;
    return { ...d, path };
  });
  if (!total) return <div className="flex h-44 items-center justify-center text-sm text-slate-400">{empty}</div>;
  return (
    <div ref={t.ref} className="relative flex flex-wrap items-center gap-5" onMouseLeave={() => { t.hide(); setActive(null); }}>
      <svg viewBox="0 0 180 180" className="h-44 w-44 shrink-0" role="img" aria-label={data.map((d) => `${d.label} ${d.value}`).join(', ')}>
        {arcs.map((a) => (
          <path key={a.label} d={a.path} fill={a.color} opacity={active && active !== a.label ? 0.35 : 1} className="cursor-pointer transition-opacity"
            onMouseMove={(e) => { setActive(a.label); t.show(e, <><b>{a.label}</b><br />{format(a.value)} · {((a.value / total) * 100).toFixed(1)}%</>); }} />
        ))}
        <text x={C} y={C - 2} textAnchor="middle" className="fill-slate-900 text-[22px] font-semibold">{center ?? format(total)}</text>
        {sub && <text x={C} y={C + 16} textAnchor="middle" className="fill-slate-500 text-[10px]">{sub}</text>}
      </svg>
      <ul className="min-w-[150px] flex-1 space-y-1.5 text-sm">
        {data.map((d) => (
          <li key={d.label} className={`flex items-center gap-2 rounded px-1 ${active === d.label ? 'bg-slate-50' : ''}`} onMouseEnter={() => setActive(d.label)}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.color }} />
            <span className="flex-1 text-slate-600">{d.label}</span>
            <span className="font-semibold tabular-nums text-slate-900">{format(d.value)}</span>
            <span className="w-11 text-right text-xs tabular-nums text-slate-400">{total ? `${Math.round((d.value / total) * 100)}%` : ''}</span>
          </li>
        ))}
      </ul>
      {t.el}
    </div>
  );
}

// ---------------------------------------------------------------------------
export interface Series { name: string; color: string; values: number[] }
export function Columns({ categories, series, format = compact, height = 220, empty = 'No data yet' }: { categories: string[]; series: Series[]; format?: (n: number) => string; height?: number; empty?: string }) {
  const t = useTip();
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  if (!max) return <div className="flex h-40 items-center justify-center text-sm text-slate-400">{empty}</div>;
  const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); const m = max / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; })();
  const W = 640, H = height, padL = 44, padB = 26, padT = 10;
  const plotW = W - padL - 8, plotH = H - padB - padT;
  const groupW = plotW / categories.length;
  const barW = Math.max(4, Math.min(28, (groupW * 0.72) / series.length - 2));
  const y = (v: number) => padT + plotH - (v / nice) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * nice);
  return (
    <div ref={t.ref} className="relative" onMouseLeave={t.hide}>
      <div className="mb-2"><Legend items={series.map((s) => ({ label: s.name, color: s.color }))} /></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={series.map((s) => `${s.name}: ${s.values.map((v, i) => `${categories[i]} ${v}`).join(', ')}`).join('; ')}>
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={padL} x2={W - 8} y1={y(tk)} y2={y(tk)} stroke="#e8e8e4" strokeWidth={1} />
            <text x={padL - 6} y={y(tk) + 3} textAnchor="end" className="fill-slate-400 text-[10px]">{compact(tk)}</text>
          </g>
        ))}
        {categories.map((c, ci) => {
          const gx = padL + ci * groupW + (groupW - (barW + 2) * series.length) / 2;
          return (
            <g key={c}>
              {series.map((s, si) => {
                const v = s.values[ci] ?? 0;
                const h = Math.max(v > 0 ? 2 : 0, (v / nice) * plotH);
                const x = gx + si * (barW + 2);
                return (
                  <g key={s.name} className="cursor-pointer"
                    onMouseMove={(e) => t.show(e, <><b>{c}</b><br />{series.map((ss) => <div key={ss.name} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: ss.color }} />{ss.name}: <b>{format(ss.values[ci] ?? 0)}</b></div>)}</>)}>
                    <rect x={gx - 2} y={padT} width={(barW + 2) * series.length + 2} height={plotH} fill="transparent" />
                    {h > 0 && <path d={`M ${x} ${padT + plotH} V ${padT + plotH - h + Math.min(4, h)} Q ${x} ${padT + plotH - h} ${x + Math.min(4, barW / 2)} ${padT + plotH - h} H ${x + barW - Math.min(4, barW / 2)} Q ${x + barW} ${padT + plotH - h} ${x + barW} ${padT + plotH - h + Math.min(4, h)} V ${padT + plotH} Z`} fill={s.color} />}
                  </g>
                );
              })}
              <text x={padL + ci * groupW + groupW / 2} y={H - 8} textAnchor="middle" className="fill-slate-500 text-[10.5px]">{c}</text>
            </g>
          );
        })}
      </svg>
      {t.el}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Line chart for trends over time. null values leave a gap (e.g. a store with no data that month).
export interface LSeries { name: string; color: string; values: (number | null)[] }
export function Lines({ categories, series, format = compact, height = 220, min, max, target, targetLabel, empty = 'No data yet' }: {
  categories: string[]; series: LSeries[]; format?: (n: number) => string; height?: number; min?: number; max?: number;
  target?: number; targetLabel?: string; empty?: string;
}) {
  const t = useTip();
  const [hover, setHover] = useState<number | null>(null);
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  if (!all.length || !categories.length) return <div className="flex h-40 items-center justify-center text-sm text-slate-400">{empty}</div>;
  const lo = min ?? Math.min(0, ...all);
  const hi = max ?? (() => { const m = Math.max(...all, target ?? 0); const p = 10 ** Math.floor(Math.log10(m || 1)); const k = m / p; return (k <= 1 ? 1 : k <= 2 ? 2 : k <= 5 ? 5 : 10) * p; })();
  const W = 640, H = height, padL = 44, padR = 28, padB = 26, padT = 14;
  const plotW = W - padL - padR, plotH = H - padB - padT;
  const x = (i: number) => padL + (categories.length === 1 ? plotW / 2 : (i / (categories.length - 1)) * plotW);
  const y = (v: number) => padT + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo));
  const path = (vals: (number | null)[]) => vals.reduce((d, v, i) => (v == null ? d : d + `${d && vals[i - 1] != null ? ' L' : ' M'} ${x(i)} ${y(v)}`), '');
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(categories.length - 1, Math.round(((px - padL) / plotW) * (categories.length - 1))));
    setHover(i);
    t.show(e, <><b>{categories[i]}</b>{series.map((s) => <div key={s.name} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.name}: <b>{s.values[i] == null ? '–' : format(s.values[i]!)}</b></div>)}</>);
  };
  return (
    <div ref={t.ref} className="relative" onMouseLeave={() => { t.hide(); setHover(null); }}>
      <div className="mb-2"><Legend items={series.map((s) => ({ label: s.name, color: s.color }))} /></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseMove={onMove} role="img"
        aria-label={series.map((s) => `${s.name}: ${s.values.map((v, i) => `${categories[i]} ${v == null ? 'none' : format(v)}`).join(', ')}`).join('; ')}>
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={padL} x2={W - padR} y1={y(tk)} y2={y(tk)} stroke="#e8e8e4" strokeWidth={1} />
            <text x={padL - 6} y={y(tk) + 3} textAnchor="end" className="fill-slate-400 text-[10px]">{format(tk)}</text>
          </g>
        ))}
        {target != null && <g><line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} stroke="#334155" strokeDasharray="4 4" strokeWidth={1} />
          {targetLabel && <text x={padL + 4} y={y(target) - 4} className="fill-slate-500 text-[10px]">{targetLabel}</text>}</g>}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} stroke="#cbd5e1" strokeWidth={1} />}
        {series.map((s) => (
          <g key={s.name}>
            <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {s.values.map((v, i) => v != null && <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 4.5 : 3} fill="white" stroke={s.color} strokeWidth={2} />)}
          </g>
        ))}
        {categories.map((c, i) => <text key={c} x={x(i)} y={H - 8} textAnchor="middle" className="fill-slate-500 text-[10.5px]">{c}</text>)}
      </svg>
      {t.el}
    </div>
  );
}

// ---------------------------------------------------------------------------
export interface HRow{ label: string; value: number; color?: string; note?: string }
export function HBars({ rows, format = compact, max, target, targetLabel, empty = 'No data yet' }: { rows: HRow[]; format?: (n: number) => string; max?: number; target?: number; targetLabel?: string; empty?: string }) {
  const t = useTip();
  const m = max ?? Math.max(0, ...rows.map((r) => r.value));
  if (!rows.length || !m) return <div className="flex h-32 items-center justify-center text-sm text-slate-400">{empty}</div>;
  return (
    <div ref={t.ref} className="relative space-y-2.5" onMouseLeave={t.hide}>
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[130px_1fr_72px] items-center gap-2 text-sm"
          onMouseMove={(e) => t.show(e, <><b>{r.label}</b><br />{format(r.value)}{r.note ? <><br /><span className="text-slate-300">{r.note}</span></> : null}</>)}>
          <span className="truncate text-slate-600" title={r.label}>{r.label}</span>
          <div className="relative h-5 rounded bg-slate-100">
            <div className="h-5 rounded-r" style={{ width: `${Math.min(100, (r.value / m) * 100)}%`, background: r.color ?? BRAND, borderRadius: 4 }} />
            {target != null && <div className="absolute top-[-3px] h-[26px] w-0.5 bg-slate-700" style={{ left: `${Math.min(100, (target / m) * 100)}%` }} title={targetLabel} />}
          </div>
          <span className="text-right font-semibold tabular-nums text-slate-800">{format(r.value)}</span>
        </div>
      ))}
      {target != null && targetLabel && <div className="flex items-center gap-1.5 pl-[138px] text-[11px] text-slate-400"><span className="inline-block h-3 w-0.5 bg-slate-700" />{targetLabel}</div>}
      {t.el}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function Kpi({ label, value, sub, trend, tone = 'neutral' }: { label: string; value: ReactNode; sub?: ReactNode; trend?: { good: boolean; text: string }; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'brand' }) {
  const bar = { neutral: 'bg-slate-200', good: 'bg-green-500', warn: 'bg-amber-400', bad: 'bg-red-500', brand: 'bg-brand-500' }[tone];
  return (
    <div className="card relative overflow-hidden p-4">
      <span className={`absolute inset-x-0 top-0 h-1 ${bar}`} aria-hidden />
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
      {trend && <div className={`mt-1 text-xs font-medium ${trend.good ? 'text-green-700' : 'text-red-700'}`}>{trend.text}</div>}
    </div>
  );
}
