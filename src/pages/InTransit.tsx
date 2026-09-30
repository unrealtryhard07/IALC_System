import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable } from '../components/DataTable';
import { Alert, Badge, Card, PageHeader, SiteSelect, Spinner, Stat, Tabs } from '../components/ui';
import { useAuth } from '../lib/auth';
import { AGE_BUCKETS, ageBucket, fmtDate, fmtKwd, fmtQty, kwToday, sum } from '../lib/format';
import { fetchAll, friendlyError, supabase } from '../lib/supabase';
import type { DispatchItemRow } from '../lib/types';

interface StvGroup { stv_id: string; doc_no: string; stv_date: string; age: number; from: number; to: number; to_code: string; lines: number; open: number; sent: number; received: number; value: number }

export default function InTransit() {
  const a = useAuth();
  const [params] = useSearchParams();
  const [rows, setRows] = useState<DispatchItemRow[] | null>(null);
  const [err, setErr] = useState('');
  const [toSite, setToSite] = useState<number | ''>('');
  const [fromSite, setFromSite] = useState<number | ''>('');
  const [bucket, setBucket] = useState(params.get('overdue') ? 'overdue' : '');
  const [view, setView] = useState<'stv' | 'item'>('stv');

  useEffect(() => {
    fetchAll<DispatchItemRow>((f, t) => supabase.from('v_dispatch_items').select('*').gt('open_qty', 0).order('stv_date').range(f, t))
      .then(setRows).catch((e) => setErr(friendlyError(e)));
  }, []);

  const filtered = useMemo(() => (rows ?? []).filter((r) =>
    (!toSite || r.to_site_id === toSite) && (!fromSite || r.from_site_id === fromSite) &&
    (!bucket || (bucket === 'overdue' ? r.age_days > a.receiptSla : ageBucket(r.age_days).key === bucket))), [rows, toSite, fromSite, bucket, a.receiptSla]);

  const groups = useMemo(() => {
    const m = new Map<string, StvGroup>();
    for (const r of filtered) {
      const g = m.get(r.stv_id) ?? { stv_id: r.stv_id, doc_no: r.doc_no, stv_date: r.stv_date, age: r.age_days, from: r.from_site_id, to: r.to_site_id, to_code: r.to_code, lines: 0, open: 0, sent: 0, received: 0, value: 0 };
      g.lines++; g.open += Number(r.open_qty); g.sent += Number(r.dispatched_qty); g.received += Number(r.received_qty); g.value += Number(r.open_qty) * (r.cost ?? 0);
      m.set(r.stv_id, g);
    }
    return [...m.values()];
  }, [filtered]);

  if (err) return <Alert tone="bad">{err}</Alert>;
  if (!rows) return <Spinner />;
  const ageBadge = (d: number) => <Badge tone={d > a.receiptSla ? 'bad' : 'info'}>{d} d</Badge>;

  return (
    <div className="space-y-4">
      <PageHeader title="Waiting to be received" subtitle={`Stock that was sent but the receiving store has not received yet. It cannot be sold until they do. Red = more than ${a.receiptSla} day(s) old - chase that store.`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Pieces waiting" value={fmtQty(sum(filtered, (r) => r.open_qty))} tone="info" />
        <Stat label="Items / STVs" value={`${filtered.length} / ${groups.length}`} />
        <Stat label="Late pieces" value={fmtQty(sum(filtered.filter((r) => r.age_days > a.receiptSla), (r) => r.open_qty))} tone="bad" />
        <Stat label="Value (where cost known)" value={fmtKwd(sum(filtered, (r) => r.open_qty * (r.cost ?? 0)))} />
      </div>
      <Tabs value={view} onChange={setView} tabs={[{ value: 'stv', label: 'Per STV' }, { value: 'item', label: 'Per item' }]} />
      <Card pad={false}>
        {view === 'stv' ? (
          <DataTable<StvGroup>
            rows={groups} rowKey={(r) => r.stv_id} exportName={`in_transit_by_stv_${kwToday()}`} initialSort={{ key: 'age', dir: -1 }}
            toolbar={<Filters />}
            columns={[
              { key: 'doc', header: 'STV', value: (r) => r.doc_no, render: (r) => <Link className="link font-mono" to={`/stvs/${r.stv_id}`}>{r.doc_no}</Link> },
              { key: 'date', header: 'Sent on', value: (r) => r.stv_date, render: (r) => fmtDate(r.stv_date) },
              { key: 'age', header: 'Days waiting', align: 'right', value: (r) => r.age, render: (r) => ageBadge(r.age) },
              { key: 'from', header: 'From', value: (r) => a.siteName(r.from) },
              { key: 'to', header: 'Must be received by', value: (r) => a.siteName(r.to) },
              { key: 'where', header: 'Sitting in', value: (r) => a.locationLabel(r.to_code) },
              { key: 'lines', header: 'Items', align: 'right', value: (r) => r.lines },
              { key: 'sent', header: 'Sent', align: 'right', value: (r) => r.sent, render: (r) => fmtQty(r.sent) },
              { key: 'recv', header: 'Received', align: 'right', value: (r) => r.received, render: (r) => fmtQty(r.received) },
              { key: 'open', header: 'Waiting', align: 'right', value: (r) => r.open, render: (r) => <b>{fmtQty(r.open)}</b> },
              { key: 'val', header: 'Value KWD', align: 'right', value: (r) => Number(r.value.toFixed(3)), render: (r) => (r.value ? r.value.toFixed(3) : '–') },
            ]}
          />
        ) : (
          <DataTable<DispatchItemRow>
            rows={filtered} rowKey={(r) => `${r.stv_id}-${r.item_code}`} exportName={`in_transit_items_${kwToday()}`} initialSort={{ key: 'age', dir: -1 }}
            toolbar={<Filters />}
            columns={[
              { key: 'doc', header: 'STV', value: (r) => r.doc_no, render: (r) => <Link className="link font-mono" to={`/stvs/${r.stv_id}`}>{r.doc_no}</Link> },
              { key: 'age', header: 'Days waiting', align: 'right', value: (r) => r.age_days, render: (r) => ageBadge(r.age_days) },
              { key: 'from', header: 'From', value: (r) => a.siteName(r.from_site_id) },
              { key: 'to', header: 'To', value: (r) => a.siteName(r.to_site_id) },
              { key: 'code', header: 'Item', value: (r) => r.item_code, className: 'font-mono text-xs' },
              { key: 'name', header: 'Name', value: (r) => r.item_name, className: 'min-w-[220px]' },
              { key: 'sent', header: 'Sent', align: 'right', value: (r) => r.dispatched_qty, render: (r) => fmtQty(r.dispatched_qty) },
              { key: 'recv', header: 'Received', align: 'right', value: (r) => r.received_qty, render: (r) => fmtQty(r.received_qty) },
              { key: 'open', header: 'Waiting', align: 'right', value: (r) => r.open_qty, render: (r) => <b>{fmtQty(r.open_qty)}</b> },
              { key: 'val', header: 'Value KWD', align: 'right', value: (r) => (r.cost ? Number((r.open_qty * r.cost).toFixed(3)) : null) },
              { key: 'res', header: 'Reason', value: (r) => r.resolution_status ?? '', render: (r) => (r.resolution_status === 'pending' ? <Badge tone="warn">Explained, awaiting HO</Badge> : r.resolution_status === 'rejected' ? <Badge tone="bad">Rejected</Badge> : null) },
            ]}
          />
        )}
      </Card>
    </div>
  );

  function Filters() {
    return (
      <>
        <SiteSelect value={toSite} onChange={setToSite} sites={a.sites} allLabel="Any receiving store" />
        <SiteSelect value={fromSite} onChange={setFromSite} sites={a.sites} allLabel="Any sender" />
        <select className="input w-auto" value={bucket} onChange={(e) => setBucket(e.target.value)}>
          <option value="">Any age</option>
          <option value="overdue">Overdue (&gt; {a.receiptSla} d)</option>
          {AGE_BUCKETS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
        </select>
      </>
    );
  }
}
