import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Field } from '../components/ui';
import { callAdminUsers, loginToEmail, supabase } from '../lib/supabase';

export default function Setup() {
  const [f, setF] = useState({ code: '', full_name: '', login: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <form className="card w-full max-w-md space-y-3 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (f.password !== f.confirm) return setError('Passwords do not match.');
          setBusy(true);
          setError('');
          try {
            await callAdminUsers({ action: 'bootstrap', code: f.code, full_name: f.full_name, login: f.login, password: f.password });
            const { error } = await supabase.auth.signInWithPassword({ email: loginToEmail(f.login), password: f.password });
            if (error) throw error;
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}>
        <div>
          <div className="text-xl font-bold text-blue-800">First-time setup</div>
          <p className="text-sm text-slate-500">Create the first head-office administrator. This works only once, with the setup code.</p>
        </div>
        <Field label="Setup code"><input className="input font-mono uppercase" value={f.code} onChange={set('code')} required /></Field>
        <Field label="Your full name"><input className="input" value={f.full_name} onChange={set('full_name')} required /></Field>
        <Field label="Username" hint="Letters, numbers, dot or dash. Used to sign in."><input className="input" value={f.login} onChange={set('login')} required /></Field>
        <Field label="Password (min. 8 characters)"><input className="input" type="password" value={f.password} onChange={set('password')} minLength={8} required /></Field>
        <Field label="Confirm password"><input className="input" type="password" value={f.confirm} onChange={set('confirm')} required /></Field>
        {error && <Alert tone="bad">{error}</Alert>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating…' : 'Create administrator'}</button>
        <p className="text-center text-xs"><Link className="link" to="/">Back to sign in</Link></p>
      </form>
    </div>
  );
}
