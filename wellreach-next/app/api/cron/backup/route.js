// Called daily by Vercel Cron (see vercel.json): keeps a dated copy of the data for 30 days.
import { sql } from '../../../../lib/db.js';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== 'Bearer ' + process.env.CRON_SECRET)
    return new Response('Unauthorized', { status: 401 });
  const q = await sql();
  await q`INSERT INTO app_backups (day, data) SELECT current_date, data FROM app_state WHERE id = 1 ON CONFLICT (day) DO UPDATE SET data = EXCLUDED.data`;
  await q`DELETE FROM app_backups WHERE day < current_date - 30`;
  return Response.json({ ok: true });
}
