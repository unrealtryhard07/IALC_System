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
    <div className="flex min-h-screen bg-[#f6f7f9]">
      <div className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-brand-500 p-10 text-white lg:flex">
        <img src="/icon-512.png" alt="" className="absolute -bottom-24 -right-24 w-[420px] opacity-15" />
        <img src="/circle-logo.png" alt="Circle" className="h-9 w-auto self-start brightness-0 invert" />
        <div className="relative">
          <h2 className="text-3xl font-semibold leading-tight">Every allocation,<br />tracked from plan to shelf.</h2>
          <p className="mt-3 max-w-sm text-white/80">Plan, send and receive stock between stores - and make sure nothing gets stuck in a virtual store again.</p>
        </div>
        <div className="text-xs text-white/60">Circle United General Trading Co</div>
      </div>
      <div className="flex flex-1 items-center justify-center p-4">
      <form
        className="card w-full max-w-sm p-7"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const { error } = await supabase.auth.signInWithPassword({ email: loginToEmail(login), password });
          setBusy(false);
          if (error) setError(error.message === 'Invalid login credentials' ? 'Wrong username or password.' : error.message);
        }}>
        <div className="mb-6">
          <img src="/circle-logo.png" alt="Circle" className="h-7 w-auto lg:hidden" />
          <h1 className="mt-3 text-xl font-semibold tracking-tight lg:mt-0">Sign in</h1>
          <p className="text-sm text-slate-500">Allocation Control System</p>
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
    </div>
  );
}
