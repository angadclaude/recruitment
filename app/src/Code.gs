/**
 * LINK × JUSS Recruitment App — server (Google Apps Script)
 *
 * Data lives in tabs of the Google Sheet this script is attached to.
 * Run `setup()` once from the Apps Script editor. See SETUP.md.
 */

// ───────────────────────── CONFIG ─────────────────────────
const CONFIG = {
  TZ: 'Europe/London',
  APP_NAME: 'Juss & Link Recruitment App',
  OFFICE_ADDRESS: '2nd Floor East, Automotive House, Grays Place, Slough SL2 5AF',
  PAY_TARGET: 5,                  // recruitment incentive: net attended appointments per booker, Mon–Fri (admins don't earn it)
  OUTCOME_DEADLINE_DAY: 5,        // 5 = Friday (Mon=1 … Fri=5, Sat=6). Matches the thank-you WhatsApp: "by Friday 6PM"
  OUTCOME_DEADLINE_TIME: '18:00', // outcomes logged after this are flagged LATE
  REPEAT_DAYS: 183,               // "seen before" window: 6 months
  REPEAT_COUNTS_FOR_PAY: false,   // a repeat attendee (within REPEAT_DAYS) does not count
  FULL_DETAILS_DAYS: 84,          // 12 weeks: full application details, then trimmed to the basics (name, contact, result)
  RETENTION_DAYS: 183,            // 6 months: everything deleted (= the repeat-candidate window). Matches the check-in notice.
  CHECKIN_FROM: '07:00',          // check-ins outside these times are flagged amber for admins (never blocked)
  CHECKIN_TO: '17:00',
  // Where the app lives for staff and candidates (the GitHub Pages / custom domain address, ending in /).
  // Leave '' to use the Google Apps Script link instead (no push notifications).
  PUBLIC_URL: 'https://angadclaude.github.io/recruitment/join/',
  ACADEMY_SIGNOFF: { LINK: 'Jess', JUSS: 'Rubal' }, // who signs the BA Academy WhatsApp, whoever sends it
  // Who sends the thank-you WhatsApp to every appointment (their company's candidates), and gets the reminder.
  // The same email for both = one person sends them all.
  THANKS_TEAM: { LINK: 'jess@linkmarketing.org.uk', JUSS: 'rubal@jussmarketing.co.uk' },  // recruitment team: thank-yous + non-qualifier alerts
  THANKS_TIME: '12:00',           // every day: "N thank-you messages to send" to Jess / Rubal (only if there are any)
  DIGEST_TIME: '18:00',           // Mon–Thu: each booker's round-up of their day
  ROUNDUP_TIME: '15:00',          // Friday: week roundup to each booker + a team roundup to admins
  TEAM_ROUNDUP: true,             // false = admins don't get the Friday team roundup
  EMAIL_ALERTS: false,            // true = also email every alert. Push is used when OneSignal keys are set.
  SESSION_DAYS: 30,               // staff stay logged in for this long
  SHEET_ID: '',                   // the data Sheet; only needed if this script isn't opened from the Sheet itself
  HISTORY_SOURCE_ID: '1SjfhyQw-mnJY3iT8Q7p50795kP4DySJFx9fVcEEB_P8', // old Google Form sheet
  HISTORY_SOURCE_TAB: 'Form Responses 1',
};

// Right-to-work options. level: ok | visa (ask expiry) | check (amber) | no (red, not paid)
const RTW = [
  ['British or Irish citizen', 'ok'],
  ['Settled status / Indefinite Leave to Remain', 'ok'],
  ['Pre-settled status', 'ok'],
  ['Refugee / humanitarian protection', 'ok'],
  ['Graduate visa (PSW)', 'visa'],
  ['Spouse / partner / family visa', 'visa'],
  ['Dependant of a Skilled Worker', 'visa'],
  ['Youth Mobility visa', 'visa'],
  ['BNO visa', 'visa'],
  ['Ukraine scheme', 'visa'],
  ['Dependant of a student', 'check'],
  ['Student visa (Tier 4)', 'no'],
  ['Skilled Worker / Health & Care visa', 'no'],
  ['Asylum seeker (decision pending)', 'no'],
  ['I need visa sponsorship', 'no'],
  ['Other', 'check'],
];

// Admins can add, edit, switch off and delete users. Created by setup().
const ADMINS = [
  { name: 'Angad Oshan', email: 'angad@linkmarketing.org.uk', company: 'LINK' },
  { name: 'Jess Grace', email: 'jess@linkmarketing.org.uk', company: 'LINK' },
  { name: 'Satpal Oshan', email: 'satpal@jussmarketing.co.uk', company: 'JUSS' },
  { name: 'Rubal Oshan', email: 'rubal@jussmarketing.co.uk', company: 'JUSS' },
];

const OUTCOMES = ['Academy booked', 'Thinking it over', 'No answer', 'Declined', 'Not suitable'];

const SHEETS = {
  Users: ['id', 'name', 'email', 'company', 'roles', 'active', 'created_at'],
  Candidates: [
    'id', 'created_at', 'attended_date', 'week_ending', 'resume_token',
    'full_name', 'mobile', 'email', 'over18', 'booker_typed', 'booker_id', 'booker_name', 'company',
    'source', 'rtw', 'visa_expiry', 'privacy_ok',
    'repeat_of', 'repeat_info', 'repeat_block',
    'in_room', 'presenter_id', 'presenter_name', 'rag', 'stars', 'tags', 'notes', 'notes_at',
    'eval_at', 'q1_excitement', 'q2_stood_out', 'q3_reason', 'q4_situation', 'q4_looking_for',
    'q5_start_date', 'q6_days', 'q7_commute', 'q8_resilience', 'q9_results_paid', 'q9_results_detail',
    'q10_door', 'q11_coach', 'q12_bdp_stage', 'q12_bdp_why', 'q13_unspent', 'q14_questions',
    'outcome', 'academy_date', 'outcome_notes', 'outcome_by', 'outcome_at', 'outcome_late',
    'admin_status', 'admin_note', 'admin_by', 'admin_at',
    'pay_excluded', 'pay_excluded_reason', 'thanks_sent_at', 'offer_sent_at',
    'welcome_token', 'academy_confirmed_at',
    'p_why_sales', 'p_why_sales_note', 'p_interesting', 'eval_edited_at', 'thanks_by',
  ],
  History: ['attended_date', 'full_name', 'mobile', 'email', 'booker_raw', 'presenter_raw'],
  Codes: ['email', 'code_hash', 'expires', 'attempts'],
  Sessions: ['token', 'user_id', 'expires'],
  Log: ['at', 'user', 'action', 'candidate_id', 'detail'],
};

// ───────────────────────── WEB APP ─────────────────────────
function doGet(e) {
  const p = (e && e.parameter) || {};
  const mode = p.app === 'staff' ? 'staff' : (['eval', 'welcome'].indexOf(p.go) >= 0 ? p.go : 'checkin');
  let out;
  if (CONFIG.PUBLIC_URL) {
    // Only Code.gs is needed in Apps Script: the screens load from the app's own web address.
    const b = CONFIG.PUBLIC_URL;
    out = HtmlService.createHtmlOutput('<!DOCTYPE html><html><head><base target="_top"><meta charset="utf-8">' +
      '<link rel="stylesheet" href="' + b + 'app.css"></head><body>' +
      '<div id="boot" data-mode="' + esc(mode) + '" data-k="' + esc(p.t) + '" data-cid="' + esc(p.c) + '"></div>' +
      '<div id="app"><div class="loading">Loading…</div></div><div id="toast" class="toast" hidden></div>' +
      '<script src="' + b + 'logos.js"></script><script src="' + b + 'qr.js"></script><script src="' + b + 'app.js"></script></body></html>');
  } else {
    // No web address: serve the bundled HTML files (Index, Styles, JS, Logos, QR) from this project.
    const t = HtmlService.createTemplateFromFile('Index');
    t.mode = mode; t.k = p.t || ''; t.cid = p.c || '';
    out = t.evaluate();
  }
  return out
    .setTitle(CONFIG.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** JSON API for the installable app (GitHub Pages). Plain-text POST keeps it a CORS "simple request". */
function doPost(e) {
  let req = {};
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { req = {}; }
  return ContentService.createTextOutput(JSON.stringify(api(req))).setMimeType(ContentService.MimeType.JSON);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** Single entry point for the browser: google.script.run.api({action, token, ...}) */
function api(req) {
  MEMO = {};
  try {
    const fn = PUBLIC_ACTIONS[req.action];
    if (fn) return { ok: true, data: fn(req) };
    const sfn = STAFF_ACTIONS[req.action];
    if (!sfn) throw new Error('Unknown action');
    const user = userFromToken(req.token);
    if (!user) return { ok: false, auth: true, error: 'Please log in again.' };
    return { ok: true, data: sfn(req, user) };
  } catch (err) {
    const msg = String((err && err.message) || err);
    // Google being busy (lock queue, too many at once, a Sheets hiccup) → the app retries by itself
    const retry = !!(err && err.retry) || /timed out|Service invoked too many|try again later|Lock|Service Spreadsheets|Service error/i.test(msg);
    return { ok: false, error: retry ? 'Lots of people are sending at once. Trying again…' : msg, retry: retry };
  }
}

// ───────────────────────── UTIL ─────────────────────────
function ss() {
  if (MEMO._ss) return MEMO._ss;
  const id = PropertiesService.getScriptProperties().getProperty('SS_ID');
  return (MEMO._ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive());
}
function sheet(name) { return ss().getSheetByName(name); }

let MEMO = {};  // sheet reads cached for the length of one request
function readTable(name) {
  if (MEMO[name]) return MEMO[name];
  const sh = sheet(name);
  const values = sh.getDataRange().getValues();
  const headers = values.shift().map(String);
  const want = SHEETS[name];
  if (want && headers.length < want.length && headers.every((h, i) => h === want[i])) {
    // New version added columns: append their headers so nothing needs re-running.
    const add = want.slice(headers.length);
    ensureCols(sh, want.length, name);
    sh.getRange(1, headers.length + 1, 1, add.length).setValues([add]).setFontWeight('bold');
    sh.getRange(1, headers.length + 1, sh.getMaxRows(), add.length).setNumberFormat('@');
    add.forEach(h => headers.push(h));
  }
  // Rows are written by column position, so a column inserted or moved by hand would scramble data. Stop instead.
  if (want && !want.every((h, i) => headers[i] === h)) {
    throw new Error('The "' + name + '" tab\'s columns were changed in the Google Sheet. Undo that change (File → Version history) and try again.');
  }
  const rows = values.map((r, i) => {
    const o = { _row: i + 2 };
    headers.forEach((h, j) => { o[h] = r[j] === null || r[j] === undefined ? '' : String(r[j]); });
    return o;
  });
  MEMO[name] = rows;
  return rows;
}
function writeRow(name, obj) {
  const cols = SHEETS[name], sh = sheet(name);
  const row = cols.map(c => (obj[c] === undefined || obj[c] === null) ? '' : String(obj[c]));
  ensureCols(sh, cols.length, name);
  sh.getRange(obj._row, 1, 1, cols.length).setValues([row]);
  delete MEMO[name];
}
function appendRow(name, obj) {
  const cols = SHEETS[name];
  const sh = sheet(name);
  const row = cols.map(c => (obj[c] === undefined || obj[c] === null) ? '' : String(obj[c]));
  const r = sh.getLastRow() + 1;
  ensureRows(sh, r, cols.length);
  ensureCols(sh, cols.length, name);
  sh.getRange(r, 1, 1, cols.length).setValues([row]);
  delete MEMO[name];
  obj._row = r;
  return obj;
}
/** One row, read fresh by position (cheap, safe inside a lock). */
function readRow(name, r) {
  const cols = SHEETS[name], sh = sheet(name), n = Math.min(cols.length, sh.getLastColumn());
  const v = sh.getRange(r, 1, 1, n).getValues()[0];
  const o = { _row: r };
  cols.forEach((c, i) => { o[c] = i < n && v[i] !== null && v[i] !== undefined ? String(v[i]) : ''; });
  return o;
}
/** Row number of a record by its id (first column) — reads one narrow column, not the whole tab. */
function rowOfId(name, id) {
  const sh = sheet(name), last = sh.getLastRow();
  if (last < 2 || !id) return 0;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === id) return i + 2;
  return 0;
}
/** Sheets start with 1,000 rows; grow in blocks of 500 (formatted as text) before writing past the end. */
function ensureRows(sh, lastNeeded, ncols) {
  const max = sh.getMaxRows();
  if (lastNeeded <= max) return;
  const add = Math.max(500, lastNeeded - max);
  sh.insertRowsAfter(max, add);
  sh.getRange(max + 1, 1, add, ncols).setNumberFormat('@');
}
/** A new version can add columns at the end: make sure the tab is wide enough (checked once per request). */
function ensureCols(sh, n, name) {
  if (MEMO['_cols_' + name]) return;
  const max = sh.getMaxColumns();
  if (max < n) sh.insertColumnsAfter(max, n - max);
  MEMO['_cols_' + name] = true;
}
function withLock(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw busyError();
  // flush() makes this write visible before the next person in the queue reads the sheet
  try { const r = fn(); SpreadsheetApp.flush(); return r; } finally { lock.releaseLock(); }
}
function busyError() { const e = new Error('Lots of people are sending at once. Trying again…'); e.retry = true; return e; }
/** Audit line. Sheet.appendRow is atomic, so this is safe outside the lock (keeps the lock short). */
function log(user, action, cid, detail) {
  try {
    const sh = sheet('Log'), cols = SHEETS.Log;
    const o = { at: nowStr(), user: user ? user.name : 'candidate', action: action, candidate_id: cid || '', detail: detail || '' };
    ensureRows(sh, sh.getLastRow() + 2, cols.length);
    sh.appendRow(cols.map(c => String(o[c] == null ? '' : o[c])));
    delete MEMO.Log;
  } catch (e) { console.error(e); }
}

function nowStr() { return Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd HH:mm'); }
function todayStr() { return Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd'); }
function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekday(ymd) { return new Date(ymd + 'T00:00:00Z').getUTCDay(); } // 0=Sun … 6=Sat
function weekMonday(ymd) { const w = weekday(ymd); return addDays(ymd, w === 0 ? -6 : 1 - w); }
function weekEnding(ymd) { return addDays(weekMonday(ymd), 6); } // Sunday
function deadlineLabel() { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][CONFIG.OUTCOME_DEADLINE_DAY % 7] + ' ' + CONFIG.OUTCOME_DEADLINE_TIME; }
function outcomeDeadline(attendedYmd) {
  return addDays(weekMonday(attendedYmd), CONFIG.OUTCOME_DEADLINE_DAY - 1) + ' ' + CONFIG.OUTCOME_DEADLINE_TIME;
}
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

function uid() { return Utilities.getUuid().replace(/-/g, '').slice(0, 12); }
function token() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); }
function sha(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

/** UK mobile → 07xxxxxxxxx (storage); returns '' if it doesn't look valid */
function normMobile(s) {
  let d = String(s || '').replace(/[^\d+]/g, '');
  if (d.indexOf('+44') === 0) d = '0' + d.slice(3);
  else if (d.indexOf('0044') === 0) d = '0' + d.slice(4);
  else if (d.indexOf('44') === 0 && d.length === 12) d = '0' + d.slice(2);
  d = d.replace(/\D/g, '');
  if (/^7\d{9}$/.test(d)) d = '0' + d;  // Sheets drops the leading 0 from numbers typed into the old form
  return /^07\d{9}$/.test(d) ? d : '';
}
function cleanName(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
function rtwLevel(rtw) {
  const r = RTW.filter(x => x[0] === rtw)[0];
  return r ? r[1] : 'check';
}
function truthy(v) { return v === true || v === 'TRUE' || v === 'true' || v === 'Yes'; }

// ───────────────────────── FLAGS / RULES ─────────────────────────
/** Traffic-light flags for a candidate. Conviction flag only for admins. */
function flagsFor(c, isAdmin) {
  const f = [];
  const red = t => f.push({ level: 'red', text: t });
  const amber = t => f.push({ level: 'amber', text: t });
  const green = t => f.push({ level: 'green', text: t });
  if (c.over18 === 'No') red('Under 18');
  const lvl = rtwLevel(c.rtw);
  if (lvl === 'no') red('Not eligible: ' + c.rtw);
  if (lvl === 'check') amber('Check right to work: ' + c.rtw);
  if (c.visa_expiry) {
    const left = daysBetween(todayStr(), c.visa_expiry);
    if (left < 0) red('Visa expired ' + c.visa_expiry);
    else if (left < 90) amber('Visa expires in ' + left + ' days');
  }
  if (truthy(c.repeat_block)) red('Previously not suitable — do not progress (' + c.repeat_info + ')');
  else if (c.repeat_of) amber('Seen before: ' + c.repeat_info);
  if (c.rag === 'R') red('Presenter marked RED — admin decides');
  if (c.q7_commute === 'No') red("Can't commute to Slough");
  if (c.q1_excitement && Number(c.q1_excitement) <= 6) amber('Excitement only ' + c.q1_excitement + '/10');
  if (c.q10_door && c.q10_door.indexOf('C)') === 0) amber('Door scenario: "maybe this isn\'t for me"');
  if (c.q11_coach && (c.q11_coach.indexOf('B)') === 0 || c.q11_coach.indexOf('C)') === 0)) amber('Coachability answer: ' + c.q11_coach.slice(3));
  if (!c.booker_id) amber('Booker not confirmed' + (c.booker_typed ? ' (typed "' + c.booker_typed + '")' : ''));
  if (isAdmin && c.q13_unspent === 'Yes') amber('Declared an unspent conviction');
  const at = String(c.created_at || '').slice(11, 16);
  if (isAdmin && at && (at < CONFIG.CHECKIN_FROM || at > CONFIG.CHECKIN_TO)) amber('Checked in at ' + at + ' (outside office hours)');
  if (truthy(c.outcome_late)) amber('Outcome logged late (after ' + deadlineLabel() + ')');
  if (c.q12_bdp_stage && c.q12_bdp_stage.indexOf('Ownership') >= 0) green('Future owner ambition');
  if (Number(c.stars) >= 4) green(c.stars + '★ from presenter');
  return f;
}

/** Non-qualifier: can't be taken on, known from their check-in answers ('' = qualifies).
 *  No evaluation form, never counts for the incentive, nobody chased for an outcome; Jess + Rubal + booker alerted at check-in. */
function nonQualifier(c) {
  if (c.over18 !== 'Yes') return 'Under 18';
  if (rtwLevel(c.rtw) === 'no') return 'Not eligible to work self-employed: ' + c.rtw;
  if (c.visa_expiry && c.visa_expiry < c.attended_date) return 'Visa expired ' + c.visa_expiry;
  return '';
}

/** Why a candidate does NOT count towards the booker's net attended ('' = counts). */
function payExclusion(c) {
  if (!truthy(c.in_room)) return 'Not rated by the presenter (not confirmed in the room)';
  const wd = weekday(c.attended_date);
  if (wd === 0 || wd === 6) return 'Weekend appointment';
  const nq = nonQualifier(c);
  if (nq) return nq;
  if (c.repeat_of && !CONFIG.REPEAT_COUNTS_FOR_PAY) return 'Repeat attendee (seen in the last 6 months)';
  if (truthy(c.pay_excluded)) return 'Removed by admin: ' + (c.pay_excluded_reason || 'no reason given');
  return '';
}

// ───────────────────────── AUTH ─────────────────────────
/** Staff list, cached between requests for speed (cleared whenever a user is saved or deleted). */
function usersAll() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('users_v1');
  if (hit) return JSON.parse(hit);
  const rows = readTable('Users');
  try { cache.put('users_v1', JSON.stringify(rows), 600); } catch (e) { /* too big to cache: fine */ }
  return rows;
}
function usersChanged() { CacheService.getScriptCache().remove('users_v1'); delete MEMO.Users; }
function userById(id) { return usersAll().filter(u => u.id === id)[0]; }
function rolesOf(u) { return String(u.roles || '').split(',').map(s => s.trim()).filter(String); }
function has(u, role) { const r = rolesOf(u); return r.indexOf('admin') >= 0 || r.indexOf(role) >= 0; }
function isAdmin(u) { return rolesOf(u).indexOf('admin') >= 0; }
/** Recruitment incentive: bookers only. Admins can book people, but they don't earn it. */
function earnsIncentive(u) { return !isAdmin(u) && rolesOf(u).indexOf('booker') >= 0; }
function publicUser(u) { return { id: u.id, name: u.name, email: u.email, company: u.company, roles: rolesOf(u), active: truthy(u.active) }; }

function userFromToken(tok) {
  if (!tok) return null;
  const cache = CacheService.getScriptCache();
  let uidv = cache.get('s_' + tok);
  if (!uidv) {
    const s = readTable('Sessions').filter(x => x.token === sha(tok))[0];
    if (!s || s.expires < nowStr()) return null;
    uidv = s.user_id;
    cache.put('s_' + tok, uidv, 21600);
  }
  const u = userById(uidv);
  return u && truthy(u.active) ? u : null;
}

function requestCode(req) {
  const email = String(req.email || '').trim().toLowerCase();
  const cache = CacheService.getScriptCache(), rk = 'codes_' + sha(email).slice(0, 20), n = Number(cache.get(rk) || 0);
  if (n >= 3) throw new Error('Too many codes requested. Use the last code we emailed, or wait 15 minutes.');
  cache.put(rk, String(n + 1), 900);
  const u = usersAll().filter(x => x.email.toLowerCase() === email && truthy(x.active))[0];
  // Same response whether or not the email exists, so the list of staff can't be probed.
  if (!u) return { sent: true };
  const code = String(Math.floor(100000 + Math.random() * 900000));
  withLock(() => {
    const rows = readTable('Codes').filter(x => x.email === email);
    const rec = rows[0] || { email: email };
    rec.code_hash = sha(code + '|' + email);
    rec.expires = Utilities.formatDate(new Date(Date.now() + 10 * 60000), CONFIG.TZ, 'yyyy-MM-dd HH:mm');
    rec.attempts = '0';
    rec._row ? writeRow('Codes', rec) : appendRow('Codes', rec);
  });
  MailApp.sendEmail({
    to: email,
    subject: 'Your login code: ' + code,
    name: CONFIG.APP_NAME,
    htmlBody: '<p>Hi ' + esc(u.name.split(' ')[0]) + ',</p><p>Your login code is:</p>' +
      '<p style="font-size:28px;font-weight:bold;letter-spacing:4px">' + code + '</p>' +
      '<p>It expires in 10 minutes. If you didn\'t ask for this, ignore this email.</p>',
  });
  return { sent: true };
}

function verifyCode(req) {
  const email = String(req.email || '').trim().toLowerCase();
  const code = String(req.code || '').trim();
  return withLock(() => {
    const rec = readTable('Codes').filter(x => x.email === email)[0];
    if (!rec || rec.expires < nowStr()) throw new Error("That code isn't right or has expired. Check the latest email, or request a new code.");
    if (Number(rec.attempts) >= 5) throw new Error('Too many attempts — request a new code.');
    if (rec.code_hash !== sha(code + '|' + email)) {
      rec.attempts = String(Number(rec.attempts) + 1); writeRow('Codes', rec);
      throw new Error("That code isn't right or has expired. Check the latest email, or request a new code.");
    }
    const u = usersAll().filter(x => x.email.toLowerCase() === email && truthy(x.active))[0];
    // Two doors on the login screen: Admin login (admins) and BA login (everyone else Angad gives access).
    // Wrong door: say which one is theirs and keep the code, so the app carries on through the right door.
    const door = u && isAdmin(u) ? 'admin' : 'ba';
    if (u && (req.door === 'admin' || req.door === 'ba') && req.door !== door) return { wrongDoor: door };
    rec.expires = '0000'; writeRow('Codes', rec);
    if (!u) throw new Error('Access not active.');
    const t = token();
    appendRow('Sessions', {
      token: sha(t), user_id: u.id,
      expires: Utilities.formatDate(new Date(Date.now() + CONFIG.SESSION_DAYS * 86400000), CONFIG.TZ, 'yyyy-MM-dd HH:mm'),
    });
    return { token: t, user: publicUser(u) };
  });
}

// ───────────────────────── PUBLIC (candidate) ─────────────────────────
function publicConfig(req) {
  const bookers = usersAll().filter(u => truthy(u.active) && has(u, 'booker'))
    .map(u => ({ id: u.id, name: u.name, company: u.company }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { today: todayStr(), bookers: bookers, rtw: RTW.map(r => ({ label: r[0], level: r[1] })) };
}

function checkin(req) {
  const f = req.form || {};
  const name = cleanName(f.full_name);
  const mobile = normMobile(f.mobile);
  const email = String(f.email || '').trim().toLowerCase();
  if (name.split(' ').length < 2) throw new Error('Please enter your full name (first and last).');
  if (!mobile) throw new Error('Please enter a valid UK mobile number (07…).');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Please enter a valid email.');
  if (['Yes', 'No'].indexOf(f.over18) < 0) throw new Error('Please answer whether you are 18 or over.');
  if (!f.rtw) throw new Error('Please choose your right to work status.');
  if (!truthy(f.privacy_ok)) throw new Error('Please tick the privacy notice to continue.');
  const today = todayStr();
  const booker = f.booker_id ? userById(f.booker_id) : null;
  // Repeat check (last 6 months + old form history) before taking the lock: those rows don't change today.
  const rep = findRepeat(readTable('Candidates'), mobile, email, today);

  const res = withLock(() => {
    // Already checked in today on this mobile? Return the same record (scanned twice, double tap, retry).
    const dupe = todaysRowByMobile(mobile, today);
    if (dupe) return { c: dupe, isNew: false };
    const c = {
      id: uid(), created_at: nowStr(), attended_date: today, week_ending: weekEnding(today),
      resume_token: token().slice(0, 24),
      full_name: name, mobile: mobile, email: email, over18: f.over18,
      booker_typed: String(f.booker_typed || '').trim().slice(0, 60),
      booker_id: booker ? booker.id : '', booker_name: booker ? booker.name : '',
      company: booker ? booker.company : '',
      source: String(f.source || '').slice(0, 40), rtw: f.rtw,
      visa_expiry: rtwLevel(f.rtw) === 'visa' ? String(f.visa_expiry || '') : '',
      privacy_ok: 'TRUE',
      repeat_of: rep ? rep.ref : '', repeat_info: rep ? rep.info : '', repeat_block: rep && rep.block ? 'TRUE' : '',
    };
    appendRow('Candidates', c);
    return { c: c, isNew: true };
  });
  if (res.isNew) log(null, 'checkin', res.c.id, name);
  const nq = nonQualifier(res.c);
  if (res.isNew && nq) {
    // Straight to Jess + Rubal and the booker, so someone speaks to them before they leave
    const ids = [thanksTeam().LINK.id, thanksTeam().JUSS.id, booker ? booker.id : ''].filter(Boolean);
    notify(usersAll().filter(u => ids.indexOf(u.id) >= 0), '⛔ Non-qualifier checked in: ' + name,
      nq + ' · ' + (booker ? 'booked by ' + booker.name : 'booker not confirmed' + (res.c.booker_typed ? ' ("' + res.c.booker_typed + '")' : '')) +
      '. No evaluation form for them. Have a word before they leave.', res.c.id);
  } else if (res.isNew && booker) {
    notify([booker], '🙌 ' + name.split(' ')[0] + ' just checked in', name + ' is in the room for your appointment.', res.c.id);
  }
  return { id: res.c.id, resume: res.c.resume_token, first_name: res.c.full_name.split(' ')[0], company: res.c.company || '', evalDone: !!res.c.eval_at, nonQual: !!nq };
}

/** Today's check-in for a mobile, read fresh: only the first columns (id … mobile), then that one row. */
function todaysRowByMobile(mobile, today) {
  const cols = SHEETS.Candidates, iM = cols.indexOf('mobile'), iD = cols.indexOf('attended_date');
  const sh = sheet('Candidates'), last = sh.getLastRow();
  if (last < 2) return null;
  const v = sh.getRange(2, 1, last - 1, Math.max(iM, iD) + 1).getValues();
  for (let i = v.length - 1; i >= 0; i--) if (String(v[i][iM]) === mobile && String(v[i][iD]) === today) return readRow('Candidates', i + 2);
  return null;
}

/** Look for the same person in the last 6 months (new app records + imported history). */
function findRepeat(all, mobile, email, today) {
  const since = addDays(today, -CONFIG.REPEAT_DAYS);
  const prev = all.filter(c => (c.mobile === mobile || (email && c.email === email)) && c.attended_date >= since && c.attended_date < today)
    .sort((a, b) => b.attended_date.localeCompare(a.attended_date))[0];
  if (prev) {
    const block = prev.outcome === 'Not suitable' || prev.admin_status === 'rejected';
    let info = 'attended ' + prev.attended_date + (prev.booker_name ? ', booked by ' + prev.booker_name : '');
    if (prev.outcome) info += ' — outcome: ' + prev.outcome + (prev.academy_date ? ' (' + prev.academy_date + ')' : '');
    return { ref: prev.id, info: info, block: block };
  }
  const h = readTable('History').filter(x => (x.mobile === mobile || (email && x.email === email)) && x.attended_date >= since)
    .sort((a, b) => b.attended_date.localeCompare(a.attended_date))[0];
  if (h) return { ref: 'history', info: 'attended ' + h.attended_date + ' (old form)' + (h.booker_raw ? ', booked by ' + h.booker_raw : ''), block: false };
  return null;
}

function candidateByResume(req) {
  const c = readTable('Candidates').filter(x => x.id === req.id)[0];
  if (!c || !req.resume || c.resume_token !== req.resume) throw new Error('We could not find your check-in. Please scan the QR code again.');
  return c;
}

function candidateStatus(req) {
  const c = candidateByResume(req);
  return { first_name: c.full_name.split(' ')[0], company: c.company || '', attended_date: c.attended_date, today: todayStr(), evalDone: !!c.eval_at, canEdit: canEditEval(c), nonQual: !!nonQualifier(c) };
}
/** A candidate can change their answers the same day, until their booker has logged the call outcome. */
function canEditEval(c) { return !!c.eval_at && c.attended_date === todayStr() && !c.outcome; }
/** Their own answers, to change them (same day, before the outcome). */
function myEval(req) {
  const c = candidateByResume(req);
  if (!canEditEval(c)) throw new Error("Your answers can't be changed now. Speak to the person who booked you in.");
  const a = {}; EVAL_FIELDS.forEach(k => { a[k] = c[k]; });
  return { answers: a };
}

/** Evaluation QR on a different phone/page: find today's check-in by mobile number. */
function resumeByMobile(req) {
  const m = normMobile(req.mobile);
  if (!m) throw new Error('Please enter a valid UK mobile number (07…).');
  const c = readTable('Candidates').filter(x => x.mobile === m && x.attended_date === todayStr())[0];
  if (!c) return { found: false };
  return { found: true, id: c.id, resume: c.resume_token, first_name: c.full_name.split(' ')[0], company: c.company || '', evalDone: !!c.eval_at, canEdit: canEditEval(c), nonQual: !!nonQualifier(c) };
}

const EVAL_FIELDS = ['q1_excitement', 'q2_stood_out', 'q3_reason', 'q4_situation', 'q4_looking_for', 'q5_start_date',
  'q6_days', 'q7_commute', 'q8_resilience', 'q9_results_paid', 'q9_results_detail', 'q10_door', 'q11_coach',
  'q12_bdp_stage', 'q12_bdp_why', 'q13_unspent', 'q14_questions'];
const EVAL_REQUIRED = ['q1_excitement', 'q2_stood_out', 'q3_reason', 'q4_situation', 'q5_start_date', 'q6_days',
  'q7_commute', 'q8_resilience', 'q9_results_paid', 'q10_door', 'q11_coach', 'q12_bdp_stage', 'q13_unspent'];

function submitEval(req) {
  const a = req.answers || {};
  EVAL_REQUIRED.forEach(k => { if (!String(a[k] || '').trim()) throw new Error('Please answer every question marked *.'); });
  const found = candidateByResume(req);  // the full read happens before the lock
  if (found.attended_date < addDays(todayStr(), -1)) throw new Error('This evaluation link has expired. Please speak to the person who booked you in.');
  if (nonQualifier(found) && !found.eval_at) throw new Error("You don't need to fill in the evaluation. Our team will speak to you directly.");
  const res = withLock(() => {
    const c = readRow('Candidates', found._row);  // fresh copy of just this row
    if (c.id !== found.id) throw busyError();      // rows only move in the 02:00 clean-up: just retry
    let status = 'new';
    if (c.eval_at) {
      if (!req.edit) return { c: c, status: 'already' };  // sent before (double tap or retry): keep the first answers
      if (!canEditEval(c)) throw new Error("Your answers can't be changed now. Speak to the person who booked you in.");
      status = 'edited';
    }
    EVAL_FIELDS.forEach(k => { c[k] = String(a[k] || '').trim().slice(0, 1000); });
    if (status === 'new') c.eval_at = nowStr(); else c.eval_edited_at = nowStr();
    writeRow('Candidates', c);
    return { c: c, status: status };
  });
  const c = res.c, first = c.full_name.split(' ')[0];
  if (res.status !== 'already') log(null, res.status === 'edited' ? 'evaluation_changed' : 'evaluation', c.id, '');
  const b = c.booker_id ? userById(c.booker_id) : null;
  if (b && res.status === 'new') notify([b], '📋 ' + first + "'s evaluation is in", 'Call ' + c.full_name + ' — log the outcome by ' + deadlineLabel() + '.', c.id);
  if (b && res.status === 'edited') notify([b], '✏️ ' + first + ' changed their evaluation answers', 'Have a look before you call ' + first + '.', c.id);
  return { status: res.status, booker_first: c.booker_name ? c.booker_name.split(' ')[0] : 'Our team' };
}

/** Candidate's personal BA Academy welcome page (link inside the WhatsApp message). */
function welcomeByToken(t) {
  const c = t ? readTable('Candidates').filter(x => x.welcome_token === t)[0] : null;
  if (!c || c.outcome !== 'Academy booked' || c.admin_status === 'pending' || c.admin_status === 'rejected') {
    throw new Error("This link isn't active. Message the person who booked you in.");
  }
  return c;
}
function welcomeInfo(req) {
  const c = welcomeByToken(req.t);
  return {
    first_name: c.full_name.split(' ')[0], company: c.company || 'LINK', academy_date: c.academy_date,
    booker_first: c.booker_name ? c.booker_name.split(' ')[0] : '', confirmed_at: c.academy_confirmed_at,
    address: CONFIG.OFFICE_ADDRESS, today: todayStr(),
  };
}
function confirmAcademy(req) {
  const c = withLock(() => {
    const x = welcomeByToken(req.t);
    if (!x.academy_confirmed_at) { x.academy_confirmed_at = nowStr(); writeRow('Candidates', x); log(null, 'academy_confirmed', x.id, ''); x._new = true; }
    return x;
  });
  const b = c._new && c.booker_id ? userById(c.booker_id) : null;
  if (b) notify([b], '✅ ' + c.full_name.split(' ')[0] + ' confirmed Day 1!', c.full_name + ' locked in BA Academy for ' + c.academy_date + '.', c.id);
  return { confirmed_at: c.academy_confirmed_at };
}

// ───────────────────────── STAFF ─────────────────────────
function canSee(u, c) {
  if (isAdmin(u)) return true;
  if (c.booker_id === u.id) return true;
  if (has(u, 'presenter') && (c.attended_date === todayStr() || c.presenter_id === u.id)) return true;
  return false;
}
function shape(c, u) {
  const o = {};
  SHEETS.Candidates.forEach(k => { o[k] = c[k]; });
  delete o.resume_token;
  delete o.welcome_token;
  if (c.welcome_token) o.welcome_url = welcomeUrl(c);
  if (!isAdmin(u)) o.q13_unspent = '';
  o.flags = flagsFor(c, isAdmin(u));
  o.pay_reason = payExclusion(c);
  o.non_qual = nonQualifier(c);
  o.deadline = outcomeDeadline(c.attended_date);
  o.first_name = c.full_name.split(' ')[0];
  return o;
}
function getC(id) {
  const r = rowOfId('Candidates', id);
  if (!r) throw new Error('Candidate not found');
  return readRow('Candidates', r);
}

function me(req, u) {
  return {
    user: publicUser(u),
    today: todayStr(),
    weekEnding: weekEnding(todayStr()),
    outcomes: OUTCOMES,
    rtw: RTW.map(r => ({ label: r[0], level: r[1] })),
    address: CONFIG.OFFICE_ADDRESS,
    payTarget: CONFIG.PAY_TARGET,
    deadlineTime: CONFIG.OUTCOME_DEADLINE_TIME, deadlineLabel: deadlineLabel(),
    links: { checkin: publicLink('checkin'), eval: publicLink('eval'), staff: staffUrl('') },
    signoff: CONFIG.ACADEMY_SIGNOFF,
    thanksTeam: thanksTeam(),
  };
}

function listDay(req, u) {
  const d = req.date || todayStr();
  const rows = readTable('Candidates').filter(c => c.attended_date === d && canSee(u, c));
  return { date: d, items: rows.sort((a, b) => a.created_at.localeCompare(b.created_at)).map(c => shape(c, u)) };
}

function listWeek(req, u) {
  const we = req.weekEnding || weekEnding(todayStr());
  let rows = readTable('Candidates').filter(c => c.week_ending === we && canSee(u, c));
  if (req.mine) rows = rows.filter(c => c.booker_id === u.id);
  return { weekEnding: we, items: rows.sort((a, b) => a.created_at.localeCompare(b.created_at)).map(c => shape(c, u)) };
}

/** Everything the staff app needs for a week in ONE request (the phone caches it). */
function bundle(req, u) {
  const we = req.weekEnding || weekEnding(todayStr());
  const out = { weekEnding: we, items: listWeek({ weekEnding: we }, u).items, pay: payReport({ weekEnding: we }, u) };
  if (req.withMe) out.me = me(req, u);
  if (req.withUsers && isAdmin(u)) out.users = listUsers(req, u).users;
  return out;
}

function search(req, u) {
  const q = String(req.q || '').trim().toLowerCase();
  if (q.length < 2) return { items: [] };
  const m = normMobile(q);
  const rows = readTable('Candidates').filter(c => canSee(u, c) &&
    (c.full_name.toLowerCase().indexOf(q) >= 0 || (m && c.mobile === m) || c.email.indexOf(q) >= 0));
  return { items: rows.slice(-50).reverse().map(c => shape(c, u)) };
}

function getCandidate(req, u) {
  const c = getC(req.id);
  if (!canSee(u, c)) throw new Error('You do not have access to this candidate.');
  return shape(c, u);
}

function saveNotes(req, u) {
  if (!has(u, 'presenter')) throw new Error('Only presenters can write notes.');
  return withLock(() => {
    const c = getC(req.id);
    if (!canSee(u, c)) throw new Error('No access');
    // One tap on the list (Green / Amber / Red) sends only: ['rag'], so it never overwrites notes someone else just wrote.
    const set = k => !Array.isArray(req.only) || req.only.indexOf(k) >= 0;
    if (set('rag') && ['G', 'A', 'R', ''].indexOf(req.rag) >= 0) c.rag = req.rag;
    if (set('stars')) { const s = Number(req.stars); c.stars = s >= 1 && s <= 5 ? String(s) : ''; }
    // Rating someone = they were in the room (no extra tap needed). Untick only if explicitly set false with no rating.
    c.in_room = (req.in_room || c.rag || c.stars) ? 'TRUE' : '';
    if (set('tags')) c.tags = (req.tags || []).join(', ').slice(0, 300);
    if (set('notes')) c.notes = String(req.notes || '').slice(0, 2000);
    // The two questions the presenter asks in the room (only touched when sent, so older app versions can't wipe them)
    if (req.why !== undefined) c.p_why_sales = (req.why || []).join(', ').slice(0, 300);
    if (req.why_note !== undefined) c.p_why_sales_note = String(req.why_note || '').slice(0, 300);
    if (req.interesting !== undefined) c.p_interesting = String(req.interesting || '').slice(0, 300);
    c.presenter_id = u.id; c.presenter_name = u.name; c.notes_at = nowStr();
    writeRow('Candidates', c);
    log(u, 'notes', c.id, c.rag + ' ' + c.stars + '★');
    return shape(c, u);
  });
}

function markInRoom(req, u) {
  if (!has(u, 'presenter')) throw new Error('Only presenters can confirm attendance.');
  return withLock(() => {
    const c = getC(req.id);
    c.in_room = req.in_room ? 'TRUE' : '';
    if (!c.presenter_id) { c.presenter_id = u.id; c.presenter_name = u.name; }
    writeRow('Candidates', c);
    log(u, 'in_room', c.id, c.in_room);
    return shape(c, u);
  });
}

function saveOutcome(req, u) {
  const res = withLock(() => {
    const c = getC(req.id);
    c._wasPending = c.admin_status === 'pending';
    if (!(isAdmin(u) || c.booker_id === u.id)) throw new Error('Only the booker or admin can log the outcome.');
    if (OUTCOMES.indexOf(req.outcome) < 0) throw new Error('Choose an outcome.');
    if (req.outcome === 'Academy booked') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.academy_date || '')) throw new Error('Pick the BA Academy Day 1 date.');
    }
    const newDate = req.outcome === 'Academy booked' ? req.academy_date : '';
    if (newDate !== c.academy_date) c.academy_confirmed_at = '';   // new date → needs confirming again
    c.outcome = req.outcome;
    c.academy_date = newDate;
    if (newDate && !c.welcome_token) c.welcome_token = token().slice(0, 20);
    c.outcome_notes = String(req.outcome_notes || '').slice(0, 2000);
    c.outcome_by = u.name; c.outcome_at = nowStr();
    c.outcome_late = c.outcome_at > outcomeDeadline(c.attended_date) ? 'TRUE' : '';
    // RED from presenter (or a repeat block) → admin has the final say on an Academy booking.
    if (req.outcome === 'Academy booked' && (c.rag === 'R' || truthy(c.repeat_block))) {
      if (isAdmin(u)) { c.admin_status = 'approved'; c.admin_by = u.name; c.admin_at = nowStr(); }
      else if (c.admin_status !== 'approved') c.admin_status = 'pending';
    } else if (c.admin_status === 'pending') c.admin_status = '';
    const wasPending = c._wasPending;
    writeRow('Candidates', c);
    return { c: c, alert: c.admin_status === 'pending' && !wasPending };
  });
  const c = res.c;
  log(u, 'outcome', c.id, c.outcome + (c.outcome_late ? ' LATE' : ''));
  if (res.alert) {
    notify(usersAll().filter(isAdmin), '🔴 Decision needed: ' + c.full_name,
      c.booker_name + ' wants to book BA Academy, but the presenter marked RED or they were previously not suitable.', c.id);
  }
  return shape(c, u);
}

function adminDecision(req, u) {
  if (!isAdmin(u)) throw new Error('Admin only');
  return withLock(() => {
    const c = getC(req.id);
    if (['approved', 'rejected'].indexOf(req.decision) < 0) throw new Error('Bad decision');
    c.admin_status = req.decision; c.admin_note = String(req.note || '').slice(0, 500);
    c.admin_by = u.name; c.admin_at = nowStr();
    if (req.decision === 'rejected') { c.outcome = 'Not suitable'; c.academy_date = ''; }
    writeRow('Candidates', c);
    log(u, 'admin_' + req.decision, c.id, c.admin_note);
    return shape(c, u);
  });
}

function setPayExcluded(req, u) {
  if (!isAdmin(u)) throw new Error('Admin only');
  return withLock(() => {
    const c = getC(req.id);
    c.pay_excluded = req.excluded ? 'TRUE' : '';
    c.pay_excluded_reason = req.excluded ? String(req.reason || '').slice(0, 200) : '';
    writeRow('Candidates', c);
    log(u, 'pay_excluded', c.id, c.pay_excluded + ' ' + c.pay_excluded_reason);
    return shape(c, u);
  });
}

/** Admin: correct "18 or over" / right to work when a candidate tapped the wrong answer at check-in. */
function fixEligibility(req, u) {
  if (!isAdmin(u)) throw new Error('Admin only');
  if (['Yes', 'No'].indexOf(req.over18) < 0) throw new Error('Choose Yes or No for 18 or over');
  if (!RTW.some(r => r[0] === req.rtw)) throw new Error('Choose their right to work');
  return withLock(() => {
    const c = getC(req.id);
    const was = c.over18 + ' / ' + c.rtw;
    c.over18 = req.over18; c.rtw = req.rtw;
    c.visa_expiry = rtwLevel(req.rtw) === 'visa' ? String(req.visa_expiry || c.visa_expiry || '') : '';
    writeRow('Candidates', c);
    log(u, 'eligibility_fixed', c.id, was + ' → ' + c.over18 + ' / ' + c.rtw);
    return shape(c, u);
  });
}

function reassignBooker(req, u) {
  if (!isAdmin(u)) throw new Error('Admin only');
  return withLock(() => {
    const c = getC(req.id);
    const b = userById(req.booker_id);
    if (!b) throw new Error('Booker not found');
    const before = c.booker_name || c.booker_typed;
    c.booker_id = b.id; c.booker_name = b.name; c.company = b.company;
    writeRow('Candidates', c);
    log(u, 'reassign', c.id, before + ' → ' + b.name);
    return shape(c, u);
  });
}

/** { LINK: {id, name, email}, JUSS: {...} }: who sends each company's thank-you WhatsApp. */
function thanksTeam() {
  const out = {};
  Object.keys(CONFIG.THANKS_TEAM).forEach(co => {
    const email = String(CONFIG.THANKS_TEAM[co]).toLowerCase();
    const u = usersAll().filter(x => x.email.toLowerCase() === email && truthy(x.active))[0];
    out[co] = { id: u ? u.id : '', name: u ? u.name : '', email: email };
  });
  return out;
}
/** A candidate's company for the thank-you (no confirmed booker yet = LINK, like the message). */
function thanksCo(c) { return c.company === 'JUSS' ? 'JUSS' : 'LINK'; }

function markSent(req, u) {
  return withLock(() => {
    const c = getC(req.id);
    if (!canSee(u, c)) throw new Error('No access');
    if (req.kind === 'thanks') {
      const t = thanksTeam()[thanksCo(c)];
      if (!t || t.id !== u.id) throw new Error('Thank-you messages are sent by ' + ((t && t.name) || 'the recruitment team') + '.');
      c.thanks_sent_at = nowStr(); c.thanks_by = u.name;
    }
    if (req.kind === 'offer') c.offer_sent_at = nowStr();
    writeRow('Candidates', c);
    log(u, 'whatsapp_' + req.kind, c.id, '');
    return { ok: true };
  });
}

/** Weekly recruitment incentive: net attended per booker, Mon–Fri. Bookers see only their own row.
 *  Admins aren't on it (they don't earn it): people they booked are left off, not "no booker". */
function payReport(req, u) {
  const we = req.weekEnding || weekEnding(todayStr());
  const rows = readTable('Candidates').filter(c => c.week_ending === we);
  const by = {}, admin = {};
  usersAll().forEach(b => {
    if (isAdmin(b)) { admin[b.id] = true; return; }
    if (!has(b, 'booker')) return;
    by[b.id] = { booker_id: b.id, name: b.name, company: b.company, active: truthy(b.active) && earnsIncentive(b),
      attended: 0, net: 0, excluded: [], outcomes: 0, late: 0, missing: 0 };
  });
  const unassigned = [];
  rows.forEach(c => {
    if (admin[c.booker_id]) return;
    if (!c.booker_id || !by[c.booker_id]) { unassigned.push({ id: c.id, name: c.full_name, typed: c.booker_typed }); return; }
    const r = by[c.booker_id];
    r.attended++;
    const why = payExclusion(c);
    if (why) r.excluded.push({ id: c.id, name: c.full_name, why: why }); else r.net++;
    if (c.outcome) { r.outcomes++; if (truthy(c.outcome_late)) r.late++; } else if (!nonQualifier(c)) r.missing++;
  });
  let list = Object.keys(by).map(k => by[k]).filter(r => r.attended > 0 || r.active);
  if (!isAdmin(u)) list = list.filter(r => r.booker_id === u.id);
  list.sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));
  return {
    weekEnding: we, deadline: outcomeDeadline(addDays(we, -6)),
    target: CONFIG.PAY_TARGET, rows: list, unassigned: isAdmin(u) ? unassigned : [],
  };
}

function listUsers(req, u) {
  if (!isAdmin(u)) {
    // Non-admins only need the booker list (for nothing sensitive): names only.
    return { users: [] };
  }
  return { users: usersAll().map(publicUser).sort((a, b) => a.name.localeCompare(b.name)) };
}

function saveUser(req, u) {
  if (!isAdmin(u)) throw new Error('Admin only');
  const x = req.user || {};
  const email = String(x.email || '').trim().toLowerCase();
  if (!String(x.name || '').trim()) throw new Error('Name required');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Valid email required');
  if (['LINK', 'JUSS'].indexOf(x.company) < 0) throw new Error('Company must be LINK or JUSS');
  const roles = (x.roles || []).filter(r => ['admin', 'presenter', 'booker'].indexOf(r) >= 0);
  if (!roles.length) throw new Error('Pick at least one role');
  return withLock(() => {
    const all = readTable('Users');
    if (all.some(o => o.email.toLowerCase() === email && o.id !== x.id)) throw new Error('That email is already used.');
    let rec = x.id ? all.filter(o => o.id === x.id)[0] : null;
    if (x.id && !rec) throw new Error('User not found');
    if (rec && rec.id === u.id && (roles.indexOf('admin') < 0 || !x.active)) throw new Error("You can't remove your own admin access.");
    if (!rec) rec = { id: uid(), created_at: nowStr() };
    rec.name = cleanName(x.name); rec.email = email; rec.company = x.company;
    rec.roles = roles.join(','); rec.active = x.active ? 'TRUE' : '';
    rec._row ? writeRow('Users', rec) : appendRow('Users', rec);
    usersChanged();
    log(u, 'user_save', '', rec.name + ' ' + rec.roles + ' active=' + rec.active);
    return publicUser(rec);
  });
}

/** Delete a user outright. If they still own candidates, switch them off instead (keeps pay history intact). */
function deleteUser(req, u) {
  if (!isAdmin(u)) throw new Error('Admin only');
  if (req.id === u.id) throw new Error("You can't delete yourself.");
  return withLock(() => {
    delete MEMO.Users;
    const rec = readTable('Users').filter(o => o.id === req.id)[0];
    if (!rec) throw new Error('User not found');
    const owns = readTable('Candidates').some(c => c.booker_id === rec.id);
    if (owns) {
      rec.active = ''; writeRow('Users', rec); usersChanged();
      log(u, 'user_deactivate', '', rec.name + ' (has candidates)');
      return { deleted: false, deactivated: true };
    }
    sheet('Users').deleteRow(rec._row);
    usersChanged();
    log(u, 'user_delete', '', rec.name);
    return { deleted: true };
  });
}

const PUBLIC_ACTIONS = {
  publicConfig: publicConfig, checkin: checkin, candidateStatus: candidateStatus,
  resumeByMobile: resumeByMobile, submitEval: submitEval, myEval: myEval, requestCode: requestCode, verifyCode: verifyCode,
  welcomeInfo: welcomeInfo, confirmAcademy: confirmAcademy,
};
const STAFF_ACTIONS = {
  me: me, bundle: bundle, listDay: listDay, listWeek: listWeek, search: search, getCandidate: getCandidate,
  saveNotes: saveNotes, markInRoom: markInRoom, saveOutcome: saveOutcome,
  adminDecision: adminDecision, setPayExcluded: setPayExcluded, fixEligibility: fixEligibility, reassignBooker: reassignBooker,
  markSent: markSent, payReport: payReport, listUsers: listUsers, saveUser: saveUser, deleteUser: deleteUser,
};

// ───────────────────────── LINKS ─────────────────────────
function scriptUrl() { return ScriptApp.getService().getUrl(); }
/** Candidate-facing pages: the static QR codes on the slides point here. */
function publicLink(page) {
  if (CONFIG.PUBLIC_URL) return CONFIG.PUBLIC_URL + page + '.html';
  return scriptUrl() + (page === 'checkin' ? '' : '?go=' + page);
}
function staffUrl(cid) {
  if (CONFIG.PUBLIC_URL) return CONFIG.PUBLIC_URL + (cid ? '?c=' + cid : '');
  return scriptUrl() + '?app=staff' + (cid ? '&c=' + cid : '');
}
function welcomeUrl(c) {
  if (CONFIG.PUBLIC_URL) return CONFIG.PUBLIC_URL + 'welcome-' + (c.company === 'JUSS' ? 'juss' : 'link') + '.html?t=' + c.welcome_token;
  return scriptUrl() + '?go=welcome&t=' + c.welcome_token;
}

// ───────────────────────── ALERTS: phone push (OneSignal, free) + optional email ─────────────────────────
function esc(s) { return String(s || '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
function mail(to, subject, html) {
  try { MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, name: CONFIG.APP_NAME }); } catch (e) { console.error(e); }
}
function pushKeys() {
  const p = PropertiesService.getScriptProperties();
  const app = p.getProperty('ONESIGNAL_APP_ID'), key = p.getProperty('ONESIGNAL_API_KEY');
  return app && key ? { app: app, key: key } : null;
}

/** Push notification to staff users' phones. Each user is identified in OneSignal by their app user id.
 *  Returns the ids it actually reached: someone who hasn't turned alerts on in the app isn't reached. */
function pushTo(userIds, title, body, url) {
  const k = pushKeys();
  if (!k || !userIds.length) return [];
  const send = scheme => UrlFetchApp.fetchAll(userIds.map(id => ({
    url: 'https://api.onesignal.com/notifications?c=push',
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: scheme + k.key },
    payload: JSON.stringify({
      app_id: k.app, target_channel: 'push',
      include_aliases: { external_id: [id] },
      headings: { en: title }, contents: { en: body }, web_url: url,
    }),
  })));
  try {
    // New OneSignal keys use "Key", older ones "Basic".
    let res = send('Key ');
    if (res.every(r => r.getResponseCode() === 401 || r.getResponseCode() === 403)) res = send('Basic ');
    // OneSignal still answers 200 when that person has no phone subscribed, just with an empty id.
    return userIds.filter((id, i) => {
      const code = res[i].getResponseCode();
      if (code < 200 || code >= 300) return false;
      try { return !!JSON.parse(res[i].getContentText()).id; } catch (e) { return false; }
    });
  } catch (e) { console.error(e); return []; }
}

/** Send an alert: phone push when set up; email to anyone the push didn't reach (or everyone, if EMAIL_ALERTS is on). */
function notify(users, title, body, cid) {
  const list = users.filter(u => u && truthy(u.active));
  if (!list.length) return;
  const url = staffUrl(cid || '');
  const reached = pushTo(list.map(u => u.id), title, body, url);
  list.filter(u => CONFIG.EMAIL_ALERTS || reached.indexOf(u.id) < 0)
    .forEach(u => mail(u.email, title, '<p>' + esc(body).replace(/\n/g, '<br>') + '</p><p><a href="' + url + '">Open the app</a></p>'));
}

/** Wed + Fri 10:00 — recruitment incentive progress nudge to every active booker (not admins: they don't earn it). */
function weeklyProgressEmails() {
  const we = weekEnding(todayStr());
  const rows = readTable('Candidates').filter(c => c.week_ending === we);
  usersAll().filter(b => truthy(b.active) && earnsIncentive(b)).forEach(b => {
    const net = rows.filter(c => c.booker_id === b.id && !payExclusion(c)).length;
    const need = Math.max(0, CONFIG.PAY_TARGET - net);
    notify([b], need === 0 ? '🔥 ' + net + '/' + CONFIG.PAY_TARGET + ' — target smashed' : '⏳ ' + net + '/' + CONFIG.PAY_TARGET + ' net attended',
      need === 0 ? "You've hit your " + CONFIG.PAY_TARGET + ' this week. Keep going.' : need + ' more needed by Friday. Get them booked 💪', '');
  });
}

/** Sat 14:00 (existing trigger) — outcomes were due Friday 18:00: chase anything still missing. They show as LATE. */
function saturdayDeadlineEmails() {
  const we = weekEnding(todayStr());
  const rows = readTable('Candidates').filter(c => c.week_ending === we && truthy(c.in_room) && !c.outcome && !nonQualifier(c));
  usersAll().filter(b => truthy(b.active)).forEach(b => {
    const mine = rows.filter(c => c.booker_id === b.id);
    if (!mine.length) return;
    notify([b], '🔴 ' + mine.length + ' outcome' + (mine.length > 1 ? 's' : '') + ' LATE (due ' + deadlineLabel() + ')',
      mine.map(c => c.full_name).join(', ') + '. Log ' + (mine.length > 1 ? 'them' : 'it') + ' now: they\'re waiting to hear from us.', '');
  });
}

/** Mon 09:00 — last week's recruitment incentive summary to admins. (Name kept: the Monday trigger calls it.) */
function mondayPayReportEmail() {
  const lastWe = addDays(weekEnding(todayStr()), -7);
  const admins = usersAll().filter(x => isAdmin(x) && truthy(x.active));
  if (!admins.length) return;
  const rep = payReport({ weekEnding: lastWe }, admins[0]);
  const active = rep.rows.filter(r => r.attended > 0);
  const hit = active.filter(r => r.net >= rep.target).length;
  notify(admins, '💷 Recruitment incentive report — w/e ' + lastWe,
    hit + ' of ' + active.length + ' bookers hit ' + rep.target + ' net. ' + active.reduce((n, r) => n + r.late, 0) + ' late outcomes.' +
    (rep.unassigned.length ? ' ' + rep.unassigned.length + ' need a booker assigned.' : ''), '');
}

/** Every 5 minutes: keeps Google's copy of the app loaded so people don't wait for a cold start. */
function keepWarm() {
  const t = nowStr().slice(11, 13);
  if (t >= '07' && t <= '20') usersAll();
  maybeDailyDigest();
  maybeThanksReminder();
}

/** Every day at THANKS_TIME: Jess / Rubal get "N thank-you messages to send" for today's appointments not thanked yet.
 *  Nothing to send = no message. Tapping it opens their send list. */
function maybeThanksReminder() {
  const now = nowStr(), today = now.slice(0, 10), hm = now.slice(11, 16);
  if (hm < CONFIG.THANKS_TIME || hm > '20:59') return;
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('THANKS_REMINDED') === today) return;
  p.setProperty('THANKS_REMINDED', today);  // claim it first so an overlapping run can't send twice
  const rows = readTable('Candidates').filter(c => c.attended_date === today && !c.thanks_sent_at);
  const team = thanksTeam(), byUser = {};
  Object.keys(team).forEach(co => {
    const t = team[co]; if (!t.id) return;
    const mine = rows.filter(c => thanksCo(c) === co);
    if (mine.length) (byUser[t.id] = byUser[t.id] || []).push.apply(byUser[t.id], mine);
  });
  Object.keys(byUser).forEach(id => {
    const list = byUser[id], u = userById(id);
    notify([u], '💬 ' + plural(list.length, 'thank-you message') + ' to send',
      'Today\'s appointments: ' + firstNames(list, 4) + '. Tap to send them in one go.', 'thanks');
  });
}

/** Runs from keepWarm (every 5 min), so no extra trigger to install: one message a day, Mon–Thu at DIGEST_TIME, Friday at ROUNDUP_TIME. */
function maybeDailyDigest() {
  const now = nowStr(), today = now.slice(0, 10), wd = weekday(today), hm = now.slice(11, 16), fri = wd === 5;
  if (wd === 0 || wd === 6 || hm < (fri ? CONFIG.ROUNDUP_TIME : CONFIG.DIGEST_TIME) || hm > '20:59') return;
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('DIGEST_SENT') === today) return;
  p.setProperty('DIGEST_SENT', today);  // claim it first so an overlapping run can't send twice
  if (fri) weeklyRoundups(today); else dailyDigests(today);
}
function firstNames(list, max) {
  const f = list.map(c => c.full_name.split(' ')[0]);
  return f.slice(0, max || 4).join(', ') + (f.length > (max || 4) ? ' +' + (f.length - (max || 4)) : '');
}
function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

/** Mon–Thu 18:00: every booker with appointments gets their day (who came in, evaluations) and who still needs closing. */
function dailyDigests(today) {
  const rows = readTable('Candidates').filter(c => c.week_ending === weekEnding(today));
  usersAll().filter(u => truthy(u.active) && has(u, 'booker')).forEach(u => {
    const d = digestFor(u, rows, today);
    if (d) notify([u], d.title, d.body, '');
  });
}
function digestFor(u, rows, today) {
  const mine = rows.filter(c => c.booker_id === u.id);
  const names = list => firstNames(list, 3);
  const came = mine.filter(c => c.attended_date === today && truthy(c.in_room));
  const evals = mine.filter(c => c.attended_date === today && c.eval_at);
  // Still to close: in the room this week, no outcome yet (evaluated ones first: they're the hottest)
  const toClose = mine.filter(c => truthy(c.in_room) && !c.outcome && !nonQualifier(c)).sort((a, b) => (b.eval_at ? 1 : 0) - (a.eval_at ? 1 : 0));
  const toSend = mine.filter(c => c.outcome === 'Academy booked' && c.welcome_token && !c.offer_sent_at && c.admin_status !== 'pending' && c.admin_status !== 'rejected');
  const toConfirm = mine.filter(c => c.outcome === 'Academy booked' && c.offer_sent_at && !c.academy_confirmed_at);
  if (!came.length && !evals.length && !toClose.length && !toSend.length) return null;  // nothing to say: no message
  const net = mine.filter(c => !payExclusion(c)).length, target = CONFIG.PAY_TARGET;
  const day = 'Today: ' + came.length + ' in · ' + plural(evals.length, 'evaluation');
  const title = came.length || evals.length ? '📊 ' + day + (toClose.length ? ' · ' + toClose.length + ' to close' : '')
    : '📞 ' + toClose.length + ' still to close this week';
  const lines = [];
  if (toClose.length) lines.push('📞 Close: ' + names(toClose));
  if (toSend.length) lines.push('🎉 Send Day 1 details: ' + names(toSend));
  if (toConfirm.length) lines.push('⏳ Day 1 not confirmed yet: ' + names(toConfirm));
  if (!toClose.length && !toSend.length) lines.push('✅ All closed. Nice work.');
  if (!isAdmin(u)) lines.push('Week: ' + net + '/' + target + ' net attended');
  return { title: title, body: lines.join('\n') };
}

/** One booker's week (Mon–Fri, rated by the presenter): booked, not booked, no outcome yet, Day 1 WhatsApp sent or not. */
function weekStats(u, rows) {
  const mine = rows.filter(c => c.booker_id === u.id && truthy(c.in_room));
  const booked = mine.filter(c => c.outcome === 'Academy booked' && c.admin_status !== 'rejected');
  return {
    user: u, name: u.name, all: mine, booked: booked,
    notBooked: mine.filter(c => c.outcome && booked.indexOf(c) < 0),
    open: mine.filter(c => !c.outcome && !nonQualifier(c)),
    sent: booked.filter(c => c.offer_sent_at), unsent: booked.filter(c => !c.offer_sent_at),
    net: rows.filter(c => c.booker_id === u.id && !payExclusion(c)).length,
  };
}
/** Friday 15:00: each booker's week roundup, then the team roundup to admins. */
function weeklyRoundups(today) {
  const rows = readTable('Candidates').filter(c => c.week_ending === weekEnding(today));
  const users = usersAll().filter(u => truthy(u.active));
  const stats = users.filter(u => has(u, 'booker')).map(u => weekStats(u, rows)).filter(s => s.all.length);
  stats.forEach(s => { const r = roundupFor(s); notify([s.user], r.title, r.body, ''); });
  const admins = users.filter(isAdmin);
  if (CONFIG.TEAM_ROUNDUP && admins.length && stats.length) { const t = teamRoundup(stats); notify(admins, t.title, t.body, ''); }
}
function roundupFor(s) {
  const target = CONFIG.PAY_TARGET, lines = [];
  if (s.booked.length) lines.push('✅ Booked: ' + firstNames(s.booked));
  if (s.notBooked.length) lines.push('❌ Not booked: ' + firstNames(s.notBooked));
  if (s.open.length) lines.push('📞 No outcome yet: ' + firstNames(s.open) + ' (due ' + deadlineLabel() + ')');
  if (s.sent.length) lines.push('📲 Day 1 text sent: ' + firstNames(s.sent));
  if (s.unsent.length) lines.push('⚠️ Day 1 text NOT sent: ' + firstNames(s.unsent));
  if (!isAdmin(s.user)) lines.push('Net ' + s.net + '/' + target + (s.net >= target ? ' ✅ target hit 🔥' : ' · ' + (target - s.net) + ' short'));
  return { title: '🏁 Week roundup: ' + plural(s.all.length, 'appointment') + ' · ' + s.booked.length + ' booked', body: lines.join('\n') };
}
function teamRoundup(stats) {
  const sum = k => stats.reduce((n, s) => n + s[k].length, 0);
  const lines = [
    '✅ Booked ' + sum('booked') + ' · ❌ Not booked ' + sum('notBooked') + ' · 📞 No outcome ' + sum('open'),
    '📲 Day 1 texts sent ' + sum('sent') + '/' + sum('booked'),
  ];
  // Anyone with loose ends first, then the rest by appointments
  stats.slice().sort((a, b) => (b.open.length + b.unsent.length > 0) - (a.open.length + a.unsent.length > 0) || b.all.length - a.all.length).forEach(s => {
    const loose = s.open.length + s.unsent.length > 0;
    lines.push((loose ? '⚠️ ' : '') + s.name + ': ' + s.all.length + ' in · ' + s.booked.length + ' booked · ' + s.notBooked.length + ' not' +
      (s.open.length ? ' · ' + s.open.length + ' no outcome' : '') + ' · texts ' + s.sent.length + '/' + s.booked.length);
  });
  return { title: '📋 Team week: ' + sum('all') + ' appointments · ' + sum('booked') + ' booked', body: lines.join('\n') };
}

/** Daily 02:00 — GDPR, as promised on the check-in page: full details for 12 weeks, then only the basics,
 *  everything deleted after 6 months. Also tidies expired sessions/codes. */
function dailyMaintenance() {
  const today = todayStr(), cutoff = addDays(today, -CONFIG.RETENTION_DAYS), trim = addDays(today, -CONFIG.FULL_DETAILS_DAYS);
  withLock(() => {
    deleteWhere('Candidates', r => r.attended_date && r.attended_date < cutoff);
    deleteWhere('History', r => r.attended_date && r.attended_date < cutoff);
    deleteWhere('Sessions', r => r.expires < nowStr());
    deleteWhere('Codes', r => r.expires < nowStr());
    deleteWhere('Log', r => r.at.slice(0, 10) < cutoff);
    trimOldDetails(trim);
  });
}
/** After 12 weeks: keep name, contact, booker, result and what pay needs (to spot repeat applicants); wipe the rest,
 *  including evaluation answers (and the convictions answer), presenter notes and comments. */
const TRIM_FIELDS = ['resume_token', 'booker_typed', 'visa_expiry', 'rag', 'stars', 'tags', 'notes',
  'q1_excitement', 'q2_stood_out', 'q3_reason', 'q4_situation', 'q4_looking_for', 'q5_start_date', 'q6_days', 'q7_commute',
  'q8_resilience', 'q9_results_paid', 'q9_results_detail', 'q10_door', 'q11_coach', 'q12_bdp_stage', 'q12_bdp_why',
  'q13_unspent', 'q14_questions', 'outcome_notes', 'admin_note', 'welcome_token', 'p_why_sales', 'p_why_sales_note', 'p_interesting'];
function trimOldDetails(before) {
  let n = 0;
  readTable('Candidates').forEach(r => {
    if (!r.attended_date || r.attended_date >= before || !TRIM_FIELDS.some(k => r[k])) return;
    TRIM_FIELDS.forEach(k => { r[k] = ''; });
    writeRow('Candidates', r); n++;
  });
  return n;
}
function deleteWhere(name, pred) {
  const rows = readTable(name).filter(pred).map(r => r._row).sort((a, b) => b - a);
  const sh = sheet(name);
  // Delete runs of neighbouring rows in one go (an old history import can be a block of 1,000+ rows)
  for (let i = 0; i < rows.length;) {
    let j = i; while (j + 1 < rows.length && rows[j + 1] === rows[j] - 1) j++;
    sh.deleteRows(rows[j], j - i + 1);
    i = j + 1;
  }
  delete MEMO[name];
  return rows.length;
}

// ───────────────────────── ONE-OFF SETUP (run from editor) ─────────────────────────
/** Creates the tabs, your admin account and the scheduled alerts. Safe to run again. */
function setup() {
  const book = CONFIG.SHEET_ID ? SpreadsheetApp.openById(CONFIG.SHEET_ID) : SpreadsheetApp.getActive();
  if (!book) throw new Error('Set CONFIG.SHEET_ID to the ID of the data Sheet.');
  PropertiesService.getScriptProperties().setProperty('SS_ID', book.getId());
  Object.keys(SHEETS).forEach(name => {
    let sh = book.getSheetByName(name);
    if (!sh) sh = book.insertSheet(name);
    const cols = SHEETS[name];
    ensureCols(sh, cols.length, name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@'); // keep phone numbers & dates as text
  });
  ['Sheet1', 'Sheet 1'].forEach(n => { const s = book.getSheetByName(n); if (s && book.getSheets().length > 1) book.deleteSheet(s); });

  usersChanged();
  const existing = readTable('Users').map(u => u.email.toLowerCase());
  ADMINS.forEach(a => {
    if (existing.indexOf(a.email) < 0) {
      appendRow('Users', { id: uid(), name: a.name, email: a.email, company: a.company, roles: 'admin', active: 'TRUE', created_at: nowStr() });
    }
  });
  usersChanged();
  const email = ADMINS.map(a => a.email).join(', ');

  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('weeklyProgressEmails').timeBased().onWeekDay(ScriptApp.WeekDay.WEDNESDAY).atHour(10).inTimezone(CONFIG.TZ).create();
  ScriptApp.newTrigger('weeklyProgressEmails').timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(10).inTimezone(CONFIG.TZ).create();
  ScriptApp.newTrigger('saturdayDeadlineEmails').timeBased().onWeekDay(ScriptApp.WeekDay.SATURDAY).atHour(14).inTimezone(CONFIG.TZ).create();
  ScriptApp.newTrigger('mondayPayReportEmail').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).inTimezone(CONFIG.TZ).create();
  ScriptApp.newTrigger('dailyMaintenance').timeBased().everyDays(1).atHour(2).inTimezone(CONFIG.TZ).create();
  ScriptApp.newTrigger('keepWarm').timeBased().everyMinutes(5).create();
  return 'Setup complete. Admin: ' + email;
}

/**
 * Imports the last 6 months of the old Google Form sheet into the History tab,
 * so repeat candidates are spotted from day one. Run once from the editor.
 */
function importHistory() {
  const src = SpreadsheetApp.openById(CONFIG.HISTORY_SOURCE_ID).getSheetByName(CONFIG.HISTORY_SOURCE_TAB);
  const values = src.getDataRange().getValues();
  const head = values.shift().map(h => String(h).toLowerCase());
  const col = re => head.findIndex(h => re.test(h));
  const iName = col(/full name/), iPhone = col(/phone/), iEmail = col(/email/), iBooker = col(/booked you/), iPres = col(/presentation run by/);
  const cutoff = addDays(todayStr(), -CONFIG.RETENTION_DAYS);
  const out = [];
  values.forEach(r => {
    const ts = r[0];
    if (!(ts instanceof Date)) return;
    const d = Utilities.formatDate(ts, CONFIG.TZ, 'yyyy-MM-dd');
    if (d < cutoff) return;
    out.push([d, cleanName(r[iName]), normMobile(r[iPhone]), String(r[iEmail] || '').trim().toLowerCase(),
      String(r[iBooker] || '').trim(), String(r[iPres] || '').trim()]);
  });
  const h = sheet('History');
  if (h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, SHEETS.History.length).clearContent();
  ensureRows(h, out.length + 1, SHEETS.History.length);
  if (out.length) h.getRange(2, 1, out.length, SHEETS.History.length).setValues(out);
  return 'Imported ' + out.length + ' rows from the last 6 months.';
}
