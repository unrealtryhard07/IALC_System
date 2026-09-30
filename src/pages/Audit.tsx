import { useEffect, useState } from 'react';
import { DataTable } from '../components/DataTable';
import { Alert, Card, PageHeader, Spinner } from '../components/ui';
import { fmtDateTime, kwToday } from '../lib/format';
import { friendlyError, supabase } from '../lib/supabase';

interface Row { id: number; at: string; user_id: string | null; action: string; entity: string | null; entity_id: string | null; details: Record<string, unknown> | null }
const ACTIONS: Record<string, string> = {
  upload_stv: 'Uploaded STV', void_stv: 'Voided STV', link_stv_plan: 'Linked STV to plan', create_allocation: 'Created allocation', cancel_allocation: 'Cancelled allocation',
  request_resolution: 'Explained discrepancy', approve_resolution: 'Approved explanation', reject_resolution: 'Rejected explanation', import_items: 'Updated masterlist',
  upload_snapshot: 'Uploaded ERP stock report', auto_map_location: 'Auto-mapped ERP store', create_user: 'Created user', update_user: 'Changed user', reset_password: 'Reset password', bootstrap_admin: 'First admin created',
};

export default function Audit() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  useEffect(() => {
    Promise.all([
      supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(2000),
      supabase.from('profiles').select('user_id, full_name'),
    ]).then(([l, p]) => {
      if (l.error) throw l.error;
      setRows((l.data as Row[]) ?? []);
      setNames(Object.fromEntries((p.data ?? []).map((x: { user_id: string; full_name: string }) => [x.user_id, x.full_name])));
    }).catch((e) => setErr(friendlyError(e)));
  }, []);
  if (err) return <Alert tone="bad">{err}</Alert>;
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Who did what, and when (latest 2,000 actions)." />
      <Card pad={false}>
        {!rows ? <Spinner /> : (
          <DataTable<Row> rows={rows} rowKey={(r) => String(r.id)} exportName={`audit_${kwToday()}`} pageSize={100}
            columns={[
              { key: 'at', header: 'When', value: (r) => r.at, render: (r) => fmtDateTime(r.at) },
              { key: 'who', header: 'User', value: (r) => (r.user_id ? names[r.user_id] ?? r.user_id : 'system') },
              { key: 'action', header: 'Action', value: (r) => ACTIONS[r.action] ?? r.action },
              { key: 'details', header: 'Details', value: (r) => (r.details ? Object.entries(r.details).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : ''), className: 'text-xs text-slate-600 max-w-xl' },
            ]} />
        )}
      </Card>
    </div>
  );
}
