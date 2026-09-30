import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '../components/ui';
import { loginToEmail, supabase } from '../lib/supabase';

export default function Login() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <form
        className="card w-full max-w-sm p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const { error } = await supabase.auth.signInWithPassword({ email: loginToEmail(login), password });
          setBusy(false);
          if (error) setError(error.message === 'Invalid login credentials' ? 'Wrong username or password.' : error.message);
        }}>
        <div className="mb-5">
          <div className="text-2xl font-bold text-blue-800">IALC</div>
          <div className="text-sm text-slate-500">Internal Allocation Control System</div>
        </div>
        <label className="label" htmlFor="login">Username</label>
        <input id="login" className="input mb-3" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus />
        <label className="label" htmlFor="password">Password</label>
        <input id="password" className="input mb-4" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <div className="mb-3"><Alert tone="bad">{error}</Alert></div>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="mt-4 text-center text-xs text-slate-500">
          Accounts are created by head office. <Link to="/setup" className="link">First-time setup</Link>
        </p>
      </form>
    </div>
  );
}
