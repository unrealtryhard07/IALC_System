// Notification bell: open tasks for the signed-in user, refreshed every 2 minutes and on page change.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { NOTICE_ICON, noticeLabel, type Notice } from '../lib/notices';
import { Icon } from './Icon';

export function Bell() {
  const [items, setItems] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const box = useRef<HTMLDivElement>(null);
  const load = useCallback(() => { rpc<Notice[]>('my_notifications').then(setItems).catch(() => undefined); }, []);

  useEffect(() => { load(); }, [load, loc.pathname]);
  useEffect(() => {
    const t = setInterval(load, 120_000);
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => { clearInterval(t); document.removeEventListener('mousedown', close); };
  }, [load]);

  // "late" is a subset of "to receive" for stores - do not count it twice in the badge
  const total = items.filter((x) => !(x.key === 'late' && items.some((y) => y.key === 'to_receive'))).reduce((s, x) => s + x.n, 0);
  const urgent = items.some((x) => x.tone === 'bad');
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-label={`Notifications (${total})`} title="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800">
        <Icon name="bell" className="h-5 w-5" />
        {total > 0 && (
          <span data-testid="bell-count" className={`absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ring-2 ring-white ${urgent ? 'bg-red-600' : 'bg-brand-500'}`}>
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-x-3 top-14 z-40 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80">
          <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold">Things to do</div>
          {items.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-5 text-sm text-slate-500"><Icon name="checkCircle" className="h-5 w-5 text-green-600" />All clear - nothing waiting for you.</div>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
              {items.map((x) => (
                <li key={x.key}>
                  <Link to={x.to} onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${x.tone === 'bad' ? 'bg-red-50 text-red-600' : x.tone === 'info' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-700'}`}>
                      <Icon name={NOTICE_ICON[x.key] ?? 'alert'} className="h-4 w-4" />
                    </span>
                    <span className="flex-1 text-sm text-slate-700">{x.key !== 'month' && <b className="tabular-nums text-slate-900">{x.n} </b>}{noticeLabel(x)}</span>
                    <Icon name="chevronRight" className="h-4 w-4 text-slate-300" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
