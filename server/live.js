// The live back end on Vercel: one Runtime per server instance, connected to Supabase, OneSignal and Google's email relay.
// Settings (Vercel → jl-recruitment → Settings → Environment Variables; never in this public repo):
//   DATABASE_URL, DATABASE_PASSWORD   Supabase (shared project, schema `jl`)
//   RESEND_API_KEY, RESEND_EMAIL_DOMAIN  Resend (added from Vercel's marketplace, 19 Oct): sends every email, from any
//                                     address on a domain verified in Resend (linkmarketing.org.uk, jussmarketing.co.uk)
//   RELAY_URL, RELAY_SECRET           Apps Script web app: the backup sender (Gmail) when Resend can't (Code.gs relayMail)
//   ONESIGNAL_API_KEY                 phone alerts (the REST API key; the App ID is a normal setting)
//   CRON_SECRET                       Vercel sends it to /api/cron
//   REHEARSAL=1                       test copy: emails only to MAIL_ALLOW, no phone alerts
'use strict';
const path = require('path');
const { Runtime } = require('./runtime');
const { postgresAdapter } = require('./db');

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

/** Any outbox message as a Resend email (API shape). MailApp messages come from OWNER_EMAIL like before; Gmail ones from
 *  their own address (welcome emails: Jess / Rubal / Fiza, who get the bcc copy). */
function viaResend(m) {
  const g = m && m.via === 'mail' ? viaGmail(m) : m;
  if (!g || !g.to) return null;
  const o = g.opts || {}, list = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
  const from = o.from || process.env.OWNER_EMAIL || 'angad@linkmarketing.org.uk', name = String(o.name || 'Juss & Link Recruitment App').replace(/["<>]/g, '');
  const msg = { from: '"' + name + '" <' + from + '>', to: list(g.to), subject: g.subject || '' };
  if (o.htmlBody) msg.html = o.htmlBody;
  if (g.body) msg.text = g.body;
  if (o.cc) msg.cc = list(o.cc);
  if (o.bcc) msg.bcc = list(o.bcc);
  if (o.replyTo) msg.reply_to = list(o.replyTo);
  return msg;
}

/** Resend: the sender for every email (fast, and it passes the domains' DMARC: no more codes in Spam). Domains it may
 *  send from are the verified ones (checked every 10 minutes). Anything it refuses goes through Google instead. */
function resend() {
  const key = () => process.env.RESEND_API_KEY;
  let domains = null, domainsAt = 0;
  async function api(method, p, body) {
    const res = await fetch('https://api.resend.com' + p, { method, headers: { authorization: 'Bearer ' + key(), 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    let j = {}; try { j = JSON.parse(text); } catch (e) { /* not JSON */ }
    if (!res.ok) throw new Error('resend ' + res.status + ': ' + (j.message || text.slice(0, 160)));
    return j;
  }
  return {
    on: () => !!key(),
    /** Verified sending domains, e.g. ['linkmarketing.org.uk']. */
    async verified() {
      if (!key()) return [];
      if (!domains || Date.now() - domainsAt > 10 * 60000) {
        try { domains = ((await api('GET', '/domains')).data || []).filter(d => d.status === 'verified').map(d => String(d.name).toLowerCase()); }
        catch (e) { console.error('resend domains', e.message); domains = domains || []; }
        domainsAt = Date.now();
      }
      return domains;
    },
    send: msg => api('POST', '/emails', msg),
  };
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
  async function getInfo() {
    if (!info || Date.now() - infoAt > 10 * 60000) { info = await call('relayInfo'); infoAt = Date.now(); }
    return info;
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
  // Resend first; Google when Resend can't (its domain isn't verified yet, the daily limit, an outage)
  const RS = resend();
  async function send(m) {
    const r = viaResend(m), dom = r ? String(r.from.split('<').pop()).replace('>', '').split('@')[1] : '';
    if (r && RS.on() && (await RS.verified()).includes(dom)) {
      try { return await RS.send(r); } catch (e) { console.error('resend failed, Google instead:', e.message); }
    }
    return relayMail(m);
  }
  async function sendOne(id) {
    const row = (await db.sql`select payload, sent_at from jl.outbox where id = ${id}::bigint`)[0];
    if (!row || row.sent_at) return;
    try {
      if (allowed(row.payload)) await send(row.payload);
      await db.sql`update jl.outbox set sent_at = now(), tries = tries + 1, error = ${allowed(row.payload) ? null : 'rehearsal: not sent'} where id = ${id}::bigint`;
    } catch (e) {
      await db.sql`update jl.outbox set tries = tries + 1, error = ${String(e.message || e).slice(0, 500)} where id = ${id}::bigint`;
      throw e;
    }
  }
  return {
    call,
    quota: async () => { try { return (await getInfo()).quota; } catch (e) { console.error(e); return -1; } },
    /** Who the app can send as: Gmail's "send mail as" addresses, plus "*@domain" for each domain verified in Resend
     *  (any address there works, so welcome emails from Jess / Rubal / Fiza need no Gmail setup). */
    aliases: async () => {
      const [g, d] = await Promise.all([getInfo().then(i => i.aliases || [], e => { console.error(e); return []; }), RS.verified()]);
      return g.concat(d.map(x => '*@' + x));
    },
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

module.exports = { runtime, relay: () => RELAY, db: () => DB, TRIGGERS, REHEARSAL, _test: { viaGmail, viaResend, relay } };
