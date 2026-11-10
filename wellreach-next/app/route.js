// "/" -> the app for a signed-in user, the login / first-logon page for everyone else.
import { isAuthed } from '../lib/auth.js';
import { APP_HTML, LOGIN_HTML } from '../lib/pages.js';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  let ok = false;
  try { ok = await isAuthed(req); } catch (e) { ok = false; }
  return new Response(ok ? APP_HTML : LOGIN_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
