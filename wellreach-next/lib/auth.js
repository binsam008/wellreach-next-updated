import crypto from 'node:crypto';
import { sql } from './db.js';
import { normalizeTabs, canCallFn, canUseTab, TABS, ALL_TAB_IDS } from './perms.js';

export const SESSION_S = 12 * 3600;
export { TABS, ALL_TAB_IDS, canCallFn, canUseTab };

export const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error('AUTH_SECRET is not set (use at least 16 random characters).');
  return s;
}
const sign = s => crypto.createHmac('sha256', secret()).update(s).digest('base64url');
export const eq = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
export const hashPw = (pw, salt) => new Promise((ok, no) => crypto.scrypt(pw, salt, 64, (e, k) => (e ? no(e) : ok(k.toString('hex')))));

function rowToSession(row) {
  if (!row || row.active === false) return null;
  const isAdmin = !!row.is_admin;
  return {
    id: row.id,
    user: row.username,
    roleId: row.role_id,
    role: row.role_name,
    isAdmin,
    tabs: normalizeTabs(row.tabs, isAdmin),
  };
}

export async function countUsers() {
  const q = await sql();
  return Number((await q`SELECT count(*)::int AS n FROM app_auth`)[0]?.n || 0);
}

export async function getUserByUsername(username) {
  const q = await sql();
  const u = String(username || '').trim().toLowerCase();
  const rows = await q`
    SELECT a.id, a.username, a.salt, a.hash, a.active, a.role_id,
           r.name AS role_name, r.is_admin, r.tabs
    FROM app_auth a
    LEFT JOIN app_roles r ON r.id = a.role_id
    WHERE lower(a.username) = ${u}
    LIMIT 1`;
  return rows[0] || null;
}

export async function getUserById(id) {
  const q = await sql();
  const rows = await q`
    SELECT a.id, a.username, a.salt, a.hash, a.active, a.role_id,
           r.name AS role_name, r.is_admin, r.tabs
    FROM app_auth a
    LEFT JOIN app_roles r ON r.id = a.role_id
    WHERE a.id = ${id}
    LIMIT 1`;
  return rows[0] || null;
}

/** @deprecated single-user helper — prefer getUserByUsername / getSession */
export async function getAuth() {
  const q = await sql();
  const rows = await q`SELECT username, salt, hash FROM app_auth ORDER BY id LIMIT 1`;
  return rows[0] || null;
}

export function mkToken(userRow) {
  // exp.nonce.uid.sig — tied to password hash so resets invalidate sessions
  const b = (Date.now() + SESSION_S * 1000).toString(36) + '.' + crypto.randomBytes(8).toString('hex') + '.' + String(userRow.id);
  return b + '.' + sign(b + userRow.hash.slice(0, 16));
}

export function cookie(v, age, req) {
  const secure = process.env.NODE_ENV === 'production' || req.headers.get('x-forwarded-proto') === 'https';
  return `wrl_sid=${v}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure ? '; Secure' : ''}`;
}

export async function getSession(req) {
  const t = ((req.headers.get('cookie') || '').match(/(?:^|;\s*)wrl_sid=([^;]+)/) || [])[1];
  const p = String(t || '').split('.');
  if (p.length !== 4) return null;
  const exp = parseInt(p[0], 36);
  if (!(exp > Date.now())) return null;
  const uid = parseInt(p[2], 10);
  if (!uid) return null;
  const row = await getUserById(uid);
  if (!row || !row.active) return null;
  if (!eq(p[3], sign(p[0] + '.' + p[1] + '.' + p[2] + row.hash.slice(0, 16)))) return null;
  return rowToSession(row);
}

export async function isAuthed(req) {
  return !!(await getSession(req));
}

export async function requireAdmin(req) {
  const s = await getSession(req);
  if (!s) return { error: json({ error: 'Not signed in' }, 401) };
  if (!s.isAdmin) return { error: json({ error: 'Admin access required' }, 403) };
  return { session: s };
}

export async function listRoles() {
  const q = await sql();
  const rows = await q`SELECT id, name, is_admin, tabs, created FROM app_roles ORDER BY is_admin DESC, name`;
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    isAdmin: !!r.is_admin,
    tabs: normalizeTabs(r.tabs, !!r.is_admin),
    created: r.created,
  }));
}

export async function listUsers() {
  const q = await sql();
  const rows = await q`
    SELECT a.id, a.username, a.active, a.created, a.role_id,
           r.name AS role_name, r.is_admin
    FROM app_auth a
    LEFT JOIN app_roles r ON r.id = a.role_id
    ORDER BY a.id`;
  return rows.map(r => ({
    id: r.id,
    username: r.username,
    active: !!r.active,
    roleId: r.role_id,
    role: r.role_name,
    isAdmin: !!r.is_admin,
    created: r.created,
  }));
}

export async function nextAuthId(q) {
  return (await q`SELECT COALESCE(MAX(id),0)+1 AS n FROM app_auth`)[0].n;
}

export async function nextRoleId(q) {
  return (await q`SELECT COALESCE(MAX(id),0)+1 AS n FROM app_roles`)[0].n;
}

/* 5 wrong tries from one address = 15 minute pause (kept in the database, so it works across servers) */
const ipOf = req => (req.headers.get('x-real-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0] || 'unknown').trim();
export async function locked(req) {
  const q = await sql();
  return (await q`SELECT 1 FROM login_attempts WHERE ip = ${ipOf(req)} AND n >= 5 AND locked_until > now()`).length > 0;
}
export async function noteFail(req) {
  const q = await sql();
  await q`INSERT INTO login_attempts (ip, n, locked_until) VALUES (${ipOf(req)}, 1, now() + interval '15 minutes')
          ON CONFLICT (ip) DO UPDATE SET n = CASE WHEN login_attempts.locked_until > now() THEN login_attempts.n + 1 ELSE 1 END, locked_until = now() + interval '15 minutes'`;
}
export async function clearFails(req) {
  const q = await sql();
  await q`DELETE FROM login_attempts WHERE ip = ${ipOf(req)}`;
}
