import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ROLE_LABEL } from '../lib/labels';

interface NavItem { to: string; label: string; icon: string; hint?: string }

export default function Layout({ children }: { children: ReactNode }) {
  const a = useAuth();
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const isStore = a.profile?.role === 'store';

  // Store staff only see what they need every day; head office gets the control pages.
  const main: NavItem[] = isStore
    ? [
        { to: '/', label: 'Home - my tasks', icon: '🏠' },
        { to: '/allocations', label: 'My allocations', icon: '📋', hint: 'coming to me & sending out' },
        { to: '/upload', label: 'Upload STV', icon: '⬆️', hint: 'sent or received stock' },
        { to: '/discrepancies', label: 'Problems to explain', icon: '⚠️' },
        { to: '/stvs', label: 'My STVs', icon: '📄' },
        { to: '/help', label: 'How it works', icon: '❓' },
      ]
    : [
        { to: '/', label: 'Home', icon: '🏠' },
        { to: '/allocations', label: 'Allocation tracker', icon: '📋' },
        { to: '/in-transit', label: 'Waiting to be received', icon: '🚚' },
        { to: '/discrepancies', label: 'Problems & approvals', icon: '⚠️' },
        { to: '/virtual-stores', label: 'Stuck stock check', icon: '🔍' },
        { to: '/reports', label: 'Excel reports', icon: '📊' },
      ];
  const extra: NavItem[] = isStore
    ? []
    : [
        ...(a.isAdmin ? [{ to: '/upload', label: 'Upload STV', icon: '⬆️' }] : []),
        { to: '/stvs', label: 'All STVs', icon: '📄' },
        { to: '/items', label: 'Items list', icon: '📦' },
        ...(a.isAdmin ? [{ to: '/users', label: 'Users', icon: '👤' }, { to: '/settings', label: 'Settings', icon: '⚙️' }] : []),
        { to: '/audit', label: 'Activity log', icon: '🕘' },
        { to: '/help', label: 'How it works', icon: '❓' },
      ];

  const link = (i: NavItem) => (
    <NavLink key={i.to} to={i.to} end={i.to === '/'} onClick={() => setOpen(false)}
      className={({ isActive }) => `flex items-center gap-2.5 rounded-lg px-3 py-2 text-[15px] ${isActive ? 'bg-blue-50 font-semibold text-blue-800' : 'text-slate-700 hover:bg-slate-100'}`}>
      <span className="w-5 text-center" aria-hidden>{i.icon}</span>
      <span>{i.label}{i.hint && <span className="block text-xs font-normal text-slate-500">{i.hint}</span>}</span>
    </NavLink>
  );

  const nav = (
    <nav className="flex flex-col gap-1 p-3">
      {main.map(link)}
      {extra.length > 0 && (
        <>
          <button type="button" onClick={() => setMore(!more)} className="mt-3 flex items-center gap-2 px-3 py-1 text-left text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600">
            {more ? '▾' : '▸'} More
          </button>
          {more && extra.map(link)}
        </>
      )}
    </nav>
  );
  const stores = a.isHO ? 'All stores' : a.mySiteIds.map((id) => a.siteName(id)).join(', ') || 'No store assigned';

  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:block">
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="text-lg font-bold text-blue-800">IALC</div>
          <div className="text-xs text-slate-500">Store transfers control</div>
        </div>
        {nav}
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur">
          <button className="btn-ghost lg:hidden" onClick={() => setOpen(!open)} aria-label="Menu">☰ Menu</button>
          <div className="ml-auto flex items-center gap-3 text-right">
            <div className="hidden leading-tight sm:block">
              <div className="text-sm font-medium">{a.profile?.full_name}</div>
              <div className="text-xs text-slate-500">{a.profile && ROLE_LABEL[a.profile.role]} · {stores}</div>
            </div>
            <NavLink to="/account" className="btn-ghost btn-sm">My account</NavLink>
            <button className="btn-secondary btn-sm" onClick={a.signOut}>Sign out</button>
          </div>
        </header>
        {open && <div className="border-b border-slate-200 bg-white lg:hidden">{nav}</div>}
        <main className="mx-auto max-w-[1400px] p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
