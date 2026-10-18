// The app's API on Vercel: the same { action, token, … } requests and answers as Google's /exec (Code.gs api()).
'use strict';
const { runtime } = require('../server/live');

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only'); }
  let body = req.body;
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
  res.setHeader('content-type', 'application/json; charset=utf-8');
  try {
    const out = await (await runtime()).call('api', body);
    res.end(JSON.stringify(out));
  } catch (e) {
    console.error('rpc', body.action, e);
    // The app retries these by itself, like when Google was busy
    res.end(JSON.stringify({ ok: false, retry: true, error: 'Lots of people are sending at once. Trying again…' }));
  }
};
