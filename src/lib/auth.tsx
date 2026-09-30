import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import type { ErpLocation, Profile, ReasonCode, Site } from './types';

interface Ref {
  sites: Site[];
  locations: ErpLocation[];
  reasons: ReasonCode[];
  settings: Record<string, unknown>;
}
interface AuthState extends Ref {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  mySiteIds: number[];
  isAdmin: boolean;
  isHO: boolean;
  siteName: (id: number | null | undefined) => string;
  locationLabel: (code: string | null | undefined) => string;
  canActFor: (siteId: number | null | undefined) => boolean;
  receiptSla: number;
  dispatchSla: number;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const EMPTY_REF: Ref = { sites: [], locations: [], reasons: [], settings: {} };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mySiteIds, setMySiteIds] = useState<number[]>([]);
  const [ref, setRef] = useState<Ref>(EMPTY_REF);
  const [loading, setLoading] = useState(true);

  const loadFor = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setMySiteIds([]);
      setRef(EMPTY_REF);
      return;
    }
    const uid = s.user.id;
    const [p, us, sites, locs, reasons, settings] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', uid).maybeSingle(),
      supabase.from('user_sites').select('site_id').eq('user_id', uid),
      supabase.from('sites').select('*').order('sort_order'),
      supabase.from('erp_locations').select('*').order('code'),
      supabase.from('reason_codes').select('*').order('sort_order'),
      supabase.from('settings').select('*'),
    ]);
    setProfile((p.data as Profile) ?? null);
    setMySiteIds((us.data ?? []).map((r: { site_id: number }) => r.site_id));
    setRef({
      sites: (sites.data as Site[]) ?? [],
      locations: (locs.data as ErpLocation[]) ?? [],
      reasons: (reasons.data as ReasonCode[]) ?? [],
      settings: Object.fromEntries((settings.data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value])),
    });
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadFor(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        setLoading(true);
        loadFor(s).finally(() => setLoading(false));
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadFor]);

  const value = useMemo<AuthState>(() => {
    const isAdmin = profile?.role === 'admin' && profile.active;
    const isHO = (profile?.role === 'admin' || profile?.role === 'viewer') && !!profile?.active;
    return {
      ...ref,
      loading,
      session,
      profile,
      mySiteIds,
      isAdmin: !!isAdmin,
      isHO,
      siteName: (id) => ref.sites.find((s) => s.id === id)?.name ?? (id ? `#${id}` : '–'),
      locationLabel: (code) => {
        const l = ref.locations.find((x) => x.code === code);
        return l ? `${l.erp_name} (${l.code})` : code ?? '–';
      },
      canActFor: (siteId) => !!isAdmin || (profile?.role === 'store' && siteId != null && mySiteIds.includes(siteId)),
      receiptSla: Number(ref.settings.receipt_sla_days ?? 1),
      dispatchSla: Number(ref.settings.dispatch_sla_days ?? 2),
      reload: () => loadFor(session),
      signOut: async () => {
        await supabase.auth.signOut();
      },
    };
  }, [ref, loading, session, profile, mySiteIds, loadFor]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside provider');
  return v;
}
