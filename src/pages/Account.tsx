import { useState } from 'react';
import { Alert, Card, Field, PageHeader } from '../components/ui';
import { useAuth } from '../lib/auth';
import { ROLE_LABEL } from '../lib/labels';
import { supabase } from '../lib/supabase';

export default function Account() {
  const a = useAuth();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  return (
    <div className="max-w-lg">
      <PageHeader title="My account" />
      <Card title="Profile" className="mb-4">
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <dt className="text-slate-500">Name</dt><dd className="col-span-2">{a.profile?.full_name}</dd>
          <dt className="text-slate-500">Username</dt><dd className="col-span-2">{a.profile?.login}</dd>
          <dt className="text-slate-500">Access</dt><dd className="col-span-2">{a.profile && ROLE_LABEL[a.profile.role]}</dd>
          <dt className="text-slate-500">Stores</dt><dd className="col-span-2">{a.isHO ? 'All stores' : a.mySiteIds.map(a.siteName).join(', ')}</dd>
        </dl>
      </Card>
      <Card title="Change password">
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          if (pw.length < 8) return setMsg({ tone: 'bad', text: 'At least 8 characters.' });
          if (pw !== pw2) return setMsg({ tone: 'bad', text: 'Passwords do not match.' });
          const { error } = await supabase.auth.updateUser({ password: pw });
          setMsg(error ? { tone: 'bad', text: error.message } : { tone: 'good', text: 'Password changed.' });
          if (!error) { setPw(''); setPw2(''); }
        }}>
          <Field label="New password"><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="Confirm"><input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Field>
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <button className="btn-primary">Save password</button>
        </form>
      </Card>
    </div>
  );
}
