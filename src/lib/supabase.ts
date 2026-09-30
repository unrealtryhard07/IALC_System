import { createClient, type PostgrestError } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = Boolean(url && key);

export const supabase = createClient(url || 'http://localhost', key || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const USERNAME_DOMAIN = 'ialc.local';
export const loginToEmail = (login: string) => {
  const l = login.trim().toLowerCase();
  return l.includes('@') ? l : `${l}@${USERNAME_DOMAIN}`;
};

/** Turns database error text into something a store user can read. */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as PostgrestError).message) : String(e);
  return msg
    .replace(/^(NOT_ALLOWED|DUPLICATE|UNKNOWN_LOCATION):\s*/, '')
    .replace(/^NOT_ALLOWED$/, 'You do not have permission to do this.');
}

export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(friendlyError(error));
  return data as T;
}

/** Reads every row of a query, 1000 at a time (PostgREST caps a single response). */
export async function fetchAll<T>(
  make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await make(from, from + pageSize - 1);
    if (error) throw new Error(friendlyError(error));
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

export async function callAdminUsers<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    // functions-js wraps non-2xx; read the JSON error body when present
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      const j = await ctx.json().catch(() => null);
      if (j?.error) throw new Error(j.error);
    }
    throw new Error(error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export async function uploadDocument(folder: 'stv' | 'plans' | 'snapshots' | 'masterlist', file: File): Promise<string | null> {
  const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-120);
  const path = `${folder}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}_${safe}`;
  const { error } = await supabase.storage.from('documents').upload(path, file, { upsert: false });
  if (error) {
    console.warn('Document upload failed', error);
    return null; // the record is still saved; original file just isn't archived
  }
  return path;
}

export async function openDocument(path: string) {
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 300);
  if (error || !data) throw new Error(friendlyError(error ?? 'File not available'));
  window.open(data.signedUrl, '_blank', 'noopener');
}
