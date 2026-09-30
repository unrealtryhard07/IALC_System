import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Card, Field, Modal, PageHeader, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';
import { ROLE_LABEL } from '../lib/labels';
import { callAdminUsers } from '../lib/supabase';
import type { Role } from '../lib/types';

interface U { user_id: string; full_name: string; login: string; role: Role; active: boolean; site_ids: number[]; last_sign_in_at: string | null }

export default function Users() {
  const a = useAuth();
  const [users, setUsers] = useState<U[] | null>(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<U | 'new' | null>(null);
  const [reset, setReset] = useState<U | null>(null);
  const load = useCallback(() => {
    callAdminUsers<{ users: U[] }>({ action: 'list' }).then((r) => setUsers(r.users.sort((x, y) => x.role.localeCompare(y.role) || x.full_name.localeCompare(y.full_name)))).catch((e) => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="space-y-4">
      <PageHeader title="Users & access" subtitle="Head office accounts see every store. Store accounts see and act only for their assigned store(s)."
        actions={<button className="btn-primary" onClick={() => setEdit('new')}>+ New user</button>} />
      {err && <Alert tone="bad">{err}</Alert>}
      <Card pad={false}>
        {!users ? <Spinner /> : (
          <table className="w-full">
            <thead><tr><th className="th">Name</th><th className="th">Username</th><th className="th">Access</th><th className="th">Stores</th><th className="th">Last sign-in</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id} className={u.active ? '' : 'opacity-60'}>
                  <td className="td font-medium">{u.full_name}</td>
                  <td className="td font-mono text-sm">{u.login}</td>
                  <td className="td"><Badge tone={u.role === 'admin' ? 'purple' : u.role === 'viewer' ? 'info' : 'neutral'}>{ROLE_LABEL[u.role]}</Badge></td>
                  <td className="td text-sm">{u.role === 'store' ? u.site_ids.map(a.siteName).join(', ') || <Badge tone="bad">none</Badge> : 'All'}</td>
                  <td className="td text-sm text-slate-500">{fmtDateTime(u.last_sign_in_at)}</td>
                  <td className="td">{u.active ? <Badge tone="good">Active</Badge> : <Badge>Disabled</Badge>}</td>
                  <td className="td text-right">
                    <button className="btn-ghost btn-sm" onClick={() => setEdit(u)}>Edit</button>
                    <button className="btn-ghost btn-sm" onClick={() => setReset(u)}>Reset password</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Alert tone="info">Tip: give every person their own login (e.g. <span className="font-mono">hawally.ahmed</span>) so the audit log shows who uploaded or approved what. Usernames need no email address.</Alert>
      {edit && <EditUser user={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />}
      {reset && <ResetPassword user={reset} onClose={() => setReset(null)} />}
    </div>
  );
}

function EditUser({ user, onClose, onDone }: { user: U | null; onClose: () => void; onDone: () => void }) {
  const a = useAuth();
  const [f, setF] = useState({ full_name: user?.full_name ?? '', login: user?.login ?? '', password: '', role: user?.role ?? ('store' as Role), site_ids: user?.site_ids ?? [], active: user?.active ?? true });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr('');
    try {
      if (user) await callAdminUsers({ action: 'update', user_id: user.user_id, full_name: f.full_name, role: f.role, site_ids: f.role === 'store' ? f.site_ids : [], active: f.active });
      else await callAdminUsers({ action: 'create', ...f, site_ids: f.role === 'store' ? f.site_ids : [] });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };
  return (
    <Modal open title={user ? `Edit ${user.full_name}` : 'New user'} onClose={onClose} footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </>}>
      <div className="space-y-3">
        <Field label="Full name"><input className="input" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        {!user && <>
          <Field label="Username" hint="Letters, numbers, dot, dash. Or an email address."><input className="input font-mono" value={f.login} onChange={(e) => setF({ ...f, login: e.target.value })} /></Field>
          <Field label="Temporary password (min. 8)"><input className="input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        </>}
        <Field label="Access">
          <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            <option value="store">Store user - only assigned stores</option>
            <option value="viewer">Head office - view only</option>
            <option value="admin">Head office - admin (full access)</option>
          </select>
        </Field>
        {f.role === 'store' && (
          <div>
            <div className="label">Stores</div>
            <div className="flex flex-wrap gap-3">
              {a.sites.map((s) => (
                <label key={s.id} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={f.site_ids.includes(s.id)} onChange={(e) => setF({ ...f, site_ids: e.target.checked ? [...f.site_ids, s.id] : f.site_ids.filter((x) => x !== s.id) })} />
                  {s.name}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">A Jahra supervisor who also runs the DC can have both Jahra and Jahra DC.</p>
          </div>
        )}
        {user && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Account active (untick to block sign-in)</label>}
        {err && <Alert tone="bad">{err}</Alert>}
      </div>
    </Modal>
  );
}

function ResetPassword({ user, onClose }: { user: U; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  return (
    <Modal open title={`Reset password - ${user.full_name}`} onClose={onClose} footer={<>
      <button className="btn-secondary" onClick={onClose}>Close</button>
      <button className="btn-primary" onClick={() => callAdminUsers({ action: 'reset_password', user_id: user.user_id, password: pw }).then(() => setMsg({ tone: 'good', text: 'Password changed. Give it to the user and ask them to change it under Account.' })).catch((e) => setMsg({ tone: 'bad', text: e.message }))}>Set password</button>
    </>}>
      <Field label="New password (min. 8)"><input className="input" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      {msg && <div className="mt-2"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
    </Modal>
  );
}
