// One item: where it is on its way, stuck, planned, and every recent STV it was on.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Alert, Badge, Card, PageHeader, Spinner, Stat } from '../components/ui';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtKwd, fmtQty, sum } from '../lib/format';
import { DIRECTION, DISC_KIND, DISPATCH_STATUS, VS_STATUS } from '../lib/labels';
import { friendlyError, supabase } from '../lib/supabase';
import type { DiscrepancyRow, DispatchItemRow, LegItemRow, LegRow, VsRow } from '../lib/types';

interface Item { item_code: string; barcode: string | null; name: string | null; category: string | null; brand: string | null; uom: string | null; cost: number | null; active: boolean }
interface StvItem { stv_id: string; doc_no: string; stv_date: string; direction: string; from_site_id: number; to_site_id: number; qty: number }

export default function ItemDetail() {
  const { code = '' } = useParams();
  const a = useAuth();
  const [d, setD] = useState<{ item: Item | null; open: DispatchItemRow[]; vs: VsRow[]; plans: (LegItemRow & { leg?: LegRow })[]; stvs: StvItem[]; disc: DiscrepancyRow[] } | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setD(null);
    (async () => {
      try {
        const [item, open, vs, li, stvs, disc] = await Promise.all([
          supabase.from('items').select('*').eq('item_code', code).maybeSingle(),
          supabase.from('v_dispatch_items').select('*').eq('item_code', code).gt('raw_open_qty', 0).order('stv_date').limit(100),
          supabase.from('v_vs_latest').select('*').eq('item_code', code),
          supabase.from('v_leg_items').select('*').eq('item_code', code).in('dispatch_status', ['awaiting_dispatch', 'short', 'not_sent']).limit(50),
          supabase.from('v_stv_items').select('stv_id, doc_no, stv_date, direction, from_site_id, to_site_id, qty').eq('item_code', code).order('stv_date', { ascending: false }).limit(40),
          supabase.from('v_discrepancies').select('*').eq('item_code', code).or('resolution_status.is.null,resolution_status.neq.approved').limit(50),
        ]);
        for (const r of [item, open, vs, li, stvs, disc]) if (r.error) throw r.error;
        const legIds = [...new Set(((li.data ?? []) as LegItemRow[]).map((x) => x.leg_id))];
        const legs = legIds.length ? ((await supabase.from('v_legs').select('*').in('leg_id', legIds).eq('allocation_status', 'active')).data as LegRow[] ?? []) : [];
        setD({
          item: item.data as Item | null, open: (open.data ?? []) as DispatchItemRow[], vs: (vs.data ?? []) as VsRow[],
          plans: ((li.data ?? []) as LegItemRow[]).map((x) => ({ ...x, leg: legs.find((l) => l.leg_id === x.leg_id) })).filter((x) => x.leg),
          stvs: (stvs.data ?? []) as StvItem[], disc: (disc.data ?? []) as DiscrepancyRow[],
        });
      } catch (e) { setErr(friendlyError(e)); }
    })();
  }, [code]);

  if (err) return <Alert tone="bad">{err}</Alert>;
  if (!d) return <Spinner />;
  const it = d.item;
  const onWay = sum(d.open, (r) => r.raw_open_qty);
  const stuck = sum(d.vs, (r) => r.erp_qty);
  return (
    <div className="space-y-5">
      <PageHeader title={it?.name ?? `Item ${code}`}
        subtitle={<span className="font-mono">{code}{it?.barcode ? ` · barcode ${it.barcode}` : ''}{it?.category ? ` · ${it.category}` : ''}{it?.brand ? ` · ${it.brand}` : ''}</span>}
        actions={it && !it.active ? <Badge tone="neutral">Inactive</Badge> : undefined} />
      {!it && <Alert tone="warn">This item code is not in the items list. Upload the masterlist under Items list.</Alert>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="On the way (not received)" value={`${fmtQty(onWay)} pcs`} sub={`${new Set(d.open.map((r) => r.stv_id)).size} STV(s)`} tone={onWay ? 'warn' : 'good'} />
        <Stat label="In virtual stores (ERP)" value={`${fmtQty(stuck)} pcs`} sub="latest ERP report" tone={stuck ? 'bad' : 'good'} />
        <Stat label="Open problems" value={d.disc.length} tone={d.disc.length ? 'warn' : 'good'} />
        <Stat label="Cost per piece" value={it?.cost != null ? fmtKwd(it.cost) : '–'} sub={it?.uom ?? undefined} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="On the way - sent, not received" pad={false}>
          {d.open.length === 0 ? <div className="p-4 text-sm text-slate-500">Nothing on the way.</div> : (
            <table className="w-full"><thead><tr><th className="th">STV</th><th className="th">Route</th><th className="th text-right">Open</th><th className="th text-right">Age</th></tr></thead><tbody>
              {d.open.map((r) => <tr key={r.stv_id}>
                <td className="td"><Link className="link" to={`/stvs/${r.stv_id}`}>{r.doc_no}</Link><div className="text-xs text-slate-500">{fmtDate(r.stv_date)}</div></td>
                <td className="td">{a.siteName(r.from_site_id)} → {a.siteName(r.to_site_id)}</td>
                <td className="td num">{fmtQty(r.raw_open_qty)}</td>
                <td className="td num"><Badge tone={r.age_days > a.receiptSla ? 'bad' : 'info'}>{r.age_days} d</Badge></td>
              </tr>)}
            </tbody></table>
          )}
        </Card>
        <Card title="In the Allocation (virtual) stores" pad={false}>
          {d.vs.length === 0 ? <div className="p-4 text-sm text-slate-500">Not in the latest ERP reports.</div> : (
            <table className="w-full"><thead><tr><th className="th">Store</th><th className="th text-right">In ERP</th><th className="th text-right">Unexplained</th><th className="th">Status</th></tr></thead><tbody>
              {d.vs.map((r) => <tr key={r.location_code}>
                <td className="td">{r.erp_name}<div className="text-xs text-slate-500">report {fmtDate(r.snapshot_date)}</div></td>
                <td className="td num">{fmtQty(r.erp_qty)}</td><td className="td num">{fmtQty(r.diff_qty)}</td>
                <td className="td"><Badge tone={VS_STATUS[r.match_status].tone}>{VS_STATUS[r.match_status].label}</Badge></td>
              </tr>)}
            </tbody></table>
          )}
        </Card>
        <Card title="In plans not fully sent" pad={false}>
          {d.plans.length === 0 ? <div className="p-4 text-sm text-slate-500">No open plan lines.</div> : (
            <table className="w-full"><thead><tr><th className="th">Plan</th><th className="th">Route</th><th className="th text-right">Planned</th><th className="th text-right">Sent</th><th className="th">Status</th></tr></thead><tbody>
              {d.plans.map((r) => <tr key={r.leg_id}>
                <td className="td"><Link className="link" to={`/allocations/${r.leg!.allocation_id}`}>{r.leg!.ref}</Link><div className="text-xs text-slate-500">{fmtDate(r.leg!.plan_date)}</div></td>
                <td className="td">{a.siteName(r.leg!.from_site_id)} → {a.siteName(r.leg!.to_site_id)}</td>
                <td className="td num">{fmtQty(r.planned_qty)}</td><td className="td num">{fmtQty(r.dispatched_qty)}</td>
                <td className="td"><Badge tone={DISPATCH_STATUS[r.dispatch_status].tone}>{DISPATCH_STATUS[r.dispatch_status].label}</Badge></td>
              </tr>)}
            </tbody></table>
          )}
        </Card>
        <Card title="Open problems" pad={false} actions={d.disc.length ? <Link to="/discrepancies" className="link text-sm">Problems page</Link> : undefined}>
          {d.disc.length === 0 ? <div className="p-4 text-sm text-slate-500">No open problems.</div> : (
            <table className="w-full"><thead><tr><th className="th">Problem</th><th className="th">Store</th><th className="th text-right">Gap</th><th className="th">Reason</th></tr></thead><tbody>
              {d.disc.map((r, i) => <tr key={i}>
                <td className="td">{DISC_KIND[r.kind].label}<div className="text-xs text-slate-500">{r.ref ?? r.doc_no} · {fmtDate(r.event_date)}</div></td>
                <td className="td">{a.siteName(r.responsible_site_id)}</td>
                <td className="td num">{fmtQty(r.gap_qty)}</td>
                <td className="td">{r.resolution_status ? <Badge tone={r.resolution_status === 'rejected' ? 'bad' : 'warn'}>{r.resolution_status === 'rejected' ? 'Rejected' : 'Waiting approval'}</Badge> : <span className="text-slate-400">None yet</span>}</td>
              </tr>)}
            </tbody></table>
          )}
        </Card>
      </div>

      <Card title="Recent STVs with this item" pad={false}>
        {d.stvs.length === 0 ? <div className="p-4 text-sm text-slate-500">No STVs yet.</div> : (
          <table className="w-full"><thead><tr><th className="th">STV</th><th className="th">Date</th><th className="th">Type</th><th className="th">Route</th><th className="th text-right">Qty</th></tr></thead><tbody>
            {d.stvs.map((r) => <tr key={r.stv_id}>
              <td className="td"><Link className="link" to={`/stvs/${r.stv_id}`}>{r.doc_no}</Link></td>
              <td className="td">{fmtDate(r.stv_date)}</td>
              <td className="td"><Badge tone={DIRECTION[r.direction]?.tone ?? 'neutral'}>{DIRECTION[r.direction]?.label ?? r.direction}</Badge></td>
              <td className="td">{a.siteName(r.from_site_id)} → {a.siteName(r.to_site_id)}</td>
              <td className="td num">{fmtQty(r.qty)}</td>
            </tr>)}
          </tbody></table>
        )}
      </Card>
      <Link to="/items" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><Icon name="arrowLeft" className="h-4 w-4" />Items list</Link>
    </div>
  );
}
