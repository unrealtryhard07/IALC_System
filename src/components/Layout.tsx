import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ROLE_LABEL } from '../lib/labels';
import { Icon, type IconName } from './Icon';

interface NavItem { to: string; label: string; icon: IconName; hint?: string }

export default function Layout({ children }: { children: ReactNode }) {
  const a = useAuth();
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const isStore = a.profile?.role === 'store';

  // Store staff only see what they need every day; head office gets the control pages.
  const main: NavItem[] = isStore
    ? [
        { to: '/', label: 'My tasks', icon: 'home' },
        { to: '/allocations', label: 'My allocations', icon: 'list', hint: 'Coming to me & sending out' },
        { to: '/upload', label: 'Upload STV', icon: 'upload', hint: 'Sent or received stock' },
        { to: '/discrepancies', label: 'Problems to explain', icon: 'alert' },
        { to: '/stvs', label: 'My STVs', icon: 'file' },
        { to: '/help', label: 'How it works', icon: 'help' },
      ]
    : [
        { to: '/', label: 'Overview', icon: 'overview' },
        { to: '/allocations', label: 'Allocation tracker', icon: 'list' },
        { to: '/in-transit', label: 'Waiting to be received', icon: 'truck' },
        { to: '/discrepancies', label: 'Problems & approvals', icon: 'alert' },
        { to: '/virtual-stores', label: 'Stuck stock check', icon: 'search' },
        { to: '/reports', label: 'Excel reports', icon: 'chart' },
      ];
  const extra: NavItem[] = isStore
    ? []
    : [
        ...(a.isAdmin ? [{ to: '/upload', label: 'Upload STV', icon: 'upload' as IconName }] : []),
        { to: '/stvs', label: 'All STVs', icon: 'file' },
        { to: '/items', label: 'Items list', icon: 'box' },
        ...(a.isAdmin ? [{ to: '/users', label: 'Users', icon: 'users' as IconName }, { to: '/settings', label: 'Settings', icon: 'settings' as IconName }] : []),
        { to: '/audit', label: 'Activity log', icon: 'clock' },
        { to: '/help', label: 'How it works', icon: 'help' },
      ];

  const link = (i: NavItem) => (
    <NavLink key={i.to} to={i.to} end={i.to === '/'} onClick={() => setOpen(false)}
      className={({ isActive }) => `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${isActive ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute left-0 top-1.5 h-[calc(100%-12px)] w-[3px] rounded-r bg-brand-500" aria-hidden />}
          <Icon name={i.icon} className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-600'}`} />
          <span className="leading-tight">{i.label}{i.hint && <span className="block text-[11px] font-normal text-slate-400">{i.hint}</span>}</span>
        </>
      )}
    </NavLink>
  );

  const nav = (
    <nav className="flex flex-col gap-0.5 p-3">
      {main.map(link)}
      {extra.length > 0 && (
        <>
          <button type="button" onClick={() => setMore(!more)} className="mt-4 flex items-center gap-1.5 px-3 py-1 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600">
            <Icon name={more ? 'chevronDown' : 'chevronRight'} className="h-3.5 w-3.5" /> More
          </button>
          {more && extra.map(link)}
        </>
      )}
    </nav>
  );
  const stores = a.isHO ? 'All stores' : a.mySiteIds.map((id) => a.siteName(id)).join(', ') || 'No store assigned';
  const initials = (a.profile?.full_name ?? '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <div className="px-5 pb-4 pt-5">
          <img src="/circle-logo.png" alt="Circle" className="h-7 w-auto" />
          <div className="mt-1.5 text-xs font-medium uppercase tracking-wider text-slate-400">Allocation Control</div>
        </div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <div className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400">Circle United General Trading Co</div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-2.5 backdrop-blur lg:px-6">
          <button className="btn-ghost lg:hidden" onClick={() => setOpen(!open)} aria-label="Menu"><Icon name="menu" /></button>
          <img src="/circle-logo.png" alt="Circle" className="h-5 w-auto lg:hidden" />
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-sm font-medium text-slate-800">{a.profile?.full_name}</div>
              <div className="text-xs text-slate-500">{a.profile && ROLE_LABEL[a.profile.role]} · {stores}</div>
            </div>
            <NavLink to="/account" title="My account" className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700 ring-1 ring-brand-100 hover:bg-brand-100">{initials}</NavLink>
            <button className="btn-ghost btn-sm" onClick={a.signOut} title="Sign out"><Icon name="logout" className="h-4 w-4" /><span className="hidden sm:inline">Sign out</span></button>
          </div>
        </header>
        {open && <div className="border-b border-slate-200 bg-white lg:hidden">{nav}</div>}
        <main className="mx-auto max-w-[1440px] p-4 lg:p-7">{children}</main>
      </div>
    </div>
  );
}
