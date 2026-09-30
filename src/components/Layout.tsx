import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ROLE_LABEL } from '../lib/labels';

interface NavItem { to: string; label: string; icon: string; show: boolean }

export default function Layout({ children }: { children: ReactNode }) {
  const a = useAuth();
  const [open, setOpen] = useState(false);
  const storeOrAdmin = a.isAdmin || a.profile?.role === 'store';
  const sections: { title: string; items: NavItem[] }[] = [
    {
      title: 'Operations',
      items: [
        { to: '/', label: 'Dashboard', icon: '◧', show: true },
        { to: '/upload', label: 'Upload STV', icon: '⇪', show: storeOrAdmin },
        { to: '/allocations', label: 'Allocations', icon: '⇄', show: true },
        { to: '/in-transit', label: 'In transit', icon: '⏱', show: true },
        { to: '/discrepancies', label: 'Discrepancies', icon: '⚑', show: true },
        { to: '/stvs', label: 'STV register', icon: '☰', show: true },
        { to: '/virtual-stores', label: 'Virtual store watch', icon: '◎', show: true },
      ],
    },
    {
      title: 'Data',
      items: [
        { to: '/items', label: 'Items masterlist', icon: '▦', show: true },
        { to: '/reports', label: 'Reports (Excel)', icon: '⬇', show: true },
      ],
    },
    {
      title: 'Admin',
      items: [
        { to: '/users', label: 'Users & access', icon: '☺', show: a.isAdmin },
        { to: '/settings', label: 'Settings', icon: '⚙', show: a.isAdmin },
        { to: '/audit', label: 'Audit log', icon: '✎', show: a.isHO },
      ],
    },
  ];
  const stores = a.isHO ? 'All stores' : a.mySiteIds.map((id) => a.siteName(id)).join(', ') || 'No store assigned';

  const nav = (
    <nav className="flex flex-col gap-4 p-3">
      {sections.map((s) => {
        const items = s.items.filter((i) => i.show);
        if (!items.length) return null;
        return (
          <div key={s.title}>
            <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{s.title}</div>
            {items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.to === '/'} onClick={() => setOpen(false)}
                className={({ isActive }) => `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${isActive ? 'bg-blue-50 font-semibold text-blue-800' : 'text-slate-700 hover:bg-slate-100'}`}>
                <span className="w-4 text-center text-slate-400" aria-hidden>{i.icon}</span>
                {i.label}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white lg:block">
        <div className="border-b border-slate-100 px-4 py-4">
          <div className="text-base font-bold text-blue-800">IALC</div>
          <div className="text-xs text-slate-500">Allocation Control System</div>
        </div>
        {nav}
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur">
          <button className="btn-ghost lg:hidden" onClick={() => setOpen(!open)} aria-label="Menu">☰</button>
          <span className="font-bold text-blue-800 lg:hidden">IALC</span>
          <div className="ml-auto flex items-center gap-3 text-right">
            <div className="hidden leading-tight sm:block">
              <div className="text-sm font-medium">{a.profile?.full_name}</div>
              <div className="text-xs text-slate-500">{a.profile && ROLE_LABEL[a.profile.role]} · {stores}</div>
            </div>
            <NavLink to="/account" className="btn-ghost btn-sm">Account</NavLink>
            <button className="btn-secondary btn-sm" onClick={a.signOut}>Sign out</button>
          </div>
        </header>
        {open && <div className="border-b border-slate-200 bg-white lg:hidden">{nav}</div>}
        <main className="mx-auto max-w-[1400px] p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
