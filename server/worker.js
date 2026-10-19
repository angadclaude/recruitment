// Runs the real app/src/Code.gs (the same file Google Apps Script runs) in a worker thread, with the Google services
// it uses rebuilt on Supabase / Postgres. Code.gs is synchronous, the database is not: every database call goes to
// the main thread (runtime.js) and this thread waits for the answer (Atomics), so Code.gs runs unchanged.
// Tabs of the old Google Sheet = jl.tabs + jl.rows; CacheService = jl.cache; PropertiesService = jl.props.
'use strict';
const { workerData, parentPort, receiveMessageOnPort } = require('worker_threads');
const vm = require('vm');
const fs = require('fs');
const crypto = require('crypto');

const { sab, ioPort, codePath, env, testMode } = workerData;
const flag = new Int32Array(sab);

/** One synchronous call to the main thread (database, HTTP, email). */
function io(op, ...args) {
  Atomics.store(flag, 0, 0);
  ioPort.postMessage({ op, args });
  const until = Date.now() + 120000;
  while (Atomics.load(flag, 0) === 0) {
    if (Atomics.wait(flag, 0, 0, 1000) === 'timed-out' && Date.now() > until) throw new Error('Service error: no answer from the database');
  }
  const m = receiveMessageOnPort(ioPort);
  if (!m) throw new Error('Service error: lost the database answer');
  if (m.message.error) { const e = new Error(m.message.error); e.retry = !!m.message.retry; throw e; }
  return m.message.value;
}
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms)); }
const str = v => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : String(v));

// ───── Sheets (one tab = one jl.tabs row + its jl.rows, in order) ─────
let LOADED = {};  // tabs read during this job; dropped when the lock is taken or released (others may have written)
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sh.rowVals(this.r - 1 + i) || [];
      const o = [];
      for (let j = 0; j < this.nc; j++) o.push(row[this.c - 1 + j] === undefined ? '' : row[this.c - 1 + j]);
      out.push(o);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(v) { this.sh.write(this.r, this.c, v); return this; }
  setValue(x) { return this.setValues([[x]]); }
  clearContent() { return this.setValues(Array.from({ length: this.nr }, () => Array(this.nc).fill(''))); }
  setFontWeight() { return this; }
  setNumberFormat() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setWrap() { return this; }
}
class Sheet {
  constructor(name, snap) {
    this.name = name;
    this.headers = (snap.headers || []).map(str);
    this.rows = (snap.rows || []).map(r => ({ rid: r.rid, vals: (r.vals || []).map(str) }));
    this.maxRows = snap.max_rows || 1000;
    this.maxCols = snap.max_cols || 26;
    this.mark();
  }
  /** Remember what was saved, so edits made straight to `data` (tests only) are saved by flush(). */
  mark(rows) { if (!rows) this.headSnap = JSON.stringify(this.headers); (rows || this.rows).forEach(x => { x.snap = JSON.stringify(x.vals); }); }
  flush() {
    if (JSON.stringify(this.headers) !== this.headSnap) { io('tab.headers', this.name, this.headers); this.headSnap = JSON.stringify(this.headers); }
    this.save(this.rows.filter(x => x.snap !== JSON.stringify(x.vals)));
  }
  /** The whole tab as one array of rows (row 0 = headers), like the in-memory fake; tests read and edit it. */
  get data() { return [this.headers].concat(this.rows.map(x => x.vals)); }
  set data(v) {
    const old = this.rows.filter(x => x.rid).map(x => x.rid);
    if (old.length) io('rows.delete', this.name, old);
    this.headers = (v[0] || []).map(str);
    io('tab.headers', this.name, this.headers);
    this.headSnap = JSON.stringify(this.headers);
    this.rows = v.slice(1).map(r => ({ rid: null, vals: r.slice() }));
    if (this.rows.length + 1 > this.maxRows) { this.maxRows = this.rows.length + 1; io('tab.max', this.name, this.maxRows, this.maxCols); }
    this.save(this.rows);
  }
  get length() { return this.rows.length + 1; }  // + the header row
  rowVals(ri) { return ri === 0 ? this.headers : this.rows[ri - 1] ? this.rows[ri - 1].vals : undefined; }
  /** Write a block of values at (row r, column c), 1-based like Sheets. New rows are inserted in order. */
  write(r, c, values) {
    const changed = new Map();
    values.forEach((vals, i) => {
      const ri = r - 1 + i;
      if (ri === 0) {
        vals.forEach((v, j) => { this.headers[c - 1 + j] = str(v); });
        for (let k = 0; k < this.headers.length; k++) if (this.headers[k] === undefined) this.headers[k] = '';
        io('tab.headers', this.name, this.headers);
        this.headSnap = JSON.stringify(this.headers);
        return;
      }
      while (this.rows.length < ri) { const blank = { rid: null, vals: [] }; this.rows.push(blank); changed.set(blank, true); }
      const row = this.rows[ri - 1];
      vals.forEach((v, j) => { row.vals[c - 1 + j] = v === null || v === undefined ? '' : v; });  // as given (a Date stays a Date) until the next request; stored as text
      for (let k = 0; k < row.vals.length; k++) if (row.vals[k] === undefined) row.vals[k] = '';
      changed.set(row, true);
    });
    this.save([...changed.keys()]);
  }
  save(rows) {
    if (!rows.length) return;
    const rids = io('rows.write', this.name, rows.map(x => ({ rid: x.rid, vals: x.vals.map(str) })));
    rows.forEach((x, i) => { x.rid = rids[i]; });
    this.mark(rows);
  }
  getDataRange() {
    const nc = Math.max(1, this.headers.length, ...this.rows.map(r => r.vals.length));
    return new Range(this, 1, 1, Math.max(1, this.length), nc);
  }
  getLastRow() {
    let n = this.length;
    while (n > 0 && (this.rowVals(n - 1) || []).every(v => v === '' || v === undefined)) n--;
    return n;
  }
  getLastColumn() {
    const used = r => { let n = r.length; while (n > 0 && (r[n - 1] === '' || r[n - 1] === undefined)) n--; return n; };
    return Math.max(0, used(this.headers), ...this.rows.map(r => used(r.vals)));
  }
  appendRow(vals) {
    const r = this.getLastRow();  // 0-based index of the first empty row
    if (r === 0) { this.write(1, 1, [vals]); return this; }
    this.write(r + 1, 1, [vals]);
    if (r + 1 > this.maxRows) { this.maxRows = r + 1; io('tab.max', this.name, this.maxRows, this.maxCols); }
    return this;
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertColumnsAfter(after, n) { this.maxCols += n; io('tab.max', this.name, this.maxRows, this.maxCols); }
  insertRowsAfter(after, n) { this.maxRows += n; io('tab.max', this.name, this.maxRows, this.maxCols); }
  getRange(r, c, nr, nc) {
    if (r + (nr || 1) - 1 > this.maxRows || c + (nc || 1) - 1 > this.maxCols) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    return new Range(this, r, c, nr || 1, nc || 1);
  }
  deleteRows(r, n) {
    if (r < 2) throw new Error('The header row cannot be deleted.');
    const gone = this.rows.splice(r - 2, n).filter(x => x.rid);
    if (gone.length) io('rows.delete', this.name, gone.map(x => x.rid));
  }
  deleteRow(r) { this.deleteRows(r, 1); }
  setFrozenRows() {}
  getName() { return this.name; }
}
function flushAll() { Object.values(LOADED).forEach(s => s && s.flush()); }
function tab(name) {
  if (Object.prototype.hasOwnProperty.call(LOADED, name)) return LOADED[name];
  const snap = io('tab.load', name);
  return (LOADED[name] = snap ? new Sheet(name, snap) : null);
}
const book = {
  getId: () => 'supabase:jl',
  getSheetByName: n => tab(n),
  insertSheet: n => { io('tab.create', n); delete LOADED[n]; return tab(n); },
  getSheets: () => io('tab.list').map(tab).filter(Boolean),
  deleteSheet: s => { io('tab.drop', s.name); delete LOADED[s.name]; },
};

// ───── The rest of the Google services Code.gs uses ─────
const ENV_PROPS = ['ONESIGNAL_API_KEY'];  // secrets live in Vercel's settings, never in the database
function fmtDate(d, tz, f) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).reduce((a, p) => (a[p.type] = p.value, a), {});
  return f.replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day).replace('HH', parts.hour).replace('mm', parts.minute);
}
const response = r => ({ getResponseCode: () => r.code, getContentText: () => r.text });

const ctx = {
  console,
  SpreadsheetApp: { getActive: () => book, openById: () => book, flush: () => {} },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (!testMode && ENV_PROPS.includes(k) ? (env[k] || null) : io('props.get', k)),
    setProperty: (k, v) => { io('props.set', k, String(v)); },
    setProperties: o => { Object.keys(o).forEach(k => io('props.set', k, String(o[k]))); },
    deleteProperty: k => { io('props.delete', k); },
    getProperties: () => io('props.all'),
  }) },
  CacheService: { getScriptCache: () => ({
    get: k => io('cache.get', k),
    put: (k, v, s) => { io('cache.put', k, String(v), s || 600); },
    remove: k => { io('cache.remove', k); },
    removeAll: ks => { (ks || []).forEach(k => io('cache.remove', k)); },
  }) },
  // The lock is a Postgres advisory lock held until this job's transaction commits (releaseLock commits early).
  // Tests: globalThis.__lockBusy = N → the next N attempts fail, like a queue of people sending at once.
  LockService: { getScriptLock: () => ({
    tryLock(ms) { if (ctx.__lockBusy > 0) { ctx.__lockBusy--; return false; } flushAll(); const ok = io('lock', ms || 0); if (ok) LOADED = {}; return ok; },
    waitLock(ms) { if (!this.tryLock(ms || 30000)) throw new Error('Lock timeout: another process was holding the lock for too long.'); },
    releaseLock() { flushAll(); io('unlock'); LOADED = {}; },
    hasLock: () => true,
  }) },
  Utilities: {
    formatDate: fmtDate,
    sleep,
    getUuid: () => crypto.randomUUID(),
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (alg, s) => Array.from(crypto.createHash(alg).update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
  },
  MailApp: {
    sendEmail: o => { io('mail.send', { via: 'mail', msg: o }); },
    getRemainingDailyQuota: () => io('mail.quota'),
  },
  GmailApp: {
    getAliases: () => (testMode ? ctx.__sendAs || [] : io('mail.aliases')),
    sendEmail: (to, subject, body, o) => { io('mail.send', { via: 'gmail', to, subject, body, opts: o || {} }); },
  },
  UrlFetchApp: {
    fetch: (url, o) => ctx.UrlFetchApp.fetchAll([Object.assign({ url }, o || {})])[0],
    fetchAll: reqs => {
      const out = testMode ? reqs.map(fakeFetch) : io('http', reqs.map(r => ({ url: r.url, method: r.method, headers: r.headers, payload: r.payload, contentType: r.contentType })));
      return out.map((r, i) => {
        if (r.code >= 400 && !reqs[i].muteHttpExceptions) throw new Error('Request failed for ' + reqs[i].url + ' returned code ' + r.code + '. Truncated server response: ' + String(r.text).slice(0, 200));
        return response(r);
      });
    },
  },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType: () => t }) },
  ScriptApp: {
    getService: () => ({ getUrl: () => env.PUBLIC_URL || '' }),
    // Vercel Cron runs these (vercel.json); the Alerts check lists them as "scheduled alerts running"
    getProjectTriggers: () => (testMode ? ctx.__triggers : (env.TRIGGERS || [])).map(fn => ({ fn, getHandlerFunction: () => fn })),
    deleteTrigger: () => {},
    WeekDay: { MONDAY: 'MON', TUESDAY: 'TUE', WEDNESDAY: 'WED', THURSDAY: 'THU', FRIDAY: 'FRI', SATURDAY: 'SAT', SUNDAY: 'SUN' },
    newTrigger: fn => { const ch = { timeBased: () => ch, onWeekDay: () => ch, atHour: () => ch, everyDays: () => ch, everyMinutes: () => ch, everyHours: () => ch, inTimezone: () => ch, create: () => { if (testMode && !ctx.__triggers.includes(fn)) ctx.__triggers.push(fn); } }; return ch; },
  },
  Session: { getEffectiveUser: () => ({ getEmail: () => env.OWNER_EMAIL || 'angad@linkmarketing.org.uk' }) },
  HtmlService: {},
  SUPABASE_BACKEND: true,  // Code.gs: the Google-only parts (email relay, handover, switch) are off here
  // The one-login hub (hub/lib/core.js) in the same database: redeem a sign-in ticket, open a new starter's playbook
  CoreAuth: {
    redeem: (ticket, app) => io('core.redeem', String(ticket || ''), String(app || '')),
    unlockPlaybook: starter => io('core.unlock', starter),
  },
  __triggers: [],
};

// Tests only: the fake OneSignal from app/dev/gas.js. __pushOff = no phone subscribed, __pushNever = no OneSignal record.
const TEST = { pushes: [] };
function fakeFetch(o) {
  const look = /\/users\/by\/external_id\/([^/?]+)$/.exec(o.url);
  if (look) {
    const id = decodeURIComponent(look[1]);
    if ((ctx.__pushNever || []).includes(id)) return { code: 404, text: '{"errors":["not found"]}' };
    const subs = (ctx.__pushOff || []).includes(id) ? [{ type: 'SafariPush', enabled: false, notification_types: -2 }] : [{ type: 'SafariPush', enabled: true, notification_types: 1, device_model: 'iPhone' }];
    return { code: 200, text: JSON.stringify({ properties: { last_active: 1760000000 }, subscriptions: subs }) };
  }
  const body = JSON.parse(o.payload);
  const off = (ctx.__pushOff || []).some(id => body.include_aliases.external_id.includes(id));
  TEST.pushes.push({ url: o.url, headers: o.headers, body, reached: !off });
  return { code: 200, text: off ? '{"id":"","errors":["All included players are not subscribed"]}' : '{"id":"x"}' };
}

vm.createContext(ctx);
// A clock tests can move (deadlines, week rollover). Live: offset 0.
vm.runInContext(`
  (function () {
    const RealDate = Date;
    globalThis.__offset = 0;
    class FakeDate extends RealDate {
      constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + globalThis.__offset); }
      static now() { return RealDate.now() + globalThis.__offset; }
    }
    globalThis.Date = FakeDate;
  })();`, ctx);
vm.runInContext(fs.readFileSync(codePath, 'utf8') + '\n;globalThis.__api = api;', ctx, { filename: 'Code.gs' });

const plain = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
parentPort.on('message', job => {
  LOADED = {};
  let reply;
  try {
    vm.runInContext('MEMO = {}', ctx);
    let out;
    if (job.type === 'call') out = job.fn === 'api' ? ctx.__api(job.args[0]) : ctx[job.fn](...(job.args || []));
    else if (job.type === 'eval') out = vm.runInContext(job.js, ctx);
    else if (job.type === 'pushes') out = TEST.pushes;
    flushAll();
    reply = { id: job.id, value: plain(out) };
  } catch (e) {
    reply = { id: job.id, error: String((e && e.stack) || e) };
  }
  LOADED = {};
  parentPort.postMessage(reply);
});
parentPort.postMessage({ ready: true });
