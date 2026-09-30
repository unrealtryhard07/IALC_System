// Head-office numbers shared by the Overview (KPIs, what needs attention) and the Dashboard (charts).
import { useEffect, useMemo, useState } from 'react';
import { BRAND, CAT, STATUS_COLOR, type Slice } from '../components/charts';
import { useAuth } from './auth';
import { addDays, daysBetween, fmtDate, fmtQty, kwToday, sum } from './format';
import { DISC_KIND, LEG_STATUS } from './labels';
import { fetchAll, friendlyError, supabase } from './supabase';
import type { DiscKind, DiscrepancyRow, DispatchItemRow, LegRow, LegStatus, VsRow } from './types';

interface StvLite { direction: string; stv_date: string; total_qty: number; from_site_id: number; to_site_id: number }
interface ResLite { kind: DiscKind; reason_code: string | null; status: string; requested_at: string }
export interface AccRow { month: string; site_id: number; role: 'sender' | 'receiver'; lines: number; exact_lines: number; expected_qty: number; matched_qty: number; extra_lines: number }
export interface VsHist { location_code: string; site_id: number; erp_name: string; snapshot_date: string; skus: number; qty: number; value: number }
export interface HoData { legs: LegRow[]; open: DispatchItemRow[]; disc: DiscrepancyRow[]; vs: VsRow[]; stvs: StvLite[]; res: ResLite[]; acc: AccRow[]; hist: VsHist[] }

const STATUS_ORDER: { s: LegStatus; color: string }[] = [
  { s: 'awaiting_dispatch', color: STATUS_COLOR.neutral },
  { s: 'in_transit', color: STATUS_COLOR.info },
  { s: 'partially_received', color: STATUS_COLOR.warning },
  { s: 'discrepancy', color: STATUS_COLOR.critical },
  { s: 'completed', color: STATUS_COLOR.good },
];
export const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);
export const fmtP = (v: number | null) => (v == null ? '–' : `${v.toFixed(1)}%`);
// "not received at all" is a receiving task, not a problem to explain
export const isProblem = (x: DiscrepancyRow) => x.kind !== 'receipt_short' || Number(x.actual_qty) > 0;

export function useHoData() {
  const [d, setD] = useState<HoData | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const since = addDays(kwToday(), -120);
    const monthsBack = addDays(kwToday(), -200).slice(0, 8) + '01';
    Promise.all([
      fetchAll<LegRow>((f, t) => supabase.from('v_legs').select('*').gte('plan_date', since).range(f, t)),
      fetchAll<DispatchItemRow>((f, t) => supabase.from('v_dispatch_items').select('*').gt('open_qty', 0).range(f, t)),
      fetchAll<DiscrepancyRow>((f, t) => supabase.from('v_discrepancies').select('*').or('resolution_status.is.null,resolution_status.neq.approved').range(f, t)),
      fetchAll<VsRow>((f, t) => supabase.from('v_vs_latest').select('*').range(f, t)),
      fetchAll<StvLite>((f, t) => supabase.from('stvs').select('direction, stv_date, total_qty, from_site_id, to_site_id').eq('status', 'active').gte('stv_date', addDays(kwToday(), -56)).range(f, t)),
      fetchAll<ResLite>((f, t) => supabase.from('resolutions').select('kind, reason_code, status, requested_at').gte('requested_at', addDays(kwToday(), -90)).range(f, t)),
      fetchAll<AccRow>((f, t) => supabase.from('v_accuracy_monthly').select('*').gte('month', monthsBack).range(f, t)),
      fetchAll<VsHist>((f, t) => supabase.from('v_vs_history').select('*').order('snapshot_date').range(f, t)),
    ]).then(([legs, open, disc, vs, stvs, res, acc, hist]) => setD({ legs, open, disc, vs, stvs, res, acc, hist })).catch((e) => setErr(friendlyError(e)));
  }, []);
  return { d, err };
}

export function useMetrics(d: HoData | null, period: number) {
  const a = useAuth();
  return useMemo(() => {
    if (!d) return null;
    const since = addDays(kwToday(), -period);
    const legs = d.legs.filter((l) => l.plan_date >= since && l.status !== 'cancelled');
    const sent = legs.filter((l) => l.first_dispatch_date);
    const done = legs.filter((l) => l.completed_date && l.first_dispatch_date);
    const late = d.open.filter((r) => r.age_days > a.receiptSla);
    const problems = d.disc.filter(isProblem);
    const storesDs = a.sites.filter((s) => s.active);
    const receivers = storesDs.filter((s) => legs.some((l) => l.to_site_id === s.id));
    const senders = storesDs.filter((s) => sent.some((l) => l.from_site_id === s.id));

    // weekly flow (last 8 weeks)
    const weeks = Array.from({ length: 8 }, (_, i) => addDays(kwToday(), -7 * (7 - i) - 6));
    const wk = (date: string) => weeks.findIndex((w, i) => date >= w && (i === 7 || date < weeks[i + 1]));
    const sentW = weeks.map(() => 0), recvW = weeks.map(() => 0);
    for (const s of d.stvs) {
      const i = wk(s.stv_date);
      if (i < 0) continue;
      if (s.direction === 'dispatch' || s.direction === 'direct') sentW[i] += Number(s.total_qty);
      if (s.direction === 'receipt' || s.direction === 'direct') recvW[i] += Number(s.total_qty);
    }

    // reasons given (last 90 days)
    const reasonCount = new Map<string, number>();
    d.res.forEach((r) => r.reason_code && reasonCount.set(r.reason_code, (reasonCount.get(r.reason_code) ?? 0) + 1));
    const reasonsSorted = [...reasonCount.entries()].sort((x, y) => y[1] - x[1]);
    const reasons: Slice[] = reasonsSorted.slice(0, 5).map(([code, n], i) => ({ label: a.reasons.find((r) => r.code === code)?.label ?? code, value: n, color: CAT[i] }));
    const rest = reasonsSorted.slice(5).reduce((s, [, n]) => s + n, 0);
    if (rest) reasons.push({ label: 'Other reasons', value: rest, color: STATUS_COLOR.neutral });

    // stuck stock (latest ERP report) by virtual store
    const vsByLoc = new Map<string, { qty: number; unknown: number; name: string }>();
    d.vs.forEach((r) => {
      const e = vsByLoc.get(r.location_code) ?? { qty: 0, unknown: 0, name: r.erp_name };
      e.qty += Number(r.erp_qty);
      if (r.match_status === 'not_in_system') e.unknown += Number(r.erp_qty);
      vsByLoc.set(r.location_code, e);
    });

    return {
      legs, sent, done, late, problems,
      plannedQty: sum(legs, (l) => l.planned_qty),
      plans: new Set(legs.map((l) => l.allocation_id)).size,
      fill: pct(sum(sent, (l) => Math.min(Number(l.dispatched_qty), Number(l.planned_qty))), sum(sent, (l) => l.planned_qty)),
      recv: pct(sum(sent, (l) => l.received_qty), sum(sent, (l) => l.dispatched_qty)),
      onTime: pct(sent.filter((l) => daysBetween(l.plan_date, l.first_dispatch_date!) <= a.dispatchSla).length, sent.length),
      avgDays: done.length ? sum(done, (l) => daysBetween(l.first_dispatch_date!, l.completed_date!)) / done.length : null,
      waitQty: sum(d.open, (r) => r.open_qty),
      waitValue: sum(d.open, (r) => r.open_qty * (r.cost ?? 0)),
      lateQty: sum(late, (r) => r.open_qty),
      lateStvs: new Set(late.map((r) => r.stv_id)).size,
      pending: d.disc.filter((x) => x.resolution_status === 'pending').length,
      unexplained: problems.filter((x) => x.resolution_status === null || x.resolution_status === 'rejected').length,
      notSent: d.legs.filter((l) => l.status === 'awaiting_dispatch').length,
      notSentLate: d.legs.filter((l) => l.status === 'awaiting_dispatch' && (l.days_waiting_dispatch ?? 0) > a.dispatchSla).length,
      statusSlices: STATUS_ORDER.map(({ s, color }) => ({ label: LEG_STATUS[s].label, value: legs.filter((l) => l.status === s).length, color })),
      byReceiver: {
        categories: receivers.map((s) => s.name),
        series: [
          { name: 'Planned', color: CAT[0], values: receivers.map((s) => sum(legs.filter((l) => l.to_site_id === s.id), (l) => l.planned_qty)) },
          { name: 'Sent', color: CAT[1], values: receivers.map((s) => sum(legs.filter((l) => l.to_site_id === s.id), (l) => l.dispatched_qty)) },
          { name: 'Received', color: CAT[2], values: receivers.map((s) => sum(legs.filter((l) => l.to_site_id === s.id), (l) => l.received_qty)) },
        ],
      },
      weekly: { categories: weeks.map((w) => fmtDate(w).slice(0, 5)), series: [{ name: 'Pieces sent', color: CAT[0], values: sentW }, { name: 'Pieces received', color: CAT[1], values: recvW }] },
      senderFill: senders.map((s) => {
        const ls = sent.filter((l) => l.from_site_id === s.id);
        return { label: s.name, value: pct(sum(ls, (l) => Math.min(Number(l.dispatched_qty), Number(l.planned_qty))), sum(ls, (l) => l.planned_qty)) ?? 0, note: `${ls.length} allocation(s) sent` };
      }).sort((x, y) => x.value - y.value),
      receiverDays: storesDs.map((s) => {
        const ls = done.filter((l) => l.to_site_id === s.id);
        return { label: s.name, value: ls.length ? sum(ls, (l) => daysBetween(l.first_dispatch_date!, l.completed_date!)) / ls.length : 0, note: `${ls.length} completed`, n: ls.length };
      }).filter((r) => r.n > 0).sort((x, y) => y.value - x.value),
      problemTypes: (Object.keys(DISC_KIND) as DiscKind[]).map((k) => ({ label: DISC_KIND[k].short, value: problems.filter((x) => x.kind === k && x.resolution_status !== 'approved').length }))
        .filter((r) => r.value > 0).sort((x, y) => y.value - x.value),
      reasons,
      stuck: [...vsByLoc.values()].map((e) => ({ label: e.name, value: e.qty, note: `${fmtQty(e.unknown)} pcs unknown (not explained by any transfer)`, color: e.unknown ? BRAND : CAT[0] })).sort((x, y) => y.value - x.value),
    };
  }, [d, period, a]);
}

/** Last n months as yyyy-mm-01, oldest first. */
export function lastMonths(n: number) {
  const t = kwToday();
  const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  return Array.from({ length: n }, (_, i) => {
    const k = y * 12 + (m - 1) - (n - 1 - i);
    return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}-01`;
  });
}
export const monthLabel = (iso: string, long = false) =>
  new Date(iso.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-GB', { month: long ? 'long' : 'short', year: long ? 'numeric' : '2-digit', timeZone: 'UTC' });
