// The live copy for the team (19 Oct): every tab of the app's data (Supabase, schema jl) written into the Google
// Sheet the app used before the move, so the Sheet shows today's people again. One way only: the app's data stays in
// Supabase; the Sheet is a read-only view. A tab is only sent when it changed since the last copy. Never the login tabs.
//
// 11 Nov: a Sheet cell holds 50,000 characters, and a starter's photo is up to 140,000. From the first Day 1 photo taken on
// the phone (2 Nov) the StarterPhotos tab was refused by Google every 5 minutes, and because the copy stopped at the first
// tab that failed, Users (next in the alphabet) was never copied again: the Sheet's team list stood still for 9 days.
// Now a picture is written as a short note (it's in the app), anything else too long for a cell is cut with a note, and a
// tab that fails is reported and skipped, never in the way of the others.
'use strict';
const crypto = require('crypto');

const SKIP = ['Sessions', 'Codes'];
const CELL_MAX = 50000;  // Google Sheets' limit for one cell
const PICTURE = '(picture: in the app)', CUT = ' … (cut: too long for a Sheet cell, the rest is in the app)';

/** A value as the Sheet can hold it. */
function fit(v) {
  if (typeof v !== 'string') return v;
  if (v.length > 200 && /^data:[a-z]+\/[a-z0-9.+-]+;base64,/i.test(v)) return PICTURE;
  return v.length > CELL_MAX ? v.slice(0, CELL_MAX - CUT.length) + CUT : v;
}

/**
 * @param {function} sql   postgres-js tagged template (live) — reads jl.tabs / jl.rows, keeps a fingerprint per tab in jl.props
 * @param {function} relay async (action, extra) → data: the Google relay (Code.gs relayMirror)
 * @param {object} [o]     { force: true } sends every tab even if unchanged
 * @returns {Promise<object[]>} what was sent: [{ tab, rows }], and [{ tab, error }] for a tab Google refused
 */
async function mirrorToSheet(sql, relay, o) {
  const tabs = await sql`select name, headers from jl.tabs order by name`;
  const sent = [];
  for (const t of tabs) {
    if (SKIP.includes(t.name)) continue;
    try {
      const rows = (await sql`select vals from jl.rows where tab = ${t.name} order by pos`).map(r => (Array.isArray(r.vals) ? r.vals.map(fit) : r.vals));
      const hash = crypto.createHash('sha1').update(JSON.stringify([t.headers, rows])).digest('hex');
      const key = 'MIRROR_HASH_' + t.name;
      const was = (await sql`select val from jl.props where key = ${key}`)[0];
      if (!(o && o.force) && was && was.val === hash) continue;
      await relay('relayMirror', { tab: t.name, headers: t.headers, rows });
      await sql`insert into jl.props (key, val) values (${key}, ${hash}) on conflict (key) do update set val = excluded.val`;
      sent.push({ tab: t.name, rows: rows.length });
    } catch (e) {
      console.error('mirror', t.name, e);
      sent.push({ tab: t.name, error: String((e && e.message) || e).slice(0, 200) });
    }
  }
  return sent;
}

module.exports = { mirrorToSheet, SKIP, fit, CELL_MAX };
