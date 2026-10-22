// The live back end on Vercel: one Runtime per server instance, connected to Supabase, OneSignal and Google's email relay.
// Settings (Vercel → jl-recruitment → Settings → Environment Variables; never in this public repo):
//   DATABASE_URL, DATABASE_PASSWORD   Supabase (shared project, schema `jl`)
//   RELAY_URL, RELAY_SECRET           Apps Script web app that sends the emails from Gmail (Code.gs relayMail)
//   ONESIGNAL_API_KEY                 phone alerts (the REST API key; the App ID is a normal setting)
//   CRON_SECRET                       Vercel sends it to /api/cron
//   REHEARSAL=1                       test copy: emails only to MAIL_ALLOW, no phone alerts
'use strict';
const path = require('path');
const { Runtime } = require('./runtime');
const { postgresAdapter } = require('./db');
const { emailSafe } = require('./email');

const TRIGGERS = ['weeklyProgressEmails', 'saturdayDeadlineEmails', 'mondayPayReportEmail', 'dailyMaintenance', 'keepWarm'];
const REHEARSAL = process.env.REHEARSAL === '1';
const MAIL_ALLOW = String(process.env.MAIL_ALLOW || 'angad@linkmarketing.org.uk').toLowerCase().split(/[,\s]+/).filter(Boolean);

let RT, DB, RELAY;

/** UrlFetchApp: real HTTP. In a rehearsal, phone alerts are not sent (looking people up still works). */
async function http(reqs) {
  return Promise.all(reqs.map(async r => {
    const method = String(r.method || 'get').toUpperCase();
    if (REHEARSAL && method === 'POST' && /onesignal\.com\/.*notifications/.test(r.url)) return { code: 200, text: '{"id":"rehearsal-not-sent"}' };
    const headers = Object.assign({}, r.headers || {});
    if (r.contentType) headers['content-type'] = r.contentType;
    const body = r.payload === undefined || method === 'GET' ? undefined : typeof r.payload === 'string' ? r.payload : new URLSearchParams(r.payload).toString();
    try {
      const res = await fetch(r.url, { method, headers, body, signal: AbortSignal.timeout(20000) });
      return { code: res.status, text: await res.text() };
    } catch (e) {
      return { code: 599, text: String(e.message || e) };
    }
  }));
}

/** A MailApp message ({ via: 'mail', msg }) as a Gmail one ({ via: 'gmail', to, subject, body, opts }); null if it isn't one. */
function viaGmail(m) {
  if (!m || m.via !== 'mail' || !m.msg || !m.msg.to) return null;
  const x = m.msg, opts = {};
  ['htmlBody', 'name', 'cc', 'bcc', 'replyTo', 'noReply'].forEach(k => { if (x[k] !== undefined && x[k] !== '') opts[k] = x[k]; });
  const text = x.body || String(x.htmlBody || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|li|tr)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim();
  return { via: 'gmail', to: x.to, subject: x.subject || '', body: text, opts };
}

/** Google sends the emails (same Gmail, same "send mail as" addresses); asked through Code.gs's relay. */
function relay(db) {
  let info = null, infoAt = 0;
  async function call(action, extra) {
    if (!process.env.RELAY_URL || !process.env.RELAY_SECRET) throw new Error('Email relay not set up (RELAY_URL / RELAY_SECRET)');
    const res = await fetch(process.env.RELAY_URL, { method: 'POST', headers: { 'content-type': 'text/plain' },
      body: JSON.stringify(Object.assign({ action, secret: process.env.RELAY_SECRET }, extra || {})), signal: AbortSignal.timeout(60000) });
    const text = await res.text();
    let j; try { j = JSON.parse(text); } catch (e) { throw new Error('relay ' + action + ': ' + res.status + ' ' + text.slice(0, 120)); }
    if (!j.ok) throw new Error('relay ' + action + ': ' + j.error);
    return j.data;
  }
  // Asked from inside a job (opening the app, as an admin), so Google is never waited on for long: what we last knew,
  // refreshed in the background every 10 minutes; at most 3 s the first time (19 Oct: a slow Google held every request
  // queued behind it)
  // Google often takes 4–15 s, so a fresh server had no answer within the 3 s and said "no Send mail as addresses":
  // Jess was told "Can't send as jess@…" though hers was set up (22 Oct). Every answer Google gives is now kept
  // (jl.props SEND_AS_LAST, even one that arrives after the 3 s), and while there's no answer yet, the last one is used.
  const LAST = 'SEND_AS_LAST';
  async function keepAliases(a) {
    if (!Array.isArray(a)) return;
    try { await db.sql`insert into jl.props (key, val) values (${LAST}, ${JSON.stringify(a)}) on conflict (key) do update set val = excluded.val`; } catch (e) { console.error('keep aliases', e.message); }
  }
  async function lastAliases() {
    try { const r = (await db.sql`select val from jl.props where key = ${LAST}`)[0]; return r ? JSON.parse(r.val) : []; } catch (e) { console.error('last aliases', e.message); return []; }
  }
  let infoAsk = null;
  function refreshInfo() {
    if (!infoAsk && (!info || Date.now() - infoAt > 10 * 60000)) {
      infoAsk = call('relayInfo').then(i => { if (!i) return; info = i; infoAt = Date.now(); return keepAliases(i.aliases); }, e => console.error('relayInfo', e.message)).finally(() => { infoAsk = null; });
    }
    return infoAsk;
  }
  async function getInfo() {
    const asking = refreshInfo();
    if (!info && asking) await Promise.race([asking, new Promise(r => setTimeout(r, 3000))]);
    return info || { quota: -1, aliases: await lastAliases() };
  }
  const allowed = m => {
    if (!REHEARSAL) return true;
    const to = (m.via === 'mail' ? [m.msg && m.msg.to, m.msg && m.msg.bcc, m.msg && m.msg.cc] : [m.to, m.opts && m.opts.bcc, m.opts && m.opts.cc]).join(',').toLowerCase();
    return to.split(/[,\s]+/).filter(Boolean).every(a => MAIL_ALLOW.includes(a));
  };
  // MailApp's emails fail linkmarketing.org.uk's DMARC check (they leave through Google's own bounce address, not the
  // domain's), and the domain says "quarantine" → Spam, so login codes "took forever" (19 Oct). Gmail itself (GmailApp)
  // sends as the person and passes. Until Google has been given Gmail permission it refuses; then it's MailApp as before
  // (the Gmail route is tried again every 10 minutes, so it starts by itself once allowed).
  let gmailBlockedUntil = 0;
  async function relayMail(m) {
    m = emailSafe(m);  // emojis written so Google can't garble them (server/email.js)
    const g = viaGmail(m);
    if (g && Date.now() >= gmailBlockedUntil) {
      try { return await call('relayMail', { mail: g }); } catch (e) {
        if (!/permission/i.test(String(e.message))) throw e;
        gmailBlockedUntil = Date.now() + 10 * 60000;
        console.error('Gmail route not allowed yet, MailApp instead');
      }
    }
    return call('relayMail', { mail: m });
  }
  async function sendOne(id) {
    const row = (await db.sql`select payload, sent_at from jl.outbox where id = ${id}::bigint`)[0];
    if (!row || row.sent_at) return;
    try {
      if (allowed(row.payload)) await relayMail(row.payload);
      await db.sql`update jl.outbox set sent_at = now(), tries = tries + 1, error = ${allowed(row.payload) ? null : 'rehearsal: not sent'} where id = ${id}::bigint`;
    } catch (e) {
      await db.sql`update jl.outbox set tries = tries + 1, error = ${String(e.message || e).slice(0, 500)} where id = ${id}::bigint`;
      throw e;
    }
  }
  return {
    call,
    /** The background ask to Google still running, if any (api/rpc.js keeps the server copy up until it's done). */
    pending: () => infoAsk,
    quota: async () => { try { return (await getInfo()).quota; } catch (e) { console.error(e); return -1; } },
    aliases: async () => { try { return (await getInfo()).aliases; } catch (e) { console.error(e); return []; } },
    /** An answer from Google asked elsewhere (the 5-minute timer): used here and kept for slow moments. */
    remember: i => { if (!i) return null; info = i; infoAt = Date.now(); return keepAliases(i.aliases); },
    /** Send these outbox rows, 4 at a time. */
    async deliver(ids) {
      const queue = ids.slice(), errors = [];
      await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (queue.length) { const id = queue.shift(); await sendOne(id).catch(e => errors.push(e)); }
      }));
      if (errors.length) throw errors[0];
    },
    /** Timer: try again any email that failed in the last day (up to 5 tries). */
    async retry() {
      const ids = (await db.sql`select id::text as id from jl.outbox where sent_at is null and tries < 5 and created_at > now() - interval '1 day' order by id limit 50`).map(r => r.id);
      if (ids.length) await this.deliver(ids).catch(e => console.error('mail retry', e));
      return ids.length;
    },
  };
}

let STARTING;
function runtime() { return RT ? Promise.resolve(RT) : (STARTING = STARTING || start().catch(e => { STARTING = null; throw e; })); }
async function start() {
  DB = postgresAdapter({ url: process.env.DATABASE_URL, password: process.env.DATABASE_PASSWORD });
  RELAY = relay(DB);
  // The phone-alert key lives in Google's Script Properties; Google hands it over (nobody copies it). Asked in the
  // background: waking up never waits for Google (19 Oct: that was 3–5 s of every wake-up, so of some login codes).
  // Only a phone alert waits for it, the first time. A failed ask is asked again next time.
  let keyAsk = null;
  const alertKey = () => keyAsk || (keyAsk = process.env.ONESIGNAL_API_KEY ? Promise.resolve(process.env.ONESIGNAL_API_KEY)
    : RELAY.call('relayInfo', { withKeys: true }).then(i => i.onesignalKey || '', e => { console.error('no alert key yet', e.message); keyAsk = null; return ''; }));
  alertKey();
  await DB.migrate();
  const rt = new Runtime({
    db: DB, http, mail: RELAY, secret: k => (k === 'ONESIGNAL_API_KEY' ? alertKey() : ''),
    codePath: path.join(__dirname, '..', 'app', 'src', 'Code.gs'),
    env: { PUBLIC_URL: process.env.PUBLIC_URL || '', OWNER_EMAIL: process.env.OWNER_EMAIL || 'angad@linkmarketing.org.uk', TRIGGERS },
  });
  await rt.start();
  return (RT = rt);
}

module.exports = { runtime, relay: () => RELAY, db: () => DB, TRIGGERS, REHEARSAL, _test: { viaGmail, relay } };
