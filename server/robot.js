// The office robot's web addresses (api/robot.js on Vercel, and the dev server in tests), all handed to Code.gs:
//   ?h=tick    every minute (Vercel Cron, with CRON_SECRET): Teamtailor, calls due, reminders, no-shows
//   ?h=voice   ElevenLabs: a call's result (signed: ElevenLabs-Signature)
//   ?h=init    ElevenLabs: someone is ringing the robot's number, who is it? (X-Robot-Key)
//   ?h=msg     Twilio: a WhatsApp or text to the robot's number (signed: X-Twilio-Signature)
//   ?h=status  Twilio: a message bounced (signed)
// Code.gs checks every signature against the raw body, so this file only reads the request and answers fast:
// Twilio and ElevenLabs get their "OK" at once and the work carries on after (Vercel's waitUntil).
'use strict';

async function rawBody(req) {
  if (typeof req.rawBody === 'string') return req.rawBody;
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * @param {object} o
 * @param {function} o.call    async (fn, ...args) → Code.gs result
 * @param {function} [o.later] keeps the server copy running until a promise is done (Vercel waitUntil)
 * @param {string}   o.base    the app's public address as Twilio / ElevenLabs call it, e.g. https://jl-recruitment.vercel.app
 * @param {string}   [o.cronSecret]
 * @param {function} [o.live]  async () → is the app switched on here (jl.props VERCEL_LIVE)
 */
async function robotRequest(req, res, o) {
  const u = new URL(req.url, o.base);
  const h = u.searchParams.get('h') || '';
  const send = (code, body, type) => { res.statusCode = code; res.setHeader('content-type', type || 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(body); };
  try {
    if (h === 'tick') {
      if (o.cronSecret && req.headers.authorization !== 'Bearer ' + o.cronSecret) return send(401, '{"error":"no"}');
      if (o.live && !(await o.live())) return send(200, '{"off":"not live"}');
      return send(200, JSON.stringify(await o.call('robotTick')));
    }
    if (req.method !== 'POST') return send(405, '{"error":"POST only"}');
    const raw = await rawBody(req);
    const sig = String(req.headers['x-twilio-signature'] || req.headers['elevenlabs-signature'] || req.headers['x-robot-key'] || '');
    const q = { h, url: o.base.replace(/\/$/, '') + req.url, raw, sig, query: Object.fromEntries(u.searchParams) };
    if (h === 'init') {
      // ElevenLabs waits for this one before the call starts: answer as fast as possible
      const r = await o.call('robotHook', q);
      if (r.status !== 200) return send(r.status, '{"error":"no"}');
      return send(200, JSON.stringify(r.json));
    }
    if (['voice', 'msg', 'status'].indexOf(h) < 0) return send(404, '{"error":"unknown"}');
    const work = o.call('robotHook', q).then(r => { if (r && r.status !== 200) console.error('robot hook refused', h, r.status); return r; },
      e => { console.error('robot hook', h, e); return { status: 500 }; });
    if (o.later) o.later(work); else await work;
    // Twilio expects TwiML back; ElevenLabs only needs a 200
    return h === 'voice' ? send(200, '{"ok":true}') : send(200, '<Response></Response>', 'text/xml');
  } catch (e) {
    console.error('robot', h, e);
    return send(500, '{"error":"failed"}');
  }
}

module.exports = { robotRequest, rawBody };
