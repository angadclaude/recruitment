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
  THANKS_TEAM: { LINK: 'jess@linkmarketing.org.uk', JUSS: 'rubal@jussmarketing.co.uk' },  // recruitment team: thank-yous (either can send LINK or JUSS) + non-qualifier alerts
  // Also on the recruitment team (they work for both companies): send thank-yous, congratulations and welcome emails for either one,
  // choosing LINK or JUSS before they send. Jess and Rubal (above) are always on it and keep their reminders.
  RECRUIT_TEAM: ['recruitment@jussmarketing.co.uk'],  // Fiza
  THANKS_TIME: '12:00',           // every day: "N thank-you messages to send" to Jess / Rubal (only if there are any)
  DAY1_REMIND_TIME: '10:00',      // on a BA Academy Day 1: Jess / Rubal get "N starters to remind" (Day 1 tab → Send reminders)
  DIGEST_TIME: '18:00',           // Mon–Thu: each booker's round-up of their day
  ROUNDUP_TIME: '15:00',          // Friday: week roundup to each booker + a team roundup to admins
  TEAM_ROUNDUP: true,             // false = admins don't get the Friday team roundup
  CHASE_DAYS: 14,                 // Chase tab: appointments and no-shows from the last 2 weeks stay on it until they're dealt with
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

/** New starter onboarding (admins): Databyte, then the "Your Brand Ambassador Journey Begins!" email (Rubal's wording, LINK / JUSS). */
const ONBOARD = {
  DATABYTE_URL: 'https://uk.databyte.live/onboarding/dashboard/list',
  FIELDIQ_URL: 'https://www.tfo.group/fieldiqdownload',
  LINK: {
    brand: 'Link Marketing', colour: '#F3901D', phone: '073110 27272 / 074789 60080', maps: 'https://maps.app.goo.gl/2wmckhXokt3KhCyE9', day3: true,
    preCoaching: ['Link Marketing BA Academy - Pre Coaching Module - Fill in form', 'https://forms.office.com/pages/responsepage.aspx?id=QT4blMNFxEuaVSUMKK6uNT5ZuU1A_UdDsSk-r6KY6olUQ0JEWFU0NDU1MEI5REZZRzY3WEc1SEVaTC4u&route=shorturl'],
    client: ['NDCS', 'https://www.ndcs.org.uk/'], magazine: ['Link Magazine', 'https://linkmagflip-74ibv4pf.manus.space/'],
    playbook: ['Link FR Playbook', 'https://link-marketing-playbook.replit.app/'],
    from: 'jess@linkmarketing.org.uk',  // welcome emails only ever go from Jess's or Rubal's inbox (either can send either brand)
  },
  JUSS: {
    brand: 'JUSS Marketing', colour: '#E4613F', phone: '077823 77774', maps: 'https://maps.app.goo.gl/n2wTFyzScHLr1Voy9', day3: false,
    client: ['Hello Fresh', 'http://www.hellofresh.co.uk/'], website: ['JUSS Marketing', 'https://jussmarketing.co.uk/'], magazine: ['JUSS Magazine', 'https://jmomagazine-gjfukcw6.manus.space/'],
    playbook: ['JUSS HF Playbook', 'https://hf-playbook.replit.app/'],
    from: 'rubal@jussmarketing.co.uk',
  },
};

const SHEETS = {
  Users: ['id', 'name', 'email', 'company', 'roles', 'active', 'created_at', 'aliases'],
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
    'p_why_sales', 'p_why_sales_note', 'p_interesting', 'eval_edited_at', 'thanks_by', 'no_whatsapp', 'day1_status', 'day1_by', 'day1_at', 'day1_reminded_at', 'day1_reminded_by', 'recruit_source', 'databyte_at', 'databyte_by', 'onboard_email_at', 'onboard_email_by',
    'brand',  // LINK / JUSS: the company their messages and welcome email come from (chosen by the recruitment team), when it isn't their booker's
    'presented_by_id', 'presented_by',  // who ran the presentation, from their evaluation (a presenter on the team, a typed name, or "Not sure")
    'offer_by', 'offer_via', 'offer_co', 'thanks_via', 'thanks_co',  // the BA Academy Day 1 details / thank-you: who sent it, how (whatsapp / sms / email), as which company
    'outcome_log',  // every call outcome logged, oldest first: [{at, by, o: outcome, d: Day 1 date, late: 1, n: notes}]
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
  if (want) tidyHeaders(sh, name, headers, values);
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
/** Two people opening the app the moment a new version went live could both add its new columns: the second insert
 *  pushed the first copy along, so the same headers appeared twice (Candidates, 15 Oct: presented_by_id, presented_by).
 *  Clear a repeated header whose column is empty, and empty headers off the end, so new columns go in the right place. */
function tidyHeaders(sh, name, headers, values) {
  const empty = j => values.every(r => r[j] === '' || r[j] === null || r[j] === undefined);
  const dup = headers.map((h, j) => j).filter(j => headers[j] && headers.indexOf(headers[j]) < j && empty(j));
  dup.forEach(j => { sh.getRange(1, j + 1).clearContent(); headers[j] = ''; });
  if (dup.length) console.warn(name + ': cleared ' + dup.length + ' repeated empty column header(s)');
  while (headers.length && !headers[headers.length - 1] && empty(headers.length - 1)) headers.pop();
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
  // 20 spare: the next version's new columns then need no insert, so two people can't both insert them at once
  if (max < n) sh.insertColumnsAfter(max, n - max + 20);
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
/** The team, cached for 10 minutes. The cache key carries a version that changes whenever someone is added or edited,
 *  so a request that read the old list at that moment can't put it back (a new person could log in straight away). */
function usersAll() {
  if (MEMO._users) return MEMO._users;
  const cache = CacheService.getScriptCache();
  if (MEMO._usersVer === undefined) MEMO._usersVer = PropertiesService.getScriptProperties().getProperty('USERS_VER') || '0';
  const key = 'users_v3_' + MEMO._usersVer, hit = cache.get(key);
  if (hit) return (MEMO._users = JSON.parse(hit));
  const rows = readTable('Users');
  try { cache.put(key, JSON.stringify(rows), 600); } catch (e) { /* too big to cache: fine */ }
  return (MEMO._users = rows);
}
function usersChanged() {
  PropertiesService.getScriptProperties().setProperty('USERS_VER', String(Date.now()));
  delete MEMO.Users; delete MEMO._users; delete MEMO._usersVer;
}
function userById(id) { return usersAll().filter(u => u.id === id)[0]; }
function rolesOf(u) { return String(u.roles || '').split(',').map(s => s.trim()).filter(String); }
function has(u, role) { const r = rolesOf(u); return r.indexOf('admin') >= 0 || r.indexOf(role) >= 0; }
function isAdmin(u) { return rolesOf(u).indexOf('admin') >= 0; }
/** Recruitment incentive: bookers only. Admins can book people, but they don't earn it. */
function earnsIncentive(u) { return !isAdmin(u) && rolesOf(u).indexOf('booker') >= 0; }
function publicUser(u) { return { id: u.id, name: u.name, email: u.email, company: u.company, roles: rolesOf(u), active: truthy(u.active), aliases: aliasesOf(u) }; }

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

/** Emails are compared without spaces or invisible characters (copy-paste and phone keyboards add them). */
function normEmail(s) { return String(s || '').replace(/[\s\u200B-\u200D\uFEFF]/g, '').toLowerCase(); }
function codeLimitKey(email) { return 'codes_' + sha(email).slice(0, 20); }
/** A fresh 6-digit login code for this email (replaces any earlier one), valid 10 minutes. */
function issueCode(email) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  withLock(() => {
    const rows = readTable('Codes').filter(x => x.email === email);
    const rec = rows[0] || { email: email };
    rec.code_hash = sha(code + '|' + email);
    rec.expires = Utilities.formatDate(new Date(Date.now() + 10 * 60000), CONFIG.TZ, 'yyyy-MM-dd HH:mm');
    rec.attempts = '0';
    rec._row ? writeRow('Codes', rec) : appendRow('Codes', rec);
  });
  return code;
}
function requestCode(req) {
  const email = normEmail(req.email);
  const cache = CacheService.getScriptCache(), rk = codeLimitKey(email), n = Number(cache.get(rk) || 0);
  if (n >= 5) {
    log(null, 'login_code', '', email + ' · limit reached');
    throw new Error('That\'s 5 codes in 15 minutes. Check Spam/Junk for the newest one, or ask Angad, Jess, Satpal or Rubal to show you a code in the app (Team → your name → 🔑).');
  }
  cache.put(rk, String(n + 1), 900);
  const u = usersAll().filter(x => normEmail(x.email) === email && truthy(x.active))[0];
  // Same response whether or not the email exists, so the list of staff can't be probed. The Log says which (admins only).
  log(null, 'login_code', '', email + (u ? ' · emailed' : ' · no active team member with this email'));
  if (!u) return { sent: true };
  const code = issueCode(email);
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

/** Admin: show a login code for someone on the admin's screen (no email needed: when their email is slow, in Spam, or they hit the limit). */
function adminCode(req, u) {
  if (!isAdmin(u)) throw new Error('Admin only');
  const x = usersAll().filter(o => o.id === req.id)[0];
  if (!x) throw new Error('Person not found');
  if (!x.email) throw new Error('Add their email first: it\'s what they log in with.');
  if (!truthy(x.active)) throw new Error('Tick "Has access" and save first.');
  const email = normEmail(x.email);
  CacheService.getScriptCache().remove(codeLimitKey(email));  // fresh start on the limit too
  const code = issueCode(email);
  log(u, 'admin_code', '', 'login code shown for ' + x.name);
  return { code: code, email: x.email, door: isAdmin(x) ? 'admin' : 'ba' };
}

function verifyCode(req) {
  const email = normEmail(req.email);
  const code = String(req.code || '').trim();
  return withLock(() => {
    const rec = readTable('Codes').filter(x => x.email === email)[0];
    if (!rec || rec.expires < nowStr()) throw new Error("That code isn't right or has expired. Check the latest email, or request a new code.");
    if (Number(rec.attempts) >= 5) throw new Error('Too many attempts — request a new code.');
    if (rec.code_hash !== sha(code + '|' + email)) {
      rec.attempts = String(Number(rec.attempts) + 1); writeRow('Codes', rec);
      throw new Error("That code isn't right or has expired. Check the latest email, or request a new code.");
    }
    const u = usersAll().filter(x => normEmail(x.email) === email && truthy(x.active))[0];
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
    .map(u => ({ id: u.id, name: u.name, company: u.company, aliases: aliasesOf(u) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // For "Who ran today's presentation?" on the evaluation: everyone with the Presenter role
  const presenters = usersAll().filter(u => truthy(u.active) && rolesOf(u).indexOf('presenter') >= 0)  // not admins: tick Presenter on anyone who presents
    .map(u => ({ id: u.id, name: u.name })).sort((a, b) => a.name.localeCompare(b.name));
  return { today: todayStr(), bookers: bookers, presenters: presenters, rtw: RTW.map(r => ({ label: r[0], level: r[1] })) };
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
  let booker = f.booker_id ? userById(f.booker_id) : null;
  // Typed rather than picked ("Daniel Thompson", "Skye Promotions", "Hasini"): credit the booker it clearly means
  const auto = !booker && f.booker_typed ? matchBooker(f.booker_typed) : null;
  if (auto) booker = auto;
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
  if (res.isNew && auto) log(null, 'auto_booker', res.c.id, '"' + res.c.booker_typed + '" → ' + auto.name);
  const nq = nonQualifier(res.c);
  if (res.isNew && nq) {
    // Straight to Jess + Rubal and the booker, so someone speaks to them before they leave
    const ids = [thanksTeam().LINK.id, thanksTeam().JUSS.id, booker ? booker.id : ''].filter(Boolean);
    notify(usersAll().filter(u => ids.indexOf(u.id) >= 0), '⛔ Non-qualifier checked in: ' + name,
      nq + ' · ' + (booker ? 'booked by ' + booker.name : 'booker not confirmed' + (res.c.booker_typed ? ' ("' + res.c.booker_typed + '")' : '')) +
      '. No evaluation form for them. Have a word before they leave.', res.c.id);
  } else if (res.isNew && booker) {
    notify([booker], '🙌 ' + name.split(' ')[0] + ' just checked in', name + ' is in the room for your appointment.', res.c.id);
  } else if (res.isNew) {
    // Nobody to tell: no booker = no check-in or evaluation alert and nobody calls them. Jess + Rubal pick a booker.
    const ids = [thanksTeam().LINK.id, thanksTeam().JUSS.id].filter(Boolean);
    notify(usersAll().filter(u => ids.indexOf(u.id) >= 0), '❓ No booker: ' + name + ' just checked in',
      (res.c.booker_typed ? 'They typed "' + res.c.booker_typed + '" (not on the team list).' : 'They didn\'t say who booked them.') +
      ' Tap to set the booker, so someone gets their evaluation and calls them.', res.c.id);
  }
  return { id: res.c.id, resume: res.c.resume_token, first_name: res.c.full_name.split(' ')[0], company: res.c.brand || res.c.company || '', evalDone: !!res.c.eval_at, nonQual: !!nq };
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
  return { first_name: c.full_name.split(' ')[0], company: c.brand || c.company || '', attended_date: c.attended_date, today: todayStr(), evalDone: !!c.eval_at, canEdit: canEditEval(c), nonQual: !!nonQualifier(c) };
}
/** A candidate can change their answers the same day, until their booker has logged the call outcome. */
function canEditEval(c) { return !!c.eval_at && c.attended_date === todayStr() && !c.outcome; }
/** Their own answers, to change them (same day, before the outcome). */
function myEval(req) {
  const c = candidateByResume(req);
  if (!canEditEval(c)) throw new Error("Your answers can't be changed now. Speak to the person who booked you in.");
  const a = {}; EVAL_FIELDS.forEach(k => { a[k] = c[k]; });
  // Who ran the presentation, as they answered it
  a.q0_presenter = c.presented_by_id || (c.presented_by === 'Not sure' ? 'Not sure' : c.presented_by ? 'Someone else' : '');
  a.q0_presenter_other = !c.presented_by_id && c.presented_by && c.presented_by !== 'Not sure' && c.presented_by !== 'Someone else' ? c.presented_by : '';
  return { answers: a };
}
/** "Who ran today's presentation?": a presenter on the team (their id), "Someone else" (+ the name they typed) or "Not sure". null = not asked. */
function presenterAnswer(a) {
  const v = String(a.q0_presenter || '').trim();
  if (!v) return null;
  if (v === 'Not sure') return { id: '', name: 'Not sure' };
  if (v === 'Someone else') return { id: '', name: cleanName(String(a.q0_presenter_other || '').slice(0, 60)) || 'Someone else' };
  const u = userById(v);
  return u ? { id: u.id, name: u.name } : { id: '', name: 'Not sure' };
}

/** Evaluation QR on a different phone/page: find today's check-in by mobile number. */
function resumeByMobile(req) {
  const m = normMobile(req.mobile);
  if (!m) throw new Error('Please enter a valid UK mobile number (07…).');
  const c = readTable('Candidates').filter(x => x.mobile === m && x.attended_date === todayStr())[0];
  if (!c) return { found: false };
  return { found: true, id: c.id, resume: c.resume_token, first_name: c.full_name.split(' ')[0], company: c.brand || c.company || '', evalDone: !!c.eval_at, canEdit: canEditEval(c), nonQual: !!nonQualifier(c) };
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
    const pres = presenterAnswer(a);
    if (pres) { c.presented_by_id = pres.id; c.presented_by = pres.name; }
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
    first_name: c.full_name.split(' ')[0], company: brandCo(c), academy_date: c.academy_date,
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
  if (fullAccess(u, c)) return true;
  if (has(u, 'presenter') && (c.attended_date === todayStr() || c.presenter_id === u.id)) return true;
  return false;
}
/** Everything about a candidate: admins, and the person who booked them. Nobody else. */
function fullAccess(u, c) { return isAdmin(u) || c.booker_id === u.id; }
/** A presenter's view of someone else's candidate: only what's needed to rate the room.
 *  No evaluation answers, outcome, contact details, eligibility or who booked them. */
const ROOM_FIELDS = ['id', 'created_at', 'attended_date', 'week_ending', 'full_name', 'company', 'in_room', 'rag', 'stars', 'tags', 'notes',
  'presenter_id', 'presenter_name', 'notes_at', 'p_why_sales', 'p_why_sales_note', 'p_interesting'];
function roomShape(c) {
  const o = { limited: true, flags: [], first_name: c.full_name.split(' ')[0], eval_at: c.eval_at ? 'yes' : '' };  // eval_at: for the day's count only
  ROOM_FIELDS.forEach(k => { o[k] = c[k]; });
  return o;
}
function shape(c, u) {
  if (!fullAccess(u, c)) return roomShape(c);
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
  if (isAdmin(u)) o.recruit_source = recruitSourceOf(c);
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
    recruitTeam: recruitTeam(),
    welcomeFrom: isAdmin(u) ? welcomeFromInfo(u) : null,
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
  out.chase = chaseRows(u).length;  // the number on the Chase tab
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
    if (!canSee(u, c)) throw new Error('No access');
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
    c._wasBooked = c.outcome === 'Academy booked' && c.admin_status !== 'pending';
    const newDate = req.outcome === 'Academy booked' ? req.academy_date : '';
    if (newDate !== c.academy_date) { c.academy_confirmed_at = ''; c.day1_status = ''; c.day1_by = ''; c.day1_at = ''; }  // new date (e.g. rebooking a no-show) → confirm + mark again
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
    const wasPending = c._wasPending, wasBooked = c._wasBooked;
    addOutcomeLog(c, { at: c.outcome_at, by: u.name, o: c.outcome, d: c.academy_date, late: c.outcome_late ? 1 : 0, n: c.outcome_notes });
    writeRow('Candidates', c);
    return { c: c, alert: c.admin_status === 'pending' && !wasPending, starter: c.outcome === 'Academy booked' && c.admin_status !== 'pending' && !wasBooked };
  });
  const c = res.c;
  if (res.starter) newStarterAlert(c);
  log(u, 'outcome', c.id, c.outcome + (c.outcome_late ? ' LATE' : ''));
  if (res.alert) {
    notify(usersAll().filter(isAdmin), '🔴 Decision needed: ' + c.full_name,
      c.booker_name + ' wants to book BA Academy, but the presenter marked RED or they were previously not suitable.', c.id);
  }
  return shape(c, u);
}

/** Every response logged on the call (No answer, Thinking it over, Academy booked…), who and when: outcome / outcome_at only keep the latest. */
function addOutcomeLog(c, e) {
  let l = []; try { l = JSON.parse(c.outcome_log || '[]'); } catch (x) { l = []; }
  const o = {}; Object.keys(e).forEach(k => { if (e[k]) o[k] = k === 'n' ? String(e[k]).slice(0, 300) : e[k]; });
  l.push(o); c.outcome_log = JSON.stringify(l.slice(-30));
}
function adminDecision(req, u) {
  if (!isAdmin(u)) throw new Error('Admin only');
  const c = withLock(() => {
    const c = getC(req.id);
    if (['approved', 'rejected'].indexOf(req.decision) < 0) throw new Error('Bad decision');
    c.admin_status = req.decision; c.admin_note = String(req.note || '').slice(0, 500);
    c.admin_by = u.name; c.admin_at = nowStr();
    if (req.decision === 'rejected') {
      c.outcome = 'Not suitable'; c.academy_date = '';
      addOutcomeLog(c, { at: c.admin_at, by: u.name, o: 'Not suitable', n: 'Academy booking rejected' + (c.admin_note ? ': ' + c.admin_note : '') });
    }
    writeRow('Candidates', c);
    log(u, 'admin_' + req.decision, c.id, c.admin_note);
    return c;
  });
  if (req.decision === 'approved' && onboardable(c)) newStarterAlert(c);  // approved = a new starter to onboard
  return shape(c, u);
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
    if (c.booker_id === b.id) return shape(c, u);
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
/** The recruitment team: Jess, Rubal (THANKS_TEAM) + RECRUIT_TEAM (Fiza). Any of them thanks / congratulates anyone, as LINK or JUSS. */
function recruitTeam() {
  const emails = Object.keys(CONFIG.THANKS_TEAM).map(k => CONFIG.THANKS_TEAM[k]).concat(CONFIG.RECRUIT_TEAM || []).map(e => String(e).toLowerCase());
  return usersAll().filter(x => truthy(x.active) && emails.indexOf(String(x.email).toLowerCase()) >= 0)
    .map(x => ({ id: x.id, name: x.name, email: String(x.email).toLowerCase() }));
}
function onRecruitTeam(u) { return !!u && recruitTeam().some(t => t.id === u.id); }
/** The company their messages, welcome page and welcome email come from: the one the recruitment team chose, else their booker's.
 *  (Pay, lists and reminders always follow the booker's company.) pick: a choice made just now, not saved yet. */
function brandCo(c, pick) {
  const b = pick === 'LINK' || pick === 'JUSS' ? pick : c.brand;
  return b === 'LINK' || b === 'JUSS' ? b : (c.company === 'JUSS' ? 'JUSS' : 'LINK');
}
/** "Jess Grace, Rubal Oshan or Fiza Iqbal" */
function orList(a) { return a.length > 1 ? a.slice(0, -1).join(', ') + ' or ' + a[a.length - 1] : (a[0] || ''); }
/** Jess / Rubal / Fiza: send this person's messages as LINK or JUSS. Saved, so everything after follows it. */
function setBrand(req, u) {
  if (!onRecruitTeam(u)) throw new Error('Only the recruitment team choose the company.');
  if (req.co !== 'LINK' && req.co !== 'JUSS') throw new Error('Choose LINK or JUSS.');
  return withLock(() => {
    const c = getC(req.id);
    if (!fullAccess(u, c)) throw new Error('No access');
    if (c.brand !== req.co) { c.brand = req.co; writeRow('Candidates', c); log(u, 'brand', c.id, req.co); }
    return shape(c, u);
  });
}

/** A WhatsApp / text / email message was opened. kind: thanks · offer · noanswer. via: whatsapp (default) · sms · email.
 *  Sending by text or email means they're not on WhatsApp: remembered, so the next message goes by text too. */
function markSent(req, u) {
  const via = ['sms', 'email'].indexOf(req.via) >= 0 ? req.via : 'whatsapp';
  if (['thanks', 'offer', 'noanswer', 'day1'].indexOf(req.kind) < 0) throw new Error('Unknown message');
  return withLock(() => {
    const c = getC(req.id);
    if (!fullAccess(u, c)) throw new Error('No access');
    // The company they chose as they sent it (thank-you or congratulations): everything after follows it
    if ((req.co === 'LINK' || req.co === 'JUSS') && onRecruitTeam(u)) c.brand = req.co;
    if (req.kind === 'thanks') {
      // The recruitment team (Jess, Rubal, Fiza) can each send any thank-you, LINK or JUSS (signed with their own name)
      if (!onRecruitTeam(u)) throw new Error('Thank-you messages are sent by ' + (orList(recruitTeam().map(t => t.name)) || 'the recruitment team') + '.');
      c.thanks_sent_at = nowStr(); c.thanks_by = u.name; c.thanks_via = via; c.thanks_co = brandCo(c);
    }
    // Who sent the BA Academy Day 1 details, when, how and as which company (the latest send)
    if (req.kind === 'offer') { c.offer_sent_at = nowStr(); c.offer_by = u.name; c.offer_via = via; c.offer_co = brandCo(c); }
    if (req.kind === 'day1') { c.day1_reminded_at = nowStr(); c.day1_reminded_by = u.name; }
    if (via !== 'whatsapp') c.no_whatsapp = 'TRUE';
    writeRow('Candidates', c);
    log(u, via + '_' + req.kind, c.id, '');
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

/** Email is optional: a booker added by name only ("not in the app yet") is credited on the bulletin and incentive
 *  straight away, and logs in once you add their email. Check-ins where the candidate typed their name get linked. */
function saveUser(req, u) {
  if (!isAdmin(u)) throw new Error('Admin only');
  const x = req.user || {};
  const email = String(x.email || '').trim().toLowerCase();
  if (!String(x.name || '').trim()) throw new Error('Name required');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('That email doesn\'t look right.');
  if (['LINK', 'JUSS'].indexOf(x.company) < 0) throw new Error('Company must be LINK or JUSS');
  const roles = (x.roles || []).filter(r => ['admin', 'presenter', 'booker'].indexOf(r) >= 0);
  if (!roles.length) throw new Error('Pick at least one role');
  if (!email && roles.indexOf('booker') < 0) throw new Error('Add their email: only bookers can be added by name alone.');
  const isNew = !x.id;
  let oldEmail = '';
  const saved = withLock(() => {
    const all = readTable('Users');
    if (email && all.some(o => o.email.toLowerCase() === email && o.id !== x.id)) throw new Error('That email is already used.');
    if (isNew && all.some(o => normName(o.name) === normName(x.name))) throw new Error(cleanName(x.name) + ' is already on the team. Tap their name to edit them.');
    // "Ali Abass" when "Ali Abbas" (or "Ramis - Ali Abbas") is already there = the same person twice, splitting their credit
    const sim = isNew && !req.allowSimilar ? similarUser(x.name, all) : null;
    if (sim) throw new Error('SIMILAR|' + sim.u.id + '|' + sim.u.name + '|' + sim.u.company + '|' + (sim.via || ''));
    let rec = x.id ? all.filter(o => o.id === x.id)[0] : null;
    if (x.id && !rec) throw new Error('User not found');
    oldEmail = rec ? normEmail(rec.email) : '';
    const renamed = rec && rec.name !== cleanName(x.name);
    if (rec && rec.id === u.id && (roles.indexOf('admin') < 0 || !x.active)) throw new Error("You can't remove your own admin access.");
    if (!rec) rec = { id: uid(), created_at: nowStr() };
    if (x.aliases !== undefined) rec.aliases = checkAliases(x.aliases, rec, x.name, all);
    else rec.aliases = rec.aliases || '';
    rec.name = cleanName(x.name); rec.email = email; rec.company = x.company;
    rec.roles = roles.join(','); rec.active = x.active ? 'TRUE' : '';
    rec._row ? writeRow('Users', rec) : appendRow('Users', rec);
    usersChanged();
    // Renamed: their candidates show the new name too
    if (renamed) readTable('Candidates').filter(c => c.booker_id === rec.id && c.booker_name !== rec.name).forEach(c => { c.booker_name = rec.name; writeRow('Candidates', c); });
    log(u, 'user_save', '', rec.name + ' ' + rec.roles + ' active=' + rec.active + (rec.aliases ? ' · other names: ' + rec.aliases : ''));
    return publicUser(rec);
  });
  // New person, email just added, or email corrected: the setup steps land in the (new) inbox
  if (saved.active && saved.email && normEmail(saved.email) !== oldEmail) sendSetupEmail(saved);
  const linked = saved.active && rolesOf(saved).indexOf('booker') >= 0 ? linkTypedBookings(saved, u) : 0;
  return Object.assign(saved, { linked: linked });
}

function normName(s) { return String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim(); }
// ── A booker's other names: what candidates might say booked them (a team member, their company) ──
/** Stored in Users.aliases as "Stones Recruitment | Daniel Thompson". */
function aliasesOf(u) {
  const seen = {};
  return String(u.aliases || '').split(/\n|\||;/).map(x => x.replace(/\s+/g, ' ').trim().slice(0, 60))
    .filter(x => { const k = normName(x); if (!k || seen[k]) return false; seen[k] = 1; return true; });
}
/** Every way to say it: their name, each other name, and each half of "Sophie - Skye Promotions". */
function bookerKeys(u) {
  const keys = [];
  [u.name].concat(aliasesOf(u)).forEach(a => {
    const k = normName(a); if (k && keys.indexOf(k) < 0) keys.push(k);
    String(a).split(/\s+-\s+|\s*[\/(),&]\s*/).forEach(p => { const q = normName(p); if (q && keys.indexOf(q) < 0) keys.push(q); });
  });
  return keys;
}
/** The booker a typed name clearly means, or null. Tried in order: exact ("Daniel Thompson", "MSA", "Amin"), inside what they
 *  typed ("Sophie from Skye Promotions"), first name ("Daniel"; "Amin Musa" → Amin), typo ("Linas Rakaukas"). Two bookers fit = nobody:
 *  Jess / Rubal get the "No booker" alert and pick. */
function matchBooker(typed) {
  const t = normName(typed); if (!t) return null;
  const tt = t.split(' '), w = k => k.split(' ');
  const people = usersAll().filter(u => truthy(u.active) && has(u, 'booker')).map(u => ({ u: u, keys: bookerKeys(u) }));
  const rules = [
    k => k === t,
    k => w(k).length >= 2 && w(k).every(x => tt.indexOf(x) >= 0),
    k => w(k)[0] === tt[0] && (tt.length === 1 || w(k).length === 1),
    k => Math.min(k.length, t.length) >= 6 && editDistance(k, t) <= 2,
  ];
  for (let i = 0; i < rules.length; i++) {
    const hit = people.filter(p => p.keys.some(rules[i]));
    if (hit.length === 1) return hit[0].u;
    if (hit.length > 1) return null;
  }
  return null;
}
/** Tidy the other names an admin typed; refuse one that already credits someone else (one name = one booker). */
function checkAliases(list, rec, name, all) {
  const raw = Array.isArray(list) ? list.join('\n') : String(list || '');
  const out = aliasesOf({ aliases: raw }).filter(a => normName(a) !== normName(name));
  if (out.length > 30) throw new Error('That\'s a lot of other names: 30 at most.');
  out.forEach(a => {
    const k = normName(a);
    all.filter(o => o.id !== rec.id && truthy(o.active)).forEach(o => {
      if (normName(o.name) === k) throw new Error('"' + a + '" is ' + o.name + ' on the team. One name can only credit one booker.');
      if (aliasesOf(o).some(x => normName(x) === k)) throw new Error('"' + a + '" is already one of ' + o.name + '\'s other names. One name can only credit one booker.');
    });
  });
  return out.join(' | ');
}
/** Someone already on the team with nearly the same name: a typo ("Ali Abass" / "Ali Abbas") or the same name
 *  inside a longer one ("Ali Abbas" / "Ramis - Ali Abbas"). Exact matches are caught before this. */
function similarUser(name, all) {
  const a = normName(name), at = a.split(' ');
  const al = all.filter(o => aliasesOf(o).some(x => normName(x) === a))[0];
  if (al) return { u: al, via: aliasesOf(al).filter(x => normName(x) === a)[0] };
  const near = all.filter(o => {
    const b = normName(o.name), bt = b.split(' ');
    if (!b || a === b) return false;
    const short = at.length <= bt.length ? at : bt, long = short === at ? bt : at;
    if (short.length >= 2 && short.every(t => long.indexOf(t) >= 0)) return true;
    return Math.min(a.length, b.length) >= 6 && editDistance(a, b) <= 2;
  })[0];
  return near ? { u: near, via: '' } : null;
}
function editDistance(a, b) {
  let prev = []; for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
/** Check-ins from the last 14 days with no booker, where the candidate typed this person's name (full name, or first name
 *  when nobody else on the team shares it): credit them to this booker. Returns how many were linked. */
function linkTypedBookings(b, u) {
  const since = addDays(todayStr(), -14), memo = {};
  const match = c => {
    if (c.booker_id || c.attended_date < since || !normName(c.booker_typed)) return false;
    const k = normName(c.booker_typed);
    if (!(k in memo)) { const m = matchBooker(c.booker_typed); memo[k] = m ? m.id : ''; }
    return memo[k] === b.id;
  };
  if (!readTable('Candidates').some(match)) return 0;
  const n = withLock(() => {
    const rows = readTable('Candidates').filter(match);
    rows.forEach(c => { c.booker_id = b.id; c.booker_name = b.name; c.company = b.company; writeRow('Candidates', c); });
    return rows.length;
  });
  if (n) log(u, 'link_bookings', '', n + ' check-in' + (n > 1 ? 's' : '') + ' typed their name or other names → ' + b.name);
  return n;
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
  alertsCheck: alertsCheck, testAlert: testAlert, sendSetupEmails: sendSetupEmails, adminCode: adminCode,
  chaseOutcomes: chaseOutcomes, chaseList: chaseList, academyList: academyList, markDay1: markDay1, markConfirmed: markConfirmed,
  onboardStep: onboardStep, onboardPreview: onboardPreview, onboardSend: onboardSend, setBrand: setBrand,
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
  // n + d: the page shows their name and Day 1 straight away, without waiting on Google
  const quick = c.academy_date ? '&n=' + encodeURIComponent(c.full_name.split(' ')[0]) + '&d=' + c.academy_date : '';
  if (CONFIG.PUBLIC_URL) return CONFIG.PUBLIC_URL + 'welcome-' + brandCo(c).toLowerCase() + '.html?t=' + c.welcome_token + quick;
  return scriptUrl() + '?go=welcome&t=' + c.welcome_token;
}

// ───────────────────────── ALERTS: phone push (OneSignal, free) + optional email ─────────────────────────
function esc(s) { return String(s || '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
function mail(to, subject, html) {
  try { MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, name: CONFIG.APP_NAME }); return true; } catch (e) { console.error(e); return false; }
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
  const list = users.filter(u => u && truthy(u.active) && u.email);  // no email = added by name only, not in the app yet
  if (!list.length) return;
  const url = staffUrl(cid || '');
  const reached = pushTo(list.map(u => u.id), title, body, url);
  const emailed = list.filter(u => CONFIG.EMAIL_ALERTS || reached.indexOf(u.id) < 0)
    .map(u => ({ u: u, ok: mail(u.email, title, '<p>' + esc(body).replace(/\n/g, '<br>') + '</p><p><a href="' + url + '">Open the app</a></p>') }));
  // One Log line per alert: who got it on their phone, who by email (and any email that failed), so "did they get it?" has an answer
  const first = l => l.map(u => u.name.split(' ')[0]).join(', ');
  const phone = list.filter(u => reached.indexOf(u.id) >= 0), ok = emailed.filter(e => e.ok).map(e => e.u), bad = emailed.filter(e => !e.ok).map(e => e.u);
  log({ name: 'alert' }, 'alert', cid || '', title + ' → ' + [phone.length ? '📲 ' + first(phone) : '', ok.length ? '✉️ ' + first(ok) : '', bad.length ? '❌ email failed: ' + first(bad) : ''].filter(String).join(' · '));
}

// ───────────────────────── ALERTS HEALTH (admin): is everyone actually reachable? ─────────────────────────
/** OneSignal's record for each person: 'on' (a phone subscribed), 'off' (opened the app, alerts not allowed), 'never' (no record yet). */
function oneSignalUsers(ids, k) {
  if (!ids.length) return {};
  const get = scheme => UrlFetchApp.fetchAll(ids.map(id => ({
    url: 'https://api.onesignal.com/apps/' + k.app + '/users/by/external_id/' + encodeURIComponent(id),
    method: 'get', muteHttpExceptions: true, headers: { Authorization: scheme + k.key },
  })));
  let res = get('Key ');
  if (res.every(r => r.getResponseCode() === 401 || r.getResponseCode() === 403)) res = get('Basic ');
  const out = {};
  ids.forEach((id, i) => {
    const code = res[i].getResponseCode();
    if (code === 404) { out[id] = { status: 'never', phones: 0 }; return; }
    if (code < 200 || code >= 300) { out[id] = { status: 'unknown', phones: 0, note: 'OneSignal said ' + code }; return; }
    let j = {};
    try { j = JSON.parse(res[i].getContentText()); } catch (e) { /* treated as no subscriptions */ }
    const subs = (j.subscriptions || []).filter(x => /Push$/.test(String(x.type || '')));
    const on = subs.filter(x => x.enabled === true || Number(x.notification_types) > 0);
    const last = j.properties && Number(j.properties.last_active);
    out[id] = {
      status: on.length ? 'on' : 'off', phones: on.length,
      devices: on.map(x => x.device_model || String(x.type).replace(/Push$/, '')).filter(String).join(', '),
      last_active: last ? Utilities.formatDate(new Date(last * 1000), CONFIG.TZ, 'yyyy-MM-dd HH:mm') : '',
    };
  });
  return out;
}

const SETUP_TIMERS = ['keepWarm', 'dailyMaintenance', 'weeklyProgressEmails', 'saturdayDeadlineEmails', 'mondayPayReportEmail'];
/** Everyone with access: phone alerts on / off / never set up, logged in or not, plus the system checks
 *  (OneSignal keys, email allowance left today, scheduled timers, last round-ups). */
function alertsCheck(req, u) {
  if (!isAdmin(u)) throw new Error('Admin only');
  const users = usersAll().filter(x => truthy(x.active) && x.email);  // name-only bookers aren't in the app yet
  const now = nowStr(), logins = {};
  readTable('Sessions').forEach(x => { if (String(x.expires) > now) logins[x.user_id] = (logins[x.user_id] || 0) + 1; });
  const k = pushKeys();
  let os = {}, osErr = '';
  try { os = k ? oneSignalUsers(users.map(x => x.id), k) : {}; } catch (e) { osErr = String(e.message || e).slice(0, 160); }
  const p = PropertiesService.getScriptProperties();
  let mailLeft = -1; try { mailLeft = MailApp.getRemainingDailyQuota(); } catch (e) { /* not available */ }
  const timers = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction());
  return {
    push: !!k, pushError: osErr, mailLeft: mailLeft,
    timersMissing: SETUP_TIMERS.filter(f => timers.indexOf(f) < 0),
    lastDigest: p.getProperty('DIGEST_SENT') || '', lastThanksReminder: p.getProperty('THANKS_REMINDED') || '',
    people: users.map(x => Object.assign({ id: x.id, name: x.name, company: x.company, roles: rolesOf(x), email: x.email, logins: logins[x.id] || 0 },
      os[x.id] || { status: k ? 'unknown' : 'no-push', phones: 0 })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Admin: send a test push to some people (or everyone). Says who it reached. */
function testAlert(req, u) {
  if (!isAdmin(u)) throw new Error('Admin only');
  const ids = Array.isArray(req.ids) && req.ids.length ? req.ids : usersAll().filter(x => truthy(x.active) && x.email).map(x => x.id);
  const users = usersAll().filter(x => truthy(x.active) && x.email && ids.indexOf(x.id) >= 0);
  const reached = pushTo(users.map(x => x.id), '🔔 Test alert from ' + u.name.split(' ')[0], 'If you can see this, your alerts work ✅', staffUrl(''));
  log(u, 'alert_test', '', users.length + ' sent, ' + reached.length + ' reached');
  return { reached: users.filter(x => reached.indexOf(x.id) >= 0).map(x => x.name), missed: users.filter(x => reached.indexOf(x.id) < 0).map(x => x.name) };
}

/** The 2-minute setup steps, by email: sent automatically when someone is added, and on demand from the alerts check. */
function setupEmailHtml(x) {
  const first = esc(x.name.split(' ')[0]), link = staffUrl('');
  return '<p>Hi ' + first + ',</p><p>You\'ve been added to the <b>' + esc(CONFIG.APP_NAME) + '</b>. It alerts you the moment your candidates check in, when their evaluation is in, and when outcomes are due. ' +
    'Set it up once on your phone (2 minutes):</p><ol>' +
    '<li>Open <a href="' + link + '">' + link + '</a></li>' +
    '<li>Log in with <b>' + esc(x.email) + '</b>. We\'ll email you a 6-digit code.</li>' +
    '<li><b>iPhone:</b> tap <b>Share</b> → <b>Add to Home Screen</b>, then open the app from the new icon (alerts only work from the icon). <b>Android:</b> tap <b>Install</b> when it asks.</li>' +
    '<li>Tap <b>🔔 Turn on</b> → <b>Allow</b>.</li>' +
    '<li>Check it worked: tap your initials (top right). It should say <b>Alerts: on ✅</b></li></ol>' +
    '<p>Until alerts are on, you\'ll get them by email instead, which is slower. Set it up today.</p>';
}
function sendSetupEmail(x) { return mail(x.email, '🔔 Set up the ' + CONFIG.APP_NAME + ' (2 minutes)', setupEmailHtml(x)); }
function sendSetupEmails(req, u) {
  if (!isAdmin(u)) throw new Error('Admin only');
  const ids = Array.isArray(req.ids) ? req.ids : [];
  const users = usersAll().filter(x => truthy(x.active) && x.email && ids.indexOf(x.id) >= 0);
  const sent = users.filter(sendSetupEmail);
  log(u, 'setup_emails', '', sent.length + ' sent: ' + sent.map(x => x.name.split(' ')[0]).join(', '));
  return { sent: sent.map(x => x.name), failed: users.filter(x => sent.indexOf(x) < 0).map(x => x.name) };
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
  try { backfillSends(); } catch (e) { console.error(e); }  // once each, after this version goes live
  try { backfillOutcomes(); } catch (e) { console.error(e); }
  maybeDailyDigest();
  maybeThanksReminder();
  maybeAcademyBriefing();
  maybeDay1Reminder();
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
// ───────────────────────── CHASE: nobody drops out of the pipeline ─────────────────────────
/** Why this candidate needs chasing ('' = they don't). One rule for the Chase tab, the nudges and the badge.
 *  Booker's job: log (rated in the room, no outcome yet) · callback (No answer / Thinking it over) · text (Day 1 details not sent)
 *  · confirm (sent, not confirmed) · noshow (rebook them). Admins': pending (your decision) · unticked (Day 1 gone, nobody marked arrived / no-show). */
const BOOKER_LEAKS = ['log', 'callback', 'text', 'confirm', 'noshow'];
function leakOf(c, today) {
  const from = addDays(today, -(CONFIG.CHASE_DAYS - 1));
  if (c.outcome === 'Academy booked') {
    if (c.admin_status === 'rejected' || c.day1_status === 'arrived' || !c.academy_date || c.academy_date < from) return '';
    if (c.admin_status === 'pending') return 'pending';
    if (c.day1_status === 'no_show') return 'noshow';
    if (c.academy_date >= today) return c.academy_confirmed_at ? '' : c.offer_sent_at ? 'confirm' : 'text';
    return 'unticked';
  }
  if (c.attended_date < from || !truthy(c.in_room) || nonQualifier(c)) return '';
  if (!c.outcome) return 'log';
  return c.outcome === 'No answer' || c.outcome === 'Thinking it over' ? 'callback' : '';
}
/** Rows that need chasing that this person can act on: admins see everyone, a booker their own (booker jobs only). */
function chaseRows(u) {
  const today = todayStr(), admin = isAdmin(u);
  if (!admin && !has(u, 'booker')) return [];
  return readTable('Candidates').map(c => {
    if (!admin && c.booker_id !== u.id) return null;
    const k = leakOf(c, today);
    return k && (admin || BOOKER_LEAKS.indexOf(k) >= 0) ? { c: c, k: k } : null;
  }).filter(Boolean);
}
function chaseList(req, u) {
  return { today: todayStr(), days: CONFIG.CHASE_DAYS, items: chaseRows(u).map(x => Object.assign(shape(x.c, u), { leak: x.k })) };
}
const LEAK_LINES = [['log', '📞 Log the call'], ['callback', '🔁 Call back'], ['text', '📲 Send Day 1 text'], ['confirm', '⏳ Day 1 not confirmed'], ['noshow', '❌ No-show, rebook']];
/** Admin, one tap (Chase tab): every booker with someone to chase gets an alert listing exactly who (email if they're not set up).
 *  The same booker isn't nudged twice in 30 minutes. */
function chaseOutcomes(req, u) {
  if (!isAdmin(u)) throw new Error('Admin only');
  const today = todayStr(), now = nowStr(), only = Array.isArray(req.ids) && req.ids.length ? req.ids : null;
  const by = {};
  chaseRows(u).forEach(x => { if (x.c.booker_id && BOOKER_LEAKS.indexOf(x.k) >= 0) { const b = (by[x.c.booker_id] = by[x.c.booker_id] || {}); (b[x.k] = b[x.k] || []).push(x.c); } });
  const cache = CacheService.getScriptCache(), out = { nudged: [], recently: [], noApp: [] };
  usersAll().filter(b => truthy(b.active) && b.id !== u.id && by[b.id] && (!only || only.indexOf(b.id) >= 0)).forEach(b => {
    if (!b.email) { out.noApp.push(b.name); return; }
    const key = 'chase_' + b.id + '_' + today;
    if (cache.get(key)) { out.recently.push(b.name); return; }
    const L = by[b.id], n = BOOKER_LEAKS.reduce((t, k) => t + (L[k] || []).length, 0);
    const late = (L.log || []).filter(c => now > outcomeDeadline(c.attended_date)).length;
    const lines = LEAK_LINES.filter(x => L[x[0]]).map(x => x[1] + ': ' + firstNames(L[x[0]], 6) + (x[0] === 'log' ? (late ? ' (' + late + ' LATE)' : ' (by ' + deadlineLabel() + ')') : ''));
    notify([b], '⏰ ' + u.name.split(' ')[0] + ': ' + n + (n === 1 ? ' person' : ' people') + ' to chase', lines.join('\n') + '\nDon\'t let them drop out. Tap to do it now.', 'chase');
    cache.put(key, '1', 1800);
    out.nudged.push(b.name);
  });
  log(u, 'chase', '', out.nudged.length + ' nudged' + (out.nudged.length ? ': ' + out.nudged.map(n => n.split(' ')[0]).join(', ') : ''));
  return out;
}

/** Everyone booked onto the BA Academy with Day 1 from a week ago onwards: admins see everyone, bookers their own. */
function academyList(req, u) {
  try { backfillSends(); } catch (e) { console.error(e); }
  const from = addDays(todayStr(), -7);
  const rows = readTable('Candidates').filter(c => c.outcome === 'Academy booked' && c.admin_status !== 'rejected' && c.admin_status !== 'pending' &&
    c.academy_date && c.academy_date >= from && fullAccess(u, c));
  return { today: todayStr(), items: rows.sort((a, b) => a.academy_date.localeCompare(b.academy_date) || a.full_name.localeCompare(b.full_name)).map(c => shape(c, u)) };
}
/** Once: who sent the Day 1 details (and how each thank-you went) before those columns existed, from the Log
 *  ("whatsapp_offer" by Fiza Iqbal at 16:03…). The latest send wins, as it does from now on. */
function backfillSends() {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('SENDS_BACKFILLED')) return;
  withLock(() => {
    if (p.getProperty('SENDS_BACKFILLED')) return;
    const last = {};
    readTable('Log').forEach(l => {
      const m = /^(whatsapp|sms|email)_(offer|thanks)$/.exec(l.action);
      if (m && l.candidate_id) last[l.candidate_id + '|' + m[2]] = { by: l.user, via: m[1] };
    });
    readTable('Candidates').forEach(c => {
      const o = last[c.id + '|offer'], t = last[c.id + '|thanks'];
      let changed = false;
      if (o && c.offer_sent_at && !c.offer_by) { c.offer_by = o.by; c.offer_via = o.via; changed = true; }
      if (t && c.thanks_sent_at && !c.thanks_via) { c.thanks_via = t.via; changed = true; }
      if (changed) writeRow('Candidates', c);
    });
    p.setProperty('SENDS_BACKFILLED', nowStr());
  });
}
/** Once: the call log for outcomes logged before it existed, from the Log ("outcome · No answer LATE" by Fiza at 11:59).
 *  The latest one gets its Day 1 date and notes from the candidate. One write for the whole column (runs from keepWarm). */
function backfillOutcomes() {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('OUTCOMES_BACKFILLED')) return;
  withLock(() => {
    if (p.getProperty('OUTCOMES_BACKFILLED')) return;
    const by = {};
    readTable('Log').forEach(l => {
      if (!l.candidate_id || (l.action !== 'outcome' && l.action !== 'admin_rejected')) return;
      const at = /^\d{4}-\d\d-\d\d \d\d:\d\d/.test(l.at) ? l.at.slice(0, 16) : '';
      const e = l.action === 'outcome' ? { at: at, by: l.user, o: String(l.detail).replace(/ LATE$/, '') }
        : { at: at, by: l.user, o: 'Not suitable', n: 'Academy booking rejected' + (l.detail ? ': ' + l.detail : '') };
      if (/ LATE$/.test(l.detail) && l.action === 'outcome') e.late = 1;
      (by[l.candidate_id] = by[l.candidate_id] || []).push(e);
    });
    const rows = readTable('Candidates');
    const vals = rows.map(c => {
      const l = by[c.id];
      if (c.outcome_log || !l) return [c.outcome_log];
      const last = l[l.length - 1];
      if (last.o === c.outcome) { if (c.academy_date) last.d = c.academy_date; if (c.outcome_notes) last.n = c.outcome_notes.slice(0, 300); }
      return [JSON.stringify(l.slice(-30))];
    });
    if (rows.length) sheet('Candidates').getRange(2, SHEETS.Candidates.indexOf('outcome_log') + 1, rows.length, 1).setValues(vals);
    delete MEMO.Candidates;
    p.setProperty('OUTCOMES_BACKFILLED', nowStr());
  });
}
/** On Day 1: arrived / no-show (or clear it). Admins, or the person who booked them. Gives the real show-up rate. */
function markDay1(req, u) {
  if (['arrived', 'no_show', ''].indexOf(req.status) < 0) throw new Error('Choose arrived or no-show');
  return withLock(() => {
    const c = getC(req.id);
    if (!fullAccess(u, c)) throw new Error('No access');
    if (c.outcome !== 'Academy booked') throw new Error('They aren\'t booked onto the Academy.');
    if (req.status && c.academy_date > todayStr()) throw new Error('Their Day 1 hasn\'t happened yet.');
    c.day1_status = req.status; c.day1_by = req.status ? u.name : ''; c.day1_at = req.status ? nowStr() : '';
    writeRow('Candidates', c);
    log(u, 'day1_' + (req.status || 'cleared'), c.id, '');
    return shape(c, u);
  });
}
/** They replied "Yes" to the Day 1 reminder on WhatsApp (instead of tapping CONFIRM): an admin or their booker marks them confirmed. */
function markConfirmed(req, u) {
  return withLock(() => {
    const c = getC(req.id);
    if (!fullAccess(u, c)) throw new Error('No access');
    if (c.outcome !== 'Academy booked' || !c.academy_date) throw new Error('They aren\'t booked onto the Academy.');
    if (!c.academy_confirmed_at) { c.academy_confirmed_at = nowStr(); writeRow('Candidates', c); log(u, 'day1_confirmed', c.id, 'replied Yes'); }
    return shape(c, u);
  });
}
/** 18:00 the evening before an Academy day: each booker gets their starters (✅ confirmed / ⏳ not yet), admins the full count.
 *  Nobody starting tomorrow = no message. Tapping it opens the Day 1 list. */
function maybeAcademyBriefing() {
  const now = nowStr(), today = now.slice(0, 10), hm = now.slice(11, 16);
  if (hm < CONFIG.DIGEST_TIME || hm > '20:59') return;
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('ACADEMY_BRIEF') === today) return;
  p.setProperty('ACADEMY_BRIEF', today);  // claim it first so an overlapping run can't send twice
  const tomorrow = addDays(today, 1);
  const rows = readTable('Candidates').filter(c => c.outcome === 'Academy booked' && c.academy_date === tomorrow && c.admin_status !== 'rejected' && c.admin_status !== 'pending');
  if (!rows.length) return;
  const tag = c => c.full_name.split(' ')[0] + (c.academy_confirmed_at ? ' ✅' : ' ⏳');
  const by = {};
  rows.forEach(c => { if (c.booker_id) (by[c.booker_id] = by[c.booker_id] || []).push(c); });
  Object.keys(by).forEach(id => {
    const b = userById(id), list = by[id], not = list.filter(c => !c.academy_confirmed_at);
    if (b) notify([b], '🎓 Tomorrow\'s BA Academy: ' + plural(list.length, 'starter') + ' of yours', list.map(tag).join(', ') +
      (not.length ? '\n⏳ Not confirmed: ' + firstNames(not) + '. Send a reminder now.' : '\nAll confirmed 🔥'), 'academy');
  });
  const not = rows.filter(c => !c.academy_confirmed_at);
  notify(usersAll().filter(x => isAdmin(x) && truthy(x.active)), '🎓 Tomorrow: ' + plural(rows.length, 'starter') + ' expected · ' + (rows.length - not.length) + ' confirmed',
    not.length ? '⏳ Not confirmed: ' + firstNames(not, 8) : 'Everyone has confirmed 🔥', 'academy');
}

/** DAY1_REMIND_TIME on an Academy day: Jess (LINK) / Rubal (JUSS) get "N starters to remind today". Tapping it opens the Day 1 tab
 *  with the send list ready. Nobody starting today, or everyone already reminded = no message. */
function maybeDay1Reminder() {
  const now = nowStr(), today = now.slice(0, 10), hm = now.slice(11, 16);
  if (hm < CONFIG.DAY1_REMIND_TIME || hm > '16:59') return;
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('DAY1_REMINDED') === today) return;
  p.setProperty('DAY1_REMINDED', today);  // claim it first so an overlapping run can't send twice
  const rows = readTable('Candidates').filter(c => c.outcome === 'Academy booked' && c.academy_date === today && c.admin_status !== 'rejected' && c.admin_status !== 'pending' &&
    !c.day1_status && String(c.day1_reminded_at).slice(0, 10) !== today);
  const team = thanksTeam(), byUser = {};
  Object.keys(team).forEach(co => {
    const t = team[co]; if (!t.id) return;
    const mine = rows.filter(c => thanksCo(c) === co);
    if (mine.length) (byUser[t.id] = byUser[t.id] || []).push.apply(byUser[t.id], mine);
  });
  Object.keys(byUser).forEach(id => {
    const list = byUser[id], not = list.filter(c => !c.academy_confirmed_at);
    notify([userById(id)], '🎓 Day 1 today: ' + plural(list.length, 'starter') + ' to remind', list.map(c => c.full_name.split(' ')[0] + (c.academy_confirmed_at ? ' ✅' : ' ⏳')).join(', ') +
      (not.length ? '\n⏳ Not confirmed yet: ' + firstNames(not) + '.' : '') + '\nTap to send the reminders in one go.', 'remind');
  });
}
// ───────────────────────── NEW STARTER ONBOARDING (admins only: Databyte, then the welcome email) ─────────────────────────
/** Someone's just been booked onto the Academy: Jess (LINK) / Rubal (JUSS) onboard them straight away. */
function newStarterAlert(c) {
  const t = thanksTeam()[c.company === 'JUSS' ? 'JUSS' : 'LINK'], u = t.id ? userById(t.id) : null;
  if (u) notify([u], '🚀 New starter to onboard: ' + c.full_name, 'Booked by ' + (c.booker_name || 'their booker') + ' for ' + longDate(c.academy_date) + '. Tap: add to Databyte, then send the welcome email.', c.id);
}
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "Monday 19th October" */
function longDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return '';
  const d = new Date(ymd + 'T00:00:00Z'), n = d.getUTCDate(), v = n % 100, sx = ['th', 'st', 'nd', 'rd'];
  return DAYS_LONG[d.getUTCDay()] + ' ' + n + (sx[(v - 20) % 10] || sx[v] || sx[0]) + ' ' + MONTHS_LONG[d.getUTCMonth()];
}
function onboardable(c) { return c.outcome === 'Academy booked' && c.admin_status !== 'pending' && c.admin_status !== 'rejected' && /^\d{4}-\d{2}-\d{2}$/.test(c.academy_date || ''); }
/** Office Recruitment = booked by the office (Jess, Rubal: any admin) or nobody; Personal Recruitment = booked by any booker. */
function recruitSourceOf(c) {
  const b = c.booker_id ? userById(c.booker_id) : null;
  return b && !isAdmin(b) ? 'Personal Recruitment' : 'Office Recruitment';
}
/** Step 1: they're on Databyte (or undo). The recruitment source is saved as it stood then. */
function onboardStep(req, u) {
  if (!isAdmin(u)) throw new Error('Admin only');
  return withLock(() => {
    const c = getC(req.id);
    if (!onboardable(c)) throw new Error('Only people booked onto the Academy are onboarded.');
    if (req.databyte !== undefined) { c.databyte_at = req.databyte ? nowStr() : ''; c.databyte_by = req.databyte ? u.name : ''; c.recruit_source = req.databyte ? recruitSourceOf(c) : ''; }
    writeRow('Candidates', c);
    if (req.databyte !== undefined) log(u, req.databyte ? 'databyte_added' : 'databyte_undone', c.id, c.recruit_source || '');
    return shape(c, u);
  });
}
/** Step 2: "Your Brand Ambassador Journey Begins!": Rubal's content, in the congratulations page's look (brand hero, white cards,
 *  chunky buttons). Table layout + inline styles so it holds up in Gmail, Outlook and Apple Mail (Outlook desktop: solid colours). */
function onboardEmail(c, u, pick) {
  const co = brandCo(c, pick), o = ONBOARD[co], first = c.full_name.split(' ')[0];
  const T = co === 'JUSS'
    ? { solid: '#E4613F', hero: 'linear-gradient(115deg,#D9534F 0%,#E4813F 28%,#EDA03A 44%,#34B1C0 62%,#2F86B5 100%)', btn: '#1FA3B1', tint: '#DCF2F4', ink: '#13808C' }
    : { solid: '#EE5A24', hero: 'linear-gradient(115deg,#FF7A2F 0%,#EE5A24 54%,#26252D 54.3%,#34333D 100%)', btn: '#EE5A24', tint: '#FDE6DC', ink: '#C2410C' };
  const F = "font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
  const d1 = c.academy_date, d2 = addDays(d1, 1), img = CONFIG.PUBLIC_URL ? CONFIG.PUBLIC_URL + 'img/' : '';
  const ymd = d1.replace(/-/g, ''), title = 'BA Academy Day 1 – ' + o.brand;
  const gcal = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(title) + '&dates=' + ymd + 'T133000/' + ymd + 'T180000&ctz=Europe/London' +
    '&location=' + encodeURIComponent(CONFIG.OFFICE_ADDRESS) + '&details=' + encodeURIComponent('Induction 1:30pm. Bring a notepad and pen, photo ID and your right-to-work share code.');
  const btn = (label, url, solid) => '<a href="' + esc(url) + '" style="display:inline-block;margin:6px 6px 0 0;padding:12px 18px;border-radius:14px;font-weight:800;font-size:15px;text-decoration:none;' +
    (solid ? 'background:' + T.btn + ';color:#ffffff;border:2px solid ' + T.btn + ';' : 'background:#ffffff;color:#22222B;border:2px solid #E7E3DE;') + '">' + label + '</a>';
  const bigBtn = (label, url) => '<a href="' + esc(url) + '" style="display:block;margin:10px 0 0;padding:15px 18px;border-radius:16px;text-align:center;font-weight:800;font-size:16px;text-decoration:none;color:#ffffff;background:' + T.solid + ';background-image:' + T.hero + ';">' + label + '</a>';
  const head = (emoji, label) => '<tr><td style="padding:22px 4px 8px;' + F + 'font-size:13px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#22222B">' +
    '<span style="display:inline-block;width:34px;height:34px;line-height:34px;text-align:center;border-radius:11px;background:' + T.tint + ';margin-right:10px;font-size:17px;letter-spacing:0">' + emoji + '</span>' + label + '</td></tr>';
  const card = inner => '<tr><td style="background:#ffffff;border-radius:22px;padding:20px 20px 22px;' + F + 'font-size:15px;line-height:1.5;color:#22222B;box-shadow:0 6px 24px -14px rgba(0,0,0,.25)">' + inner + '</td></tr>';
  const pill = t => '<span style="display:inline-block;padding:7px 14px;border-radius:999px;background:' + T.tint + ';color:' + T.ink + ';font-weight:800;font-size:15px">' + t + '</span>';
  const big = t => '<div style="font-size:24px;font-weight:900;letter-spacing:-.01em;margin:0 0 10px">' + t + '</div>';
  const step = (n, t) => '<tr><td style="vertical-align:top;width:34px;padding:8px 0"><span style="display:inline-block;width:26px;height:26px;line-height:26px;border-radius:50%;text-align:center;background:' + T.solid + ';color:#fff;font-weight:800;font-size:13px">' + n + '</span></td><td style="padding:8px 0;' + F + 'font-size:15px;line-height:1.45">' + t + '</td></tr>';
  const pre = '<div style="display:none;max-height:0;overflow:hidden;opacity:0">You\'re in, ' + esc(first) + ' 🎉 Day 1: ' + esc(longDate(d1)) + ' @ 1:30 PM. Download FieldIQ and read your ' + esc(o.playbook[0]) + ' before you come in.</div>';

  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>' +
    '<body style="margin:0;padding:0;background:#F5F1EC">' + pre +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1EC"><tr><td align="center" style="padding:18px 12px 30px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">' +
    // Hero: same as the congratulations page
    '<tr><td style="border-radius:26px;padding:26px 24px 26px;background:' + T.solid + ';background-image:' + T.hero + ';' + F + 'color:#ffffff">' +
      (img ? '<div style="display:inline-block;background:#ffffff;border-radius:18px;padding:8px 12px;margin-bottom:14px"><img src="' + img + 'logo-' + co.toLowerCase() + '.png" alt="' + esc(o.brand) + '" height="56" style="display:block;height:56px;width:auto;border:0"></div>' : '') +
      '<div style="font-size:34px;line-height:1.1;font-weight:900;letter-spacing:-.02em;margin:0 0 10px">You\'re in, ' + esc(first) + ' 🎉</div>' +
      '<div style="font-size:17px;line-height:1.4;margin:0 0 16px">Welcome to the <b>' + esc(o.brand) + '</b> team, and <b>Congratulations</b> on being selected to join us!</div>' +
      '<span style="display:inline-block;background:#ffffff;color:#22222B;border-radius:999px;padding:9px 16px;font-weight:800;font-size:15px">📅 ' + esc(longDate(d1)) + ' · 1:30 PM</span>' +
    '</td></tr>' +
    '<tr><td style="padding:20px 6px 0;' + F + 'font-size:15px;line-height:1.55;color:#3A3942">Hi ' + esc(first) + ', you’re coming on board at an exciting time as we continue to expand our business and head into a highly productive season. ' +
      'We’re confident that with your enthusiasm and dedication, you’ll thrive in your new role as a <b>Brand Ambassador</b>. Product training and sales coaching begins <b>' + esc(longDate(d1)) + ' @ 1:30 PM</b>.</td></tr>' +
    // A reply is the strongest "this isn't spam" signal there is, and tells Jess / Rubal it arrived
    '<tr><td style="padding:16px 0 0"><div style="border:2px dashed ' + T.solid + ';border-radius:16px;padding:12px 16px;background:#ffffff;' + F + 'font-size:15px;line-height:1.45;color:#22222B">' +
      '✅ <b>Quick one:</b> reply <b>GOT IT</b> to this email so we know it reached you.</div></td></tr>' +
    // Before Day 1
    head('⚡', 'Before Day 1') +
    card('<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
      step(1, '<b>Download FieldIQ</b> and complete your vetting form before your first day.') +
      (o.preCoaching ? step(2, 'Complete the short online <b>Pre-Coaching Module</b>: around <b>15–20 minutes</b> of short videos and quick questions. It’s important it’s done before ' + DAYS_LONG[weekday(d1)] + ', so you’re fully prepared for coaching.') : '') +
      step(o.preCoaching ? 3 : 2, 'Read your <b>' + esc(o.playbook[0]) + '</b>, so you walk in on Day 1 already knowing how we work.') +
      '</table>' + bigBtn('📲 Download FieldIQ', ONBOARD.FIELDIQ_URL) + (o.preCoaching ? bigBtn('📝 Open the Pre-Coaching Module', o.preCoaching[1]) : '') +
      bigBtn('📘 Open my ' + esc(o.playbook[0]), o.playbook[1])) +
    // Day 1
    head('📅', 'Day 1 · Induction') +
    card(big(esc(longDate(d1))) + pill('⏰ 1:30pm – 6:00pm') +
      '<p style="margin:12px 0 0">📍 ' + esc(CONFIG.OFFICE_ADDRESS) + '<br><span style="color:#6E6C78;font-size:13px">2 mins from Slough station · expected finish between 5:30 and 6:00 PM</span></p>' +
      '<div style="margin-top:8px">' + btn('🗺️ Google Maps', o.maps, true) + btn('📅 Add to calendar', gcal) + '</div>') +
    // Day 2 (+ Day 3 onwards)
    head('🎯', 'Day 2 · Sales Coaching') +
    card(big(esc(longDate(d2))) + pill('⏰ 1:00pm – 6:00pm') +
      '<p style="margin:12px 0 0;color:#6E6C78;font-size:13px">Expected finish between 5:30 and 6:00 PM</p>' +
      (o.day3 ? '<p style="margin:12px 0 0"><b>Day 3 onwards:</b> the same timings as previously discussed, <b>10:00am – 8:30pm</b>.</p>' : '')) +
    // Bring
    head('🎒', 'Bring with you') +
    card('<div style="font-size:16px;line-height:2">📝 Notepad and pen<br>🪪 Photo ID<br>🔑 Your right-to-work share code</div>') +
    // Week 1
    (c.welcome_token ? head('🗓️', 'Your Week 1 game plan') +
      card('<p style="margin:0 0 4px">Your first week, day by day, plus the Sales Skill Ladder. Tap <b>CONFIRM</b> on it so we know you’re coming.</p>' +
        (img ? '<a href="' + esc(welcomeUrl(c)) + '"><img src="' + img + 'poster-' + co.toLowerCase() + '.jpg" alt="' + esc(o.brand) + ' Week 1 plan" width="100%" style="display:block;width:100%;max-width:520px;height:auto;border:0;border-radius:16px;margin:12px 0 0"></a>' : '') +
        bigBtn('👀 See my Week 1 plan + CONFIRM', welcomeUrl(c))) : '') +
    // Get ready
    head('📚', 'Get ready') +
    card('<p style="margin:0">' + (co === 'JUSS' ? 'We highly recommend you read up on our client, <b>' + esc(o.client[0]) + '</b>, ahead of your training.' : 'Read up and do some research on our client, <b>' + esc(o.client[0]) + '</b>, before your product coaching.') +
      ' And check out the team in our online magazine!</p><div style="margin-top:6px">' + btn('🌐 ' + esc(o.client[0]), o.client[1], true) + btn('📖 ' + esc(o.magazine[0]), o.magazine[1]) +
      (o.website ? btn('✨ ' + esc(o.website[0]), o.website[1]) : '') + '</div>') +
    // Sign-off
    '<tr><td style="padding:24px 6px 0;' + F + 'font-size:15px;line-height:1.55;color:#22222B">Any questions' + (co === 'JUSS' ? ' regarding anything' : '') + ', just reply to this email or call <b>' + esc(o.phone) + '</b>.<br><br>' +
      'I’ll be in the office to meet you when you arrive. Excited to work with you! 🔥<br><br>Thanks,<br>Kind Regards,<br><b>' + esc(u.name) + '</b><br><span style="color:' + T.ink + ';font-weight:700">' + esc(o.brand) + '</span></td></tr>' +
    '</table></td></tr></table></body></html>';
  const text = 'Hi ' + first + ',\n\nWelcome to the ' + o.brand + ' team, and Congratulations on being selected to join us!\n\n' +
    'Product training and sales coaching begins ' + longDate(d1) + ' @ 1:30 PM.\n\n' +
    'Quick one: reply GOT IT to this email so we know it reached you.\n\n' +
    'BEFORE DAY 1\n1. Download FieldIQ and complete your vetting form before your first day: ' + ONBOARD.FIELDIQ_URL + '\n' +
    (o.preCoaching ? '2. Complete the Pre-Coaching Module (15-20 minutes): ' + o.preCoaching[1] + '\n' : '') +
    (o.preCoaching ? '3' : '2') + '. Read your ' + o.playbook[0] + ': ' + o.playbook[1] + '\n' +
    '\nDAY 1 · INDUCTION: ' + longDate(d1) + ', 1:30pm (finish 5:30-6:00pm)\n' + CONFIG.OFFICE_ADDRESS + ' · ' + o.maps + '\n' +
    'DAY 2 · SALES COACHING: ' + longDate(d2) + ', 1:00pm (finish 5:30-6:00pm)\n' + (o.day3 ? 'Day 3 onwards: 10:00am - 8:30pm\n' : '') +
    '\nBRING: notepad and pen, photo ID, your right-to-work share code\n' +
    (c.welcome_token ? '\nYour Week 1 plan + CONFIRM: ' + welcomeUrl(c) + '\n' : '') +
    '\nGet ready: ' + o.client[0] + ' ' + o.client[1] + ' · ' + o.magazine[0] + ' ' + o.magazine[1] + (o.website ? ' · ' + o.website[1] : '') + '\n' +
    '\nAny questions, just reply to this email or call ' + o.phone + '.\nI’ll be in the office to meet you when you arrive. Excited to work with you!\n\nThanks,\nKind Regards,\n' + u.name + '\n' + o.brand;
  return { to: c.email, subject: o.brand + ' - Your Brand Ambassador Journey Begins!', html: html, text: text };
}
function onboardPreview(req, u) {
  if (!isAdmin(u)) throw new Error('Admin only');
  const c = getC(req.id);
  if (!onboardable(c)) throw new Error('Only people booked onto the Academy are onboarded.');
  const pick = brandPick(req, u), s = welcomeSender(c, u, pick);
  return Object.assign(onboardEmail(c, s, pick), { from: s.name + ' <' + s.email + '>', notReady: welcomeNotReady(s), co: brandCo(c, pick) });
}
/** The company the recruitment team has on screen as they send (LINK / JUSS), so it goes exactly as previewed. Anyone else: ''. */
function brandPick(req, u) { return (req.co === 'LINK' || req.co === 'JUSS') && onRecruitTeam(u) ? req.co : ''; }
/** Goes from the sender's own address if they're on the recruitment team (Jess / Rubal / Fiza), else the company's (ONBOARD.*.from),
 *  signed by them: replies go straight to them and they get a copy.
 *  Databyte first: FieldIQ only works once they're on it. */
function onboardSend(req, u) {
  if (!isAdmin(u)) throw new Error('Admin only');
  const c = getC(req.id);
  if (!onboardable(c)) throw new Error('Only people booked onto the Academy are onboarded.');
  if (!c.databyte_at) throw new Error('Add them to Databyte first: FieldIQ only works once they\'re on Databyte.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email || '')) throw new Error('No valid email for ' + c.full_name + '.');
  const pick = brandPick(req, u), s = welcomeSender(c, u, pick), bad = welcomeNotReady(s);
  if (bad) throw new Error(bad);
  const m = onboardEmail(c, s, pick), brand = ONBOARD[brandCo(c, pick)].brand;
  const opts = { htmlBody: m.html, name: s.name + ' | ' + brand, bcc: s.email };
  if (s.email !== scriptEmail()) opts.from = s.email;
  GmailApp.sendEmail(m.to, m.subject, m.text, opts);
  return withLock(() => {
    const x = getC(req.id);
    x.onboard_email_at = nowStr(); x.onboard_email_by = u.name;
    if (pick) x.brand = pick;
    writeRow('Candidates', x);
    log(u, 'welcome_email', x.id, m.to + ' from ' + s.email);
    return shape(x, u);
  });
}

// ───── Welcome emails only ever go from the recruitment team's own addresses (Jess, Rubal, Fiza), never this script's own ─────
// One-time, by whoever owns this script: Gmail → Settings → Accounts → "Send mail as" → add each one, then run setupWelcomeEmail.
/** You (your own address), if you're on the recruitment team: any of you can send either company's.
 *  Anyone else (Angad, Satpal): the company's (LINK: Jess, JUSS: Rubal). */
function welcomeSender(c, u, pick) {
  const me = recruitTeam().filter(t => t.id === u.id)[0];
  if (me) return { name: me.name, email: me.email };
  const team = thanksTeam(), k = brandCo(c, pick);
  return { name: team[k].name || (k === 'JUSS' ? 'Rubal Oshan' : 'Jess Grace'), email: ONBOARD[k].from };
}
function scriptEmail() { try { return String(Session.getEffectiveUser().getEmail()).toLowerCase(); } catch (e) { return ''; } }
/** Addresses this script's Gmail can send as: its own + its "Send mail as" addresses (checked every 10 minutes). */
function sendableFrom() {
  const cache = CacheService.getScriptCache(), hit = cache.get('send_as');
  if (hit) return JSON.parse(hit);
  let list = [];
  try { list = [scriptEmail()].concat(GmailApp.getAliases().map(x => String(x).toLowerCase())); } catch (e) { console.error(e); }
  cache.put('send_as', JSON.stringify(list), 600);
  return list;
}
function welcomeNotReady(s) {
  return sendableFrom().indexOf(s.email) >= 0 ? '' : 'Can\'t send as ' + s.email + ' yet. Angad: add it in Gmail → Settings → Accounts → "Send mail as" (SETUP.md, "Welcome emails"), then try again in 10 minutes.';
}
/** For the admin cards: who each brand's welcome email comes from, and whether it's ready.
 *  mine: your own address, if you're on the recruitment team (then it always comes from you). */
function welcomeFromInfo(u) {
  const team = thanksTeam(), can = sendableFrom(), out = {};
  ['LINK', 'JUSS'].forEach(k => { out[k] = { name: team[k] ? team[k].name : '', email: ONBOARD[k].from, ready: can.indexOf(ONBOARD[k].from) >= 0 }; });
  const me = u ? recruitTeam().filter(t => t.id === u.id)[0] : null;
  out.mine = me ? { name: me.name, email: me.email, ready: can.indexOf(me.email) >= 0 } : null;
  return out;
}
/** Run once from the Apps Script editor (after adding the "Send mail as" addresses): approves Gmail and says what's ready. */
function setupWelcomeEmail() {
  CacheService.getScriptCache().remove('send_as');
  const can = sendableFrom();
  console.log('This script sends as: ' + can.join(', '));
  const all = [ONBOARD.LINK.from, ONBOARD.JUSS.from].concat(recruitTeam().map(t => t.email), (CONFIG.RECRUIT_TEAM || []).map(e => String(e).toLowerCase()));
  all.filter((a, i) => all.indexOf(a) === i).forEach(a => console.log(can.indexOf(a) >= 0 ? '✅ ' + a + ' ready' : '❌ ' + a + ': add it in Gmail → Settings → Accounts → "Send mail as", then run this again'));
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
  stats.forEach(s => { const r = roundupFor(s); notify([s.user], r.title, r.body, 'chase'); });
  const admins = users.filter(isAdmin);
  if (CONFIG.TEAM_ROUNDUP && admins.length && stats.length) { const t = teamRoundup(stats); notify(admins, t.title, t.body + '\nTap to chase them in one go.', 'chase'); }
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
