// The live copy for the team (19 Oct): every tab of the app's data (Supabase, schema jl) written into the Google
// Sheet the app used before the move, so the Sheet shows today's people again. One way only: the app's data stays in
// Supabase; the Sheet is a read-only view. A tab is only sent when it changed since the last copy. Never the login tabs.
'use strict';
const crypto = require('crypto');

const SKIP = ['Sessions', 'Codes'];

/**
 * @param {function} sql   postgres-js tagged template (live) — reads jl.tabs / jl.rows, keeps a fingerprint per tab in jl.props
 * @param {function} relay async (action, extra) → data: the Google relay (Code.gs relayMirror)
 * @param {object} [o]     { force: true } sends every tab even if unchanged
 * @returns {Promise<object[]>} what was sent: [{ tab, rows }]
 */
async function mirrorToSheet(sql, relay, o) {
  const tabs = await sql`select name, headers from jl.tabs order by name`;
  const sent = [];
  for (const t of tabs) {
    if (SKIP.includes(t.name)) continue;
    const rows = (await sql`select vals from jl.rows where tab = ${t.name} order by pos`).map(r => r.vals);
    const hash = crypto.createHash('sha1').update(JSON.stringify([t.headers, rows])).digest('hex');
    const key = 'MIRROR_HASH_' + t.name;
    const was = (await sql`select val from jl.props where key = ${key}`)[0];
    if (!(o && o.force) && was && was.val === hash) continue;
    await relay('relayMirror', { tab: t.name, headers: t.headers, rows });
    await sql`insert into jl.props (key, val) values (${key}, ${hash}) on conflict (key) do update set val = excluded.val`;
    sent.push({ tab: t.name, rows: rows.length });
  }
  return sent;
}

module.exports = { mirrorToSheet, SKIP };
