import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable } from '../components/DataTable';
import { Alert, Badge, Card, PageHeader, SiteSelect, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth';
import { addDays, fmtDate, fmtDateTime, fmtQty, kwToday } from '../lib/format';
import { DIRECTION } from '../lib/labels';
import { fetchAll, friendlyError, supabase } from '../lib/supabase';
import type { StvRow } from '../lib/types';

export default function Stvs() {
  const a = useAuth();
  const [rows, setRows] = useState<StvRow[] | null>(null);
  const [err, setErr] = useState('');
  const [from, setFrom] = useState(addDays(kwToday(), -30));
  const [dir, setDir] = useState('');
  const [site, setSite] = useState<number | ''>('');
  const [showVoid, setShowVoid] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    setRows(null);
    fetchAll<StvRow>((f, t) => {
      let q = supabase.from('stvs').select('*').gte('stv_date', from).order('stv_date', { ascending: false });
      if (dir) q = q.eq('direction', dir);
      if (site) q = q.or(`from_site_id.eq.${site},to_site_id.eq.${site}`);
      if (!showVoid) q = q.eq('status', 'active');
      return q.range(f, t);
    }).then(setRows).catch((e) => setErr(friendlyError(e)));
  }, [from, dir, site, showVoid]);
  useEffect(() => {
    if (a.isHO) supabase.from('profiles').select('user_id, full_name').then(({ data }) => setNames(Object.fromEntries((data ?? []).map((p: { user_id: string; full_name: string }) => [p.user_id, p.full_name]))));
  }, [a.isHO]);

  return (
    <div>
      <PageHeader title="STV register" subtitle="Every Stock Transfer Voucher uploaded, with the original file." actions={(a.isAdmin || a.profile?.role === 'store') && <Link to="/upload" className="btn-primary">⇪ Upload STV</Link>} />
      {err && <Alert tone="bad">{err}</Alert>}
      <Card pad={false}>
        {!rows ? <Spinner /> : (
          <DataTable<StvRow>
            rows={rows}
            rowKey={(r) => r.id}
            exportName={`stv_register_${kwToday()}`}
            searchPlaceholder="Search STV no…"
            rowClassName={(r) => (r.status === 'void' ? 'opacity-50 line-through' : '')}
            toolbar={<>
              <label className="text-xs text-slate-500">STVs since <input type="date" className="input ml-1 w-auto" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <select className="input w-auto" value={dir} onChange={(e) => setDir(e.target.value)}>
                <option value="">All types</option>
                {Object.entries(DIRECTION).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <SiteSelect value={site} onChange={setSite} sites={a.sites} />
              <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={showVoid} onChange={(e) => setShowVoid(e.target.checked)} /> show void</label>
            </>}
            columns={[
              { key: 'doc', header: 'STV No.', value: (r) => r.doc_no, render: (r) => <Link className="link font-mono" to={`/stvs/${r.id}`}>{r.doc_no}</Link> },
              { key: 'date', header: 'Date', value: (r) => r.stv_date, render: (r) => fmtDate(r.stv_date) },
              { key: 'type', header: 'Type', value: (r) => DIRECTION[r.direction].label, render: (r) => <Badge tone={DIRECTION[r.direction].tone} title={DIRECTION[r.direction].help}>{DIRECTION[r.direction].label}</Badge> },
              { key: 'from', header: 'From (ERP)', value: (r) => a.locationLabel(r.from_code) },
              { key: 'to', header: 'To (ERP)', value: (r) => a.locationLabel(r.to_code) },
              { key: 'plan', header: 'Plan', value: (r) => (r.direction === 'dispatch' || r.direction === 'direct' ? (r.leg_id ? 'Linked' : 'Unplanned') : ''), render: (r) => (r.direction === 'dispatch' || r.direction === 'direct' ? (r.leg_id ? <Badge tone="good">Linked</Badge> : <Badge tone="purple">Unplanned</Badge>) : null) },
              { key: 'lines', header: 'Lines', align: 'right', value: (r) => r.line_count },
              { key: 'qty', header: 'Qty', align: 'right', value: (r) => Number(r.total_qty), render: (r) => fmtQty(r.total_qty) },
              { key: 'by', header: 'Uploaded', value: (r) => r.uploaded_at, render: (r) => <span className="text-xs text-slate-500">{fmtDateTime(r.uploaded_at)}{names[r.uploaded_by ?? ''] && <> · {names[r.uploaded_by!]}</>}</span> },
              { key: 'status', header: 'Status', value: (r) => r.status, render: (r) => (r.status === 'void' ? <Badge tone="bad" title={r.void_reason ?? ''}>Void</Badge> : <Badge tone="good">Active</Badge>) },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
