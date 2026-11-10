// POST /api/<function>  -> same contract the app already uses: { arg } in, { ok, result | error } out.
import { json, getSession, canCallFn } from '../../../lib/auth.js';
import { run } from '../../../lib/store.js';
export const dynamic = 'force-dynamic';

export async function POST(req, { params }) {
  const { fn } = await params;
  if (!/json/.test(req.headers.get('content-type') || '')) return json({ ok: false, error: 'JSON required' }, 415);
  if (fn === 'ping') return json({ ok: true, result: 'pong' });
  try {
    const session = await getSession(req);
    if (!session) return json({ ok: false, auth: true, error: 'Session expired — please sign in again.' }, 401);
    if (!canCallFn(session, fn)) {
      return json({ ok: false, error: 'You do not have access to this feature.' }, 403);
    }
    let b = {}; try { b = await req.json(); } catch (e) { b = {}; }
    return json({ ok: true, result: await run(fn, b.arg === null ? undefined : b.arg) });
  } catch (e) {
    return json({ ok: false, error: e.message });
  }
}
