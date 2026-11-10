// status / me / roles / users (GET)  ·  setup / login / logout / save-user / save-role / delete-user (POST)
import crypto from 'node:crypto';
import { sql } from '../../../lib/db.js';
import {
  SESSION_S, json, eq, hashPw, mkToken, cookie, getSession, countUsers, getUserByUsername, getUserById,
  locked, noteFail, clearFails, requireAdmin, listRoles, listUsers, nextAuthId, nextRoleId, TABS,
} from '../../../lib/auth.js';
import { normalizeTabs, DEFAULT_STAFF_TABS, allTabsOn } from '../../../lib/perms.js';
export const dynamic = 'force-dynamic';

function publicSession(s) {
  return { user: s.user, role: s.role, roleId: s.roleId, isAdmin: s.isAdmin, tabs: s.tabs, tabsMeta: TABS };
}

export async function GET(req, { params }) {
  const { action } = await params;
  try {
    if (action === 'status') {
      const n = await countUsers();
      return json({ setup: n === 0, tabsMeta: TABS });
    }
    if (action === 'me') {
      const s = await getSession(req);
      return s ? json(publicSession(s)) : json({ error: 'Not signed in' }, 401);
    }
    if (action === 'roles') {
      const a = await requireAdmin(req);
      if (a.error) return a.error;
      return json({ roles: await listRoles(), tabsMeta: TABS });
    }
    if (action === 'users') {
      const a = await requireAdmin(req);
      if (a.error) return a.error;
      return json({ users: await listUsers(), roles: await listRoles(), tabsMeta: TABS });
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) { return json({ error: e.message }, 500); }
}

export async function POST(req, { params }) {
  const { action } = await params;
  if (!/json/.test(req.headers.get('content-type') || '')) return json({ error: 'JSON required' }, 415);
  if (action === 'logout') return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0, req) });

  try {
    let b = {}; try { b = await req.json(); } catch (e) { b = {}; }

    if (action === 'setup') {
      if (await countUsers()) return json({ error: 'Password already created. Please sign in.' }, 409);
      if (await locked(req)) return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
      const bad = async m => { await noteFail(req); return json({ error: m }, 401); };
      const code = process.env.SETUP_CODE;
      if (!code) return json({ error: 'First logon is switched off: set SETUP_CODE in the server environment.' }, 503);
      if (!eq(String(b.code || '').trim().toUpperCase(), code.trim().toUpperCase())) return bad('Setup code is not correct.');
      const username = String(b.username || 'admin').trim().toLowerCase();
      if (!/^[a-z0-9._-]{2,32}$/.test(username)) return json({ error: 'Username must be 2–32 letters, numbers, . _ or -' }, 400);
      const pw = String(b.password || '');
      if (pw.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400);
      const q = await sql();
      const adminRole = (await q`SELECT id FROM app_roles WHERE is_admin = true ORDER BY id LIMIT 1`)[0];
      if (!adminRole) return json({ error: 'Admin role missing — restart the app.' }, 500);
      const salt = crypto.randomBytes(16).toString('hex'), hash = await hashPw(pw, salt);
      const id = await nextAuthId(q);
      const ins = await q`INSERT INTO app_auth (id, username, salt, hash, role_id, active)
        VALUES (${id}, ${username}, ${salt}, ${hash}, ${adminRole.id}, true)
        ON CONFLICT DO NOTHING RETURNING id`;
      if (!ins.length) return json({ error: 'Password already created. Please sign in.' }, 409);
      await clearFails(req);
      const row = await getUserById(id);
      return json({ ok: true }, 200, { 'Set-Cookie': cookie(mkToken(row), SESSION_S, req) });
    }

    if (action === 'login') {
      if (await locked(req)) return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
      const bad = async m => { await noteFail(req); return json({ error: m }, 401); };
      if (!(await countUsers())) return json({ error: 'First logon has not been done yet.' }, 409);
      const pw = String(b.password || '');
      const row = await getUserByUsername(b.username);
      // Always hash when possible so timing is closer for wrong usernames
      const salt = row ? row.salt : crypto.randomBytes(16).toString('hex');
      const good = await hashPw(pw, salt);
      if (!row || !row.active || !eq(good, row.hash)) return bad('Wrong username or password.');
      if (!row.role_id) return bad('This account has no role assigned. Ask an admin.');
      await clearFails(req);
      return json({ ok: true }, 200, { 'Set-Cookie': cookie(mkToken(row), SESSION_S, req) });
    }

    if (action === 'save-role') {
      const a = await requireAdmin(req);
      if (a.error) return a.error;
      const q = await sql();
      const name = String(b.name || '').trim();
      if (!name || name.length > 40) return json({ error: 'Role name required (max 40).' }, 400);

      if (b.id) {
        const id = Number(b.id);
        const cur = (await q`SELECT id, is_admin FROM app_roles WHERE id = ${id}`)[0];
        if (!cur) return json({ error: 'Role not found' }, 404);
        if (cur.is_admin) {
          await q`UPDATE app_roles SET tabs = ${allTabsOn()} WHERE id = ${id}`;
        } else {
          const tabs = normalizeTabs(b.tabs, false);
          await q`UPDATE app_roles SET name = ${name}, tabs = ${tabs} WHERE id = ${id}`;
        }
      } else {
        const id = await nextRoleId(q);
        const tabs = normalizeTabs(b.tabs || DEFAULT_STAFF_TABS, false);
        try {
          await q`INSERT INTO app_roles (id, name, is_admin, tabs) VALUES (${id}, ${name}, false, ${tabs})`;
        } catch (e) {
          if (/unique/i.test(e.message || '')) return json({ error: 'A role with that name already exists.' }, 409);
          throw e;
        }
      }
      return json({ ok: true, roles: await listRoles() });
    }

    if (action === 'save-user') {
      const a = await requireAdmin(req);
      if (a.error) return a.error;
      const q = await sql();
      const username = String(b.username || '').trim().toLowerCase();
      const roleId = Number(b.roleId);
      const role = (await q`SELECT id, is_admin FROM app_roles WHERE id = ${roleId}`)[0];
      if (!role) return json({ error: 'Choose a valid role.' }, 400);

      if (b.id) {
        const id = Number(b.id);
        const cur = await getUserById(id);
        if (!cur) return json({ error: 'User not found' }, 404);
        if (cur.is_admin && !role.is_admin) {
          const admins = Number((await q`SELECT count(*)::int AS n FROM app_auth a JOIN app_roles r ON r.id = a.role_id WHERE r.is_admin = true AND a.active = true`)[0].n);
          if (admins <= 1) return json({ error: 'Cannot demote the last active admin.' }, 400);
        }
        const active = b.active === false ? false : true;
        if (cur.is_admin && !active) {
          const admins = Number((await q`SELECT count(*)::int AS n FROM app_auth a JOIN app_roles r ON r.id = a.role_id WHERE r.is_admin = true AND a.active = true AND a.id <> ${id}`)[0].n);
          if (admins < 1) return json({ error: 'Cannot deactivate the last active admin.' }, 400);
        }
        await q`UPDATE app_auth SET role_id = ${roleId}, active = ${active} WHERE id = ${id}`;
        const pw = String(b.password || '');
        if (pw) {
          if (pw.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400);
          const salt = crypto.randomBytes(16).toString('hex'), hash = await hashPw(pw, salt);
          await q`UPDATE app_auth SET salt = ${salt}, hash = ${hash} WHERE id = ${id}`;
        }
      } else {
        if (!/^[a-z0-9._-]{2,32}$/.test(username)) return json({ error: 'Username must be 2–32 letters, numbers, . _ or -' }, 400);
        const pw = String(b.password || '');
        if (pw.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400);
        if (await getUserByUsername(username)) return json({ error: 'That username is already taken.' }, 409);
        const salt = crypto.randomBytes(16).toString('hex'), hash = await hashPw(pw, salt);
        const id = await nextAuthId(q);
        await q`INSERT INTO app_auth (id, username, salt, hash, role_id, active)
          VALUES (${id}, ${username}, ${salt}, ${hash}, ${roleId}, true)`;
      }
      return json({ ok: true, users: await listUsers() });
    }

    if (action === 'delete-user') {
      const a = await requireAdmin(req);
      if (a.error) return a.error;
      const id = Number(b.id);
      if (!id) return json({ error: 'User id required' }, 400);
      if (id === a.session.id) return json({ error: 'You cannot delete your own account while signed in.' }, 400);
      const cur = await getUserById(id);
      if (!cur) return json({ error: 'User not found' }, 404);
      if (cur.is_admin) {
        const q = await sql();
        const admins = Number((await q`SELECT count(*)::int AS n FROM app_auth a JOIN app_roles r ON r.id = a.role_id WHERE r.is_admin = true AND a.active = true`)[0].n);
        if (admins <= 1) return json({ error: 'Cannot delete the last admin.' }, 400);
      }
      const q = await sql();
      await q`DELETE FROM app_auth WHERE id = ${id}`;
      return json({ ok: true, users: await listUsers() });
    }

    return json({ error: 'Not found' }, 404);
  } catch (e) { return json({ error: e.message }, 500); }
}
