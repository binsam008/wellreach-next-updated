// Runs one WRLCore function against the data stored in Neon.
// The whole company data set is one JSON document with a version number. A write only succeeds if the
// version is unchanged since it was read; otherwise the call is repeated on fresh data (no lost updates).
import WRLCore from '../public/core.js';
import { sql } from './db.js';

export async function run(fn, arg) {
  const q = await sql();
  for (let attempt = 0; attempt < 4; attempt++) {
    const [row] = await q`SELECT data, version FROM app_state WHERE id = 1`;
    const loaded = row.data && Object.keys(row.data).length ? row.data : null;
    const before = JSON.stringify(loaded);
    let latest = loaded;
    const core = WRLCore.create({ load: () => loaded, save: d => { latest = d; } });
    if (!Object.prototype.hasOwnProperty.call(core, fn)) throw new Error('Unknown function: ' + fn);
    const result = core[fn](arg);                                   // throws -> nothing is saved
    if (JSON.stringify(latest) === before) return result;          // read-only call: no write
    const done = await q`UPDATE app_state SET data = ${JSON.stringify(latest)}::jsonb, version = version + 1 WHERE id = 1 AND version = ${row.version} RETURNING version`;
    if (done.length) return result;
  }
  throw new Error('The data was changed by someone else at the same moment. Please try again.');
}
