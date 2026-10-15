// Minimal in-memory fake of the Google Apps Script services used by Code.gs,
// so the real server code can be exercised locally. Dev/test only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function load(opts) {
  const state = { offsetMs: 0, outbox: [], pushes: [], props: {}, cache: {}, sheets: {}, triggers: [] };
  const url = opts.url;

  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = this.sh.data[this.r - 1 + i] || [];
        const o = [];
        for (let j = 0; j < this.nc; j++) o.push(row[this.c - 1 + j] === undefined ? '' : row[this.c - 1 + j]);
        out.push(o);
      }
      return out;
    }
    setValues(v) {
      for (let i = 0; i < this.nr; i++) {
        const ri = this.r - 1 + i;
        while (this.sh.data.length <= ri) this.sh.data.push([]);
        for (let j = 0; j < this.nc; j++) this.sh.data[ri][this.c - 1 + j] = v[i][j];
      }
      return this;
    }
    clearContent() { return this.setValues(Array.from({ length: this.nr }, () => Array(this.nc).fill(''))); }
    setFontWeight() { return this; }
    setNumberFormat() { return this; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.data = []; }
    getDataRange() {
      const nc = Math.max(1, ...this.data.map(r => r.length));
      return new Range(this, 1, 1, Math.max(1, this.data.length), nc);
    }
    getLastRow() { let n = this.data.length; while (n > 0 && this.data[n - 1].every(v => v === '' || v === undefined)) n--; return n; }
    getLastColumn() { return Math.max(0, ...this.data.map(r => { let n = r.length; while (n > 0 && (r[n - 1] === '' || r[n - 1] === undefined)) n--; return n; })); }
    appendRow(vals) { const r = this.getLastRow(); while (this.data.length <= r) this.data.push([]); this.data[r] = vals.slice(); if (r + 1 > this.getMaxRows()) this.maxRows = r + 1; return this; }
    getMaxRows() { return this.maxRows || 1000; }
    getMaxColumns() { return this.maxCols || 26; }
    insertColumnsAfter(after, n) { this.maxCols = (this.maxCols || 26) + n; }
    insertRowsAfter(after, n) { this.maxRows = (this.maxRows || 1000) + n; }
    getRange(r, c, nr, nc) {
      if (r + (nr || 1) - 1 > this.getMaxRows()) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
      if (c + (nc || 1) - 1 > this.getMaxColumns()) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
      return new Range(this, r, c, nr || 1, nc || 1);
    }
    deleteRow(r) { this.data.splice(r - 1, 1); }
    deleteRows(r, n) { this.data.splice(r - 1, n); }
    setFrozenRows() {}
    getName() { return this.name; }
  }
  const book = {
    getId: () => 'FAKE_SS',
    getSheetByName: n => state.sheets[n] || null,
    insertSheet: n => (state.sheets[n] = new Sheet(n)),
    getSheets: () => Object.values(state.sheets),
    deleteSheet: s => { delete state.sheets[s.name]; },
  };

  function fmtDate(d, tz, f) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d).reduce((a, p) => (a[p.type] = p.value, a), {});
    return f.replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day).replace('HH', parts.hour).replace('mm', parts.minute);
  }

  const ctx = {
    console,
    SpreadsheetApp: { getActive: () => book, openById: () => book, flush: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in state.props ? state.props[k] : null), setProperty: (k, v) => { state.props[k] = String(v); } }) },
    CacheService: { getScriptCache: () => ({ get: k => state.cache[k] || null, put: (k, v) => { state.cache[k] = v; }, remove: k => { delete state.cache[k]; }, removeAll: () => {} }) },
    // ctx.__lockBusy = N → the next N lock attempts fail (simulates a queue of people sending at once)
    LockService: { getScriptLock: () => ({
      tryLock() { if (ctx.__lockBusy > 0) { ctx.__lockBusy--; return false; } return true; },
      waitLock() { if (ctx.__lockBusy > 0) { ctx.__lockBusy--; throw new Error('Lock timeout: another process was holding the lock for too long.'); } },
      releaseLock() {},
    }) },
    Utilities: {
      formatDate: fmtDate,
      sleep: () => {},
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (alg, s) => Array.from(crypto.createHash(alg).update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
    },
    MailApp: { sendEmail: o => { state.outbox.push(Object.assign({ at: new Date().toISOString() }, o)); }, getRemainingDailyQuota: () => 1500 - state.outbox.length },
    // The script owner's Gmail: globalThis.__sendAs = its "Send mail as" addresses (none until a test adds them)
    GmailApp: {
      getAliases: () => ctx.__sendAs || [],
      sendEmail: (to, subject, body, o) => { state.outbox.push(Object.assign({ at: new Date().toISOString(), to, subject, body, via: 'gmail' }, o)); },
    },
    // Fake OneSignal: users listed in globalThis.__pushOff have no phone subscribed (200 with an empty id, like the real API).
    // Looking a user up (GET …/users/by/external_id/<id>): __pushNever → 404 (no record), __pushOff → no subscription, else one iPhone.
    UrlFetchApp: {
      fetch: (url, o) => {
        const look = /\/users\/by\/external_id\/([^/?]+)$/.exec(url);
        if (look) {
          const id = decodeURIComponent(look[1]);
          if ((ctx.__pushNever || []).includes(id)) return { getResponseCode: () => 404, getContentText: () => '{"errors":["not found"]}' };
          const subs = (ctx.__pushOff || []).includes(id) ? [{ type: 'SafariPush', enabled: false, notification_types: -2 }] : [{ type: 'SafariPush', enabled: true, notification_types: 1, device_model: 'iPhone' }];
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ properties: { last_active: 1760000000 }, subscriptions: subs }) };
        }
        const body = JSON.parse(o.payload);
        const off = (ctx.__pushOff || []).some(id => body.include_aliases.external_id.includes(id));
        state.pushes.push({ url, headers: o.headers, body, reached: !off });
        const text = off ? '{"id":"","errors":["All included players are not subscribed"]}' : '{"id":"x"}';
        return { getResponseCode: () => 200, getContentText: () => text };
      },
      fetchAll: reqs => reqs.map(r => ctx.UrlFetchApp.fetch(r.url, r)),
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType: () => t }) },
    ScriptApp: {
      getService: () => ({ getUrl: () => url }),
      getProjectTriggers: () => state.triggers, deleteTrigger: () => {},
      WeekDay: { MONDAY: 'MON', WEDNESDAY: 'WED', FRIDAY: 'FRI', SATURDAY: 'SAT' },
      newTrigger: fn => { const t = { fn, getHandlerFunction: () => fn }; const ch = { timeBased: () => ch, onWeekDay: d => (t.day = d, ch), atHour: hr => (t.hour = hr, ch), everyDays: () => ch, everyMinutes: () => ch, inTimezone: () => ch, create: () => state.triggers.push(t) }; return ch; },
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'angad@linkmarketing.org.uk' }) },
    HtmlService: {},
  };
  vm.createContext(ctx);
  // Controllable clock (for testing deadlines / week rollover).
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
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'Code.gs'), 'utf8');
  vm.runInContext(code + '\n;globalThis.__api = api;', ctx, { filename: 'Code.gs' });
  return {
    ctx, state,
    api: req => JSON.parse(JSON.stringify(ctx.__api(req))),
    run: (fn, ...args) => ctx[fn](...args),
    setOffsetMs: ms => { ctx.__offset = ms; },
    eval: s => vm.runInContext(s, ctx),
  };
}
module.exports = { load };
