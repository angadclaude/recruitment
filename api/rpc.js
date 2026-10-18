// The app's API on Vercel: the same { action, token, … } requests and answers as Google's /exec (Code.gs api()).
'use strict';
const { runtime, REHEARSAL } = require('../server/live');

// Until switch day the live address answers nothing (the data here is a rehearsal copy); test copies (REHEARSAL) do.
let LIVE = false;
async function isLive(rt) {
  if (LIVE || REHEARSAL) return true;
  LIVE = (await rt.withDb(q => q("select 1 from jl.props where key = 'VERCEL_LIVE'"))).length > 0;
  return LIVE;
}

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only'); }
  let body = req.body;
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
  res.setHeader('content-type', 'application/json; charset=utf-8');
  try {
    const rt = await runtime();
    if (!(await isLive(rt))) return res.end(JSON.stringify({ ok: false, error: 'Not switched on yet.' }));
    const out = await rt.call('api', body);
    res.end(JSON.stringify(out));
  } catch (e) {
    console.error('rpc', body.action, e);
    // The app retries these by itself, like when Google was busy
    res.end(JSON.stringify({ ok: false, retry: true, error: 'Lots of people are sending at once. Trying again…' }));
  }
};
