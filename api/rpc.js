// The app's API on Vercel: the same { action, token, … } requests and answers as Google's /exec (Code.gs api()).
'use strict';
const { waitUntil } = require('@vercel/functions');
const { runtime, relay, REHEARSAL } = require('../server/live');

// Until switch day the live address answers nothing (the data here is a rehearsal copy); test copies (REHEARSAL) do.
let LIVE = false;
async function isLive(rt) {
  if (LIVE || REHEARSAL) return true;
  LIVE = (await rt.withDb(q => q("select 1 from jl.props where key = 'VERCEL_LIVE'"))).length > 0;
  return LIVE;
}

// The 08:30 pull from Hyrre posts from a hyrre.co.uk tab (scripts/hyrre-pull.js): that page may read the answer. Nothing else is
// let in: the post carries a one-time ticket (hyrreImport) and every other action still needs a login.
const HYRRE_ORIGIN = 'https://hyrre.co.uk';

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.headers.origin === HYRRE_ORIGIN) { res.setHeader('access-control-allow-origin', HYRRE_ORIGIN); res.setHeader('vary', 'origin'); }
  if (req.method === 'OPTIONS' && req.headers.origin === HYRRE_ORIGIN) {
    res.setHeader('access-control-allow-methods', 'POST');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.statusCode = 204; return res.end();
  }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only'); }
  let body = req.body;
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
  res.setHeader('content-type', 'application/json; charset=utf-8');
  const t0 = Date.now();
  try {
    const rt = await runtime();
    if (!(await isLive(rt))) return res.end(JSON.stringify({ ok: false, error: 'Not switched on yet.' }));
    // Answer first, then the emails (a login code: "Check your email" straight away, the email a moment later)
    const work = rt.run({ type: 'call', fn: 'api', args: [body], later: process.env.VERCEL ? waitUntil : null });
    // Never hang the phone: after 25 s it gets "Trying again…" (and retries by itself) instead of Vercel's 60 s timeout,
    // which the app showed as "No connection" (19 Oct). The job still finishes properly in the background.
    let timer;
    const out = await Promise.race([work, new Promise(r => { timer = setTimeout(() => r(null), 25000); })]);
    clearTimeout(timer);
    const ms = Date.now() - t0;
    // Where it was stuck (e.g. "api bundle for 25003ms: now connecting for 24990ms"); a finished slow job logs "slow job"
    if (ms > 5000) console.error('slow rpc', body.action, ms + 'ms', out ? '' : '(answered "trying again")', '|', rt.status());
    if (!out) {
      if (process.env.VERCEL) waitUntil(work.catch(e => console.error('rpc late', body.action, e)));
      return res.end(JSON.stringify({ ok: false, retry: true, error: 'Lots of people are sending at once. Trying again…' }));
    }
    // A background ask to Google started by this request (who can send as whom, today's quota): Vercel pauses the server
    // copy as soon as the answer goes, so it froze mid-way and came back "aborted due to timeout" (6 times, 19-20 Oct).
    // Keep the copy up until it's done; the phone already has its answer.
    const asking = process.env.VERCEL && relay() && relay().pending();
    if (asking) waitUntil(asking);
    res.end(JSON.stringify(out));
  } catch (e) {
    console.error('rpc', body.action, e);
    // The app retries these by itself, like when Google was busy
    res.end(JSON.stringify({ ok: false, retry: true, error: 'Lots of people are sending at once. Trying again…' }));
  }
};
