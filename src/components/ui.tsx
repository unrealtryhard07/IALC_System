import { useEffect, type ReactNode } from 'react';
import type { Tone } from '../lib/labels';

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-300',
  info: 'bg-blue-50 text-blue-800 ring-blue-300',
  good: 'bg-green-50 text-green-800 ring-green-300',
  warn: 'bg-amber-50 text-amber-900 ring-amber-300',
  bad: 'bg-red-50 text-red-800 ring-red-300',
  purple: 'bg-violet-50 text-violet-800 ring-violet-300',
};
const DOT: Record<Tone, string> = {
  neutral: 'bg-slate-400', info: 'bg-blue-600', good: 'bg-green-600', warn: 'bg-amber-500', bad: 'bg-red-600', purple: 'bg-violet-600',
};

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} aria-hidden />
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '', pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone, onClick }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; onClick?: () => void }) {
  const accent = tone ? { bad: 'border-l-red-600', warn: 'border-l-amber-500', good: 'border-l-green-600', info: 'border-l-blue-600', purple: 'border-l-violet-600', neutral: 'border-l-slate-300' }[tone] : 'border-l-slate-200';
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={`card border-l-4 ${accent} p-4 text-left transition enabled:hover:shadow-md disabled:cursor-default`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </button>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-700" />
      {label}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="p-8 text-center text-sm text-slate-500">{children}</div>;
}

export function Alert({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'bad' | 'good'; title?: ReactNode; children?: ReactNode }) {
  const cls = { info: 'border-blue-200 bg-blue-50 text-blue-900', warn: 'border-amber-200 bg-amber-50 text-amber-900', bad: 'border-red-200 bg-red-50 text-red-900', good: 'border-green-200 bg-green-50 text-green-900' }[tone];
  const icon = { info: 'ℹ', warn: '⚠', bad: '✖', good: '✔' }[tone];
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${cls}`} role={tone === 'bad' ? 'alert' : undefined}>
      <div className="flex gap-2">
        <span aria-hidden className="font-bold">{icon}</span>
        <div className="min-w-0 flex-1">
          {title && <div className="font-semibold">{title}</div>}
          {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
        </div>
      </div>
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[8vh]" onMouseDown={onClose}>
      <div role="dialog" aria-modal className={`card w-full ${wide ? 'max-w-3xl' : 'max-w-lg'}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="font-semibold">{title}</h3>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[] }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
      {tabs.map((t) => (
        <button key={t.value} type="button" onClick={() => onChange(t.value)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${value === t.value ? 'border-blue-700 text-blue-800' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function FileDrop({ accept, multiple, onFiles, label, disabled }: { accept: string; multiple?: boolean; onFiles: (f: File[]) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!disabled) onFiles(Array.from(e.dataTransfer.files));
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-600 hover:border-blue-500 hover:bg-blue-50/40 ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
      <span className="text-2xl" aria-hidden>⇪</span>
      <span className="font-medium">{label}</span>
      <span className="text-xs text-slate-500">Drag & drop or click to choose ({accept.replaceAll(',', ', ')})</span>
      <input type="file" className="sr-only" accept={accept} multiple={multiple} disabled={disabled}
        onChange={(e) => {
          if (e.target.files) onFiles(Array.from(e.target.files));
          e.target.value = '';
        }} />
    </label>
  );
}

export function SiteSelect({ value, onChange, sites, allLabel = 'All stores', className = '' }: { value: number | ''; onChange: (v: number | '') => void; sites: { id: number; name: string }[]; allLabel?: string; className?: string }) {
  return (
    <select className={`input w-auto ${className}`} value={value} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}>
      <option value="">{allLabel}</option>
      {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}
