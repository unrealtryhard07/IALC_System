import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtPct, fmtQty } from '../lib/format';
import { LEG_STATUS } from '../lib/labels';
import type { LegRow } from '../lib/types';
import { DataTable } from './DataTable';
import { Icon } from './Icon';
import { Badge } from './ui';

export type Perspective = 'in' | 'out' | 'all';

/** What should happen next for this allocation, written for the person looking at it. */
export function nextStep(l: LegRow, p: Perspective, siteName: (id: number) => string): { text: string; urgent: boolean } {
  const from = siteName(l.from_site_id);
  const to = siteName(l.to_site_id);
  switch (l.status) {
    case 'cancelled': return { text: 'Cancelled by head office', urgent: false };
    case 'awaiting_dispatch':
      return p === 'out' ? { text: 'Send it: pick the items, make the STV, upload it', urgent: true }
        : p === 'in' ? { text: `Waiting for ${from} to send it`, urgent: false }
        : { text: `${from} has not sent it yet`, urgent: (l.days_waiting_dispatch ?? 0) > 2 };
    case 'in_transit':
      return p === 'in' ? { text: 'On its way to you - receive it and upload your receiving STV', urgent: true }
        : { text: `Waiting for ${to} to receive it`, urgent: false };
    case 'partially_received':
      return p === 'in' ? { text: 'Receive the rest, or explain what did not arrive', urgent: true }
        : { text: `${to} received only part of it`, urgent: false };
    case 'discrepancy':
      return p === 'out' ? { text: 'Explain what was sent differently from the plan', urgent: true }
        : { text: `Received. ${from} must explain differences`, urgent: false };
    default: return { text: 'Done', urgent: false };
  }
}

type StepState = 'done' | 'partial' | 'now' | 'todo';
export function stepsOf(l: LegRow): { label: string; state: StepState; sub: string }[] {
  const sent = l.first_dispatch_date != null;
  const fullyReceived = sent && Number(l.open_qty) === 0;
  const partlyReceived = Number(l.received_qty) > 0 && !fullyReceived;
  return [
    { label: 'Planned', state: 'done', sub: fmtDate(l.plan_date) },
    { label: 'Sent', state: sent ? 'done' : l.status === 'cancelled' ? 'todo' : 'now', sub: sent ? fmtDate(l.first_dispatch_date) : 'not yet' },
    { label: 'Received', state: fullyReceived ? 'done' : partlyReceived ? 'partial' : sent ? 'now' : 'todo', sub: fullyReceived ? fmtDate(l.last_receipt_date) : partlyReceived ? `${fmtPct(l.received_qty, l.dispatched_qty)} so far` : 'not yet' },
    { label: 'Closed', state: l.status === 'completed' ? 'done' : l.status === 'discrepancy' ? 'now' : 'todo', sub: l.status === 'completed' ? fmtDate(l.completed_date) : l.status === 'discrepancy' ? 'needs explanation' : '' },
  ];
}

const DOT: Record<StepState, string> = {
  done: 'bg-green-600 text-white border-green-600',
  partial: 'bg-amber-400 text-white border-amber-400',
  now: 'bg-white text-brand-600 border-brand-500 ring-2 ring-brand-100',
  todo: 'bg-white text-slate-300 border-slate-300',
};

export function Progress({ leg, compact }: { leg: LegRow; compact?: boolean }) {
  const steps = stepsOf(leg);
  return (
    <ol className={`flex items-start ${compact ? 'gap-1' : 'gap-2'}`} aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-start">
          <div className={`flex flex-col items-center ${compact ? 'w-14' : 'w-24'}`}>
            <span title={`${s.label}: ${s.sub}`} className={`flex items-center justify-center rounded-full border-2 font-bold ${compact ? 'h-5 w-5 text-[10px]' : 'h-8 w-8 text-sm'} ${DOT[s.state]}`}>
              {s.state === 'done' ? <Icon name="check" className={compact ? 'h-3 w-3' : 'h-4 w-4'} /> : s.state === 'partial' ? '½' : i + 1}
            </span>
            <span className={`mt-0.5 text-center leading-tight ${compact ? 'text-[10px]' : 'text-xs font-medium'} ${s.state === 'todo' ? 'text-slate-400' : 'text-slate-700'}`}>{s.label}</span>
            {!compact && <span className="text-center text-[11px] text-slate-500">{s.sub}</span>}
          </div>
          {i < steps.length - 1 && <span className={`mt-2.5 h-0.5 ${compact ? 'w-2' : 'w-6'} ${steps[i + 1].state === 'todo' ? 'bg-slate-200' : 'bg-green-500'}`} />}
        </li>
      ))}
    </ol>
  );
}

/** One row per allocation leg (sending store -> receiving store). */
export function LegTable({ legs, perspective, exportName, empty }: { legs: LegRow[]; perspective: Perspective; exportName: string; empty?: string }) {
  const a = useAuth();
  const order = ['in_transit', 'partially_received', 'awaiting_dispatch', 'discrepancy', 'completed', 'cancelled'];
  return (
    <DataTable<LegRow>
      rows={legs}
      rowKey={(l) => l.leg_id}
      exportName={exportName}
      searchPlaceholder="Search plan or store…"
      empty={empty}
      initialSort={{ key: 'status', dir: 1 }}
      columns={[
        { key: 'plan', header: 'Plan', className: 'whitespace-nowrap', value: (l) => l.ref, render: (l) => <Link className="link font-medium" to={`/allocations/${l.allocation_id}?leg=${l.leg_id}`}>{l.ref}</Link> },
        { key: 'route', header: perspective === 'in' ? 'From' : perspective === 'out' ? 'To' : 'From → To',
          value: (l) => (perspective === 'in' ? a.siteName(l.from_site_id) : perspective === 'out' ? a.siteName(l.to_site_id) : `${a.siteName(l.from_site_id)} → ${a.siteName(l.to_site_id)}`),
          render: (l) => <span className="font-medium">{perspective === 'in' ? a.siteName(l.from_site_id) : perspective === 'out' ? a.siteName(l.to_site_id) : `${a.siteName(l.from_site_id)} → ${a.siteName(l.to_site_id)}`}{l.kind === 'dc' && <span className="ml-1 text-xs text-violet-700">DC</span>}</span> },
        { key: 'date', header: 'Planned on', className: 'whitespace-nowrap', value: (l) => l.plan_date, render: (l) => fmtDate(l.plan_date) },
        { key: 'progress', header: 'Progress', noExport: true, render: (l) => <Progress leg={l} compact /> },
        { key: 'status', header: 'Status', value: (l) => order.indexOf(l.status), exportHeader: 'Status', render: (l) => <Badge tone={LEG_STATUS[l.status].tone}>{LEG_STATUS[l.status].label}</Badge> },
        { key: 'next', header: 'Next step', className: 'min-w-[220px]', value: (l) => nextStep(l, perspective, a.siteName).text,
          render: (l) => { const n = nextStep(l, perspective, a.siteName); return <span className={`text-sm ${n.urgent ? 'font-semibold text-red-700' : 'text-slate-600'}`}>{n.text}</span>; } },
        { key: 'items', header: 'Items', align: 'right', value: (l) => l.planned_skus },
        { key: 'planned', header: 'Planned', align: 'right', value: (l) => Number(l.planned_qty), render: (l) => fmtQty(l.planned_qty) },
        { key: 'sent', header: 'Sent', align: 'right', value: (l) => Number(l.dispatched_qty), render: (l) => fmtQty(l.dispatched_qty) },
        { key: 'recv', header: 'Received', align: 'right', value: (l) => Number(l.received_qty), render: (l) => fmtQty(l.received_qty) },
        { key: 'wait', header: 'Waiting', align: 'right', value: (l) => Number(l.open_qty), render: (l) => (Number(l.open_qty) ? <b className="text-amber-700">{fmtQty(l.open_qty)}</b> : '–') },
      ]}
    />
  );
}
