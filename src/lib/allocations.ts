import type { LegRow, LegStatus } from './types';

export interface AllocationSummary {
  allocation_id: string; ref: string; kind: 'dc' | 'internal'; title: string | null; from_site_id: number; plan_date: string;
  allocation_status: 'active' | 'cancelled'; legs: LegRow[]; status: LegStatus;
  planned_skus: number; planned_qty: number; dispatched_skus: number; dispatched_qty: number; received_skus: number; received_qty: number;
  open_qty: number; open_issues: number; first_dispatch_date: string | null; completed_date: string | null;
}

const PRIORITY: LegStatus[] = ['discrepancy', 'partially_received', 'in_transit', 'awaiting_dispatch', 'completed', 'cancelled'];

export function groupLegs(legs: LegRow[]): AllocationSummary[] {
  const m = new Map<string, AllocationSummary>();
  for (const l of legs) {
    let s = m.get(l.allocation_id);
    if (!s) {
      s = { allocation_id: l.allocation_id, ref: l.ref, kind: l.kind, title: l.title, from_site_id: l.from_site_id, plan_date: l.plan_date,
        allocation_status: l.allocation_status, legs: [], status: 'completed', planned_skus: 0, planned_qty: 0, dispatched_skus: 0,
        dispatched_qty: 0, received_skus: 0, received_qty: 0, open_qty: 0, open_issues: 0, first_dispatch_date: null, completed_date: null };
      m.set(l.allocation_id, s);
    }
    s.legs.push(l);
    s.planned_skus += l.planned_skus; s.planned_qty += Number(l.planned_qty);
    s.dispatched_skus += l.dispatched_skus; s.dispatched_qty += Number(l.dispatched_qty);
    s.received_skus += l.received_skus; s.received_qty += Number(l.received_qty);
    s.open_qty += Number(l.open_qty); s.open_issues += l.open_issues;
    if (l.first_dispatch_date && (!s.first_dispatch_date || l.first_dispatch_date < s.first_dispatch_date)) s.first_dispatch_date = l.first_dispatch_date;
  }
  for (const s of m.values()) {
    s.legs.sort((x, y) => x.to_site_id - y.to_site_id);
    s.status = s.allocation_status === 'cancelled' ? 'cancelled' : PRIORITY.find((p) => s.legs.some((l) => l.status === p)) ?? 'completed';
    s.completed_date = s.legs.every((l) => l.completed_date) ? s.legs.map((l) => l.completed_date!).sort().at(-1)! : null;
  }
  return [...m.values()].sort((x, y) => y.plan_date.localeCompare(x.plan_date) || y.ref.localeCompare(x.ref));
}
