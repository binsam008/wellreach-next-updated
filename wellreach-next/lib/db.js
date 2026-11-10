// Neon Postgres connection + one-time table creation (runs automatically on first request).
import { DEFAULT_STAFF_TABS, allTabsOn } from './perms.js';

let q, ready;

async function init(sql) {
  await sql`CREATE TABLE IF NOT EXISTS app_state (id int PRIMARY KEY, data jsonb NOT NULL, version int NOT NULL DEFAULT 0)`;
  await sql`INSERT INTO app_state (id, data) VALUES (1, '{}'::jsonb) ON CONFLICT (id) DO NOTHING`;
  await sql`CREATE TABLE IF NOT EXISTS app_auth (
    id int PRIMARY KEY,
    username text NOT NULL,
    salt text NOT NULL,
    hash text NOT NULL,
    created timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS login_attempts (ip text PRIMARY KEY, n int NOT NULL, locked_until timestamptz NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS app_backups (day date PRIMARY KEY, data jsonb NOT NULL)`;

  await sql`CREATE TABLE IF NOT EXISTS app_roles (
    id int PRIMARY KEY,
    name text NOT NULL UNIQUE,
    is_admin boolean NOT NULL DEFAULT false,
    tabs jsonb NOT NULL DEFAULT '{}'::jsonb,
    created timestamptz NOT NULL DEFAULT now()
  )`;

  // Multi-user columns on existing installs
  await sql`ALTER TABLE app_auth ADD COLUMN IF NOT EXISTS role_id int`;
  await sql`ALTER TABLE app_auth ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS app_auth_username_uq ON app_auth (lower(username))`;

  // Seed Admin + Staff roles
  const roles = await sql`SELECT id, name FROM app_roles ORDER BY id`;
  if (!roles.length) {
    await sql`INSERT INTO app_roles (id, name, is_admin, tabs) VALUES
      (1, 'Admin', true, ${allTabsOn()}),
      (2, 'Staff', false, ${DEFAULT_STAFF_TABS})
      ON CONFLICT (id) DO NOTHING`;
  } else {
    if (!roles.some(r => r.name === 'Admin')) {
      const next = Math.max(0, ...roles.map(r => r.id)) + 1;
      await sql`INSERT INTO app_roles (id, name, is_admin, tabs) VALUES (${next}, 'Admin', true, ${allTabsOn()}) ON CONFLICT (name) DO NOTHING`;
    }
    if (!roles.some(r => r.name === 'Staff')) {
      const next = (await sql`SELECT COALESCE(MAX(id),0)+1 AS n FROM app_roles`)[0].n;
      await sql`INSERT INTO app_roles (id, name, is_admin, tabs) VALUES (${next}, 'Staff', false, ${DEFAULT_STAFF_TABS}) ON CONFLICT (name) DO NOTHING`;
    }
  }

  // Existing single user → Admin
  const adminRole = (await sql`SELECT id FROM app_roles WHERE is_admin = true ORDER BY id LIMIT 1`)[0];
  if (adminRole) {
    await sql`UPDATE app_auth SET role_id = ${adminRole.id} WHERE role_id IS NULL`;
  }
}

export async function sql() {
  if (globalThis.__WRL_SQL) return globalThis.__WRL_SQL;            // used only by the offline test harness
  if (!q) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
    const { neon } = await import('@neondatabase/serverless');
    q = neon(process.env.DATABASE_URL);
  }
  if (!ready) ready = init(q).catch(e => { ready = null; throw e; });
  await ready;
  return q;
}
