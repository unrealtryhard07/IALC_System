// admin-users: user management for IALC (needs the service role, so it lives server-side).
// Actions:
//   bootstrap      { code, login, password, full_name }       - first admin, only while no admin exists
//   list                                                     - admin
//   create         { login, password, full_name, role, site_ids } - admin
//   update         { user_id, full_name?, role?, site_ids?, active? } - admin
//   reset_password { user_id, password }                    - admin
// Logins without "@" are usernames and are stored as <username>@ialc.local (no emails are ever sent).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const USERNAME_DOMAIN = 'ialc.local';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const toEmail = (login: string) => {
  const l = login.trim().toLowerCase();
  return l.includes('@') ? l : `${l}@${USERNAME_DOMAIN}`;
};
const toLogin = (email: string | undefined) => (email ?? '').replace(`@${USERNAME_DOMAIN}`, '');

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');

    const validatePassword = (p: unknown) => {
      if (typeof p !== 'string' || p.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
    };
    const validateLogin = (l: unknown) => {
      if (typeof l !== 'string' || !/^[a-zA-Z0-9._@-]{3,64}$/.test(l.trim())) {
        throw new HttpError(400, 'Username may contain letters, numbers, dot, dash and underscore (3-64 characters).');
      }
    };
    const setSites = async (userId: string, siteIds: unknown) => {
      if (!Array.isArray(siteIds)) return;
      await admin.from('user_sites').delete().eq('user_id', userId);
      const rows = siteIds.map((s) => ({ user_id: userId, site_id: Number(s) })).filter((r) => Number.isFinite(r.site_id));
      if (rows.length) {
        const { error } = await admin.from('user_sites').insert(rows);
        if (error) throw new HttpError(400, error.message);
      }
    };
    const audit = (userId: string | null, act: string, entityId: string, details: unknown) =>
      admin.from('audit_log').insert({ user_id: userId, action: act, entity: 'user', entity_id: entityId, details });

    // ---- bootstrap: create the first admin with the one-time code ----
    if (action === 'bootstrap') {
      const { count } = await admin.from('profiles').select('user_id', { count: 'exact', head: true }).eq('role', 'admin');
      if ((count ?? 0) > 0) throw new HttpError(403, 'Setup is already complete. Ask an administrator for an account.');
      const { data: secret } = await admin.from('app_secrets').select('value').eq('key', 'bootstrap_code').single();
      if (!secret || String(body.code ?? '').trim().toUpperCase() !== secret.value) throw new HttpError(403, 'Setup code is not correct.');
      validateLogin(body.login);
      validatePassword(body.password);
      const { data, error } = await admin.auth.admin.createUser({
        email: toEmail(body.login), password: body.password, email_confirm: true,
        user_metadata: { full_name: body.full_name },
      });
      if (error) throw new HttpError(400, error.message);
      const { error: pe } = await admin.from('profiles').insert({
        user_id: data.user.id, full_name: String(body.full_name || body.login), login: String(body.login).trim().toLowerCase(), role: 'admin',
      });
      if (pe) throw new HttpError(400, pe.message);
      await audit(data.user.id, 'bootstrap_admin', data.user.id, { login: body.login });
      return json({ ok: true });
    }

    // ---- everything else requires a signed-in active admin ----
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: who } = await admin.auth.getUser(token);
    if (!who?.user) throw new HttpError(401, 'Please sign in again.');
    const { data: me } = await admin.from('profiles').select('role, active').eq('user_id', who.user.id).single();
    if (!me || me.role !== 'admin' || !me.active) throw new HttpError(403, 'Only head office administrators can manage users.');
    const actor = who.user.id;

    if (action === 'list') {
      const users: { id: string; email?: string; last_sign_in_at?: string }[] = [];
      for (let page = 1; page < 50; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (error) throw new HttpError(400, error.message);
        users.push(...data.users);
        if (data.users.length < 200) break;
      }
      const { data: profiles } = await admin.from('profiles').select('*');
      const { data: sites } = await admin.from('user_sites').select('*');
      return json({
        users: (profiles ?? []).map((p) => {
          const u = users.find((x) => x.id === p.user_id);
          return {
            ...p,
            login: p.login ?? toLogin(u?.email),
            last_sign_in_at: u?.last_sign_in_at ?? null,
            site_ids: (sites ?? []).filter((s) => s.user_id === p.user_id).map((s) => s.site_id),
          };
        }),
      });
    }

    if (action === 'create') {
      validateLogin(body.login);
      validatePassword(body.password);
      if (!['admin', 'viewer', 'store'].includes(body.role)) throw new HttpError(400, 'Invalid role.');
      if (body.role === 'store' && (!Array.isArray(body.site_ids) || body.site_ids.length === 0)) {
        throw new HttpError(400, 'A store user needs at least one store.');
      }
      const { data, error } = await admin.auth.admin.createUser({
        email: toEmail(body.login), password: body.password, email_confirm: true,
        user_metadata: { full_name: body.full_name },
      });
      if (error) throw new HttpError(400, error.message.includes('already') ? 'That username is already taken.' : error.message);
      const { error: pe } = await admin.from('profiles').insert({
        user_id: data.user.id, full_name: String(body.full_name || body.login), login: String(body.login).trim().toLowerCase(), role: body.role,
      });
      if (pe) {
        await admin.auth.admin.deleteUser(data.user.id);
        throw new HttpError(400, pe.message);
      }
      await setSites(data.user.id, body.site_ids ?? []);
      await audit(actor, 'create_user', data.user.id, { login: body.login, role: body.role, site_ids: body.site_ids });
      return json({ ok: true, user_id: data.user.id });
    }

    if (action === 'update') {
      const id = String(body.user_id ?? '');
      if (!id) throw new HttpError(400, 'user_id is required.');
      if (id === actor && (body.active === false || (body.role && body.role !== 'admin'))) {
        throw new HttpError(400, 'You cannot deactivate or demote your own account.');
      }
      const patch: Record<string, unknown> = {};
      if (typeof body.full_name === 'string') patch.full_name = body.full_name;
      if (body.role) {
        if (!['admin', 'viewer', 'store'].includes(body.role)) throw new HttpError(400, 'Invalid role.');
        patch.role = body.role;
      }
      if (typeof body.active === 'boolean') {
        patch.active = body.active;
        await admin.auth.admin.updateUserById(id, { ban_duration: body.active ? 'none' : '876000h' });
      }
      if (Object.keys(patch).length) {
        const { error } = await admin.from('profiles').update(patch).eq('user_id', id);
        if (error) throw new HttpError(400, error.message);
      }
      await setSites(id, body.site_ids);
      await audit(actor, 'update_user', id, { ...patch, site_ids: body.site_ids });
      return json({ ok: true });
    }

    if (action === 'reset_password') {
      validatePassword(body.password);
      const { error } = await admin.auth.admin.updateUserById(String(body.user_id), { password: body.password });
      if (error) throw new HttpError(400, error.message);
      await audit(actor, 'reset_password', String(body.user_id), null);
      return json({ ok: true });
    }

    throw new HttpError(400, `Unknown action "${action}"`);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
