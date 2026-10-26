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
  // Where the app lives for staff and candidates (the Vercel / custom domain address, ending in /). Same as app/site.json "url".
  // Leave '' to use the Google Apps Script link instead (no push notifications).
  PUBLIC_URL: 'https://jl-recruitment.vercel.app/',
  ACADEMY_SIGNOFF: { LINK: 'Jess', JUSS: 'Rubal' }, // who signs the BA Academy WhatsApp, whoever sends it
  // Who sends the thank-you WhatsApp to every appointment (their company's candidates), and gets the reminder.
  // The same email for both = one person sends them all.
  THANKS_TEAM: { LINK: 'jess@linkmarketing.org.uk', JUSS: 'rubal@jussmarketing.co.uk' },  // recruitment team: thank-yous (either can send LINK or JUSS) + non-qualifier alerts
  // Also on the recruitment team (they work for both companies): send thank-yous, congratulations and welcome emails for either one,
  // choosing LINK or JUSS before they send. Jess and Rubal (above) are always on it and keep their reminders.
  RECRUIT_TEAM: [],  // anyone else who sends for both companies, by email. Empty: Jess and Rubal only (Angad, 26 Oct: Fiza off)
  THANKS_TIME: '12:00',           // every day: "N thank-you messages to send" to Jess / Rubal (only if there are any)
  DAY1_REMIND_TIME: '10:00',      // on a BA Academy Day 1: Jess / Rubal get "N starters to remind" (Day 1 tab → Send reminders)
  DIGEST_TIME: '18:00',           // Mon–Thu: each booker's round-up of their day
  ROUNDUP_TIME: '15:00',          // Friday: week roundup to each booker + a team roundup to admins
  TEAM_ROUNDUP: true,             // false = admins don't get the Friday team roundup
  CHASE_DAYS: 14,                 // Chase tab: appointments and no-shows from the last 2 weeks stay on it until they're dealt with
  // Booking a presentation straight after the call (Angad, 23 Oct): these three book applicants (Teamtailor CVs) from the app,
  // which writes the confirmation, the evening-before reminder and "sorry we missed you", and check-in finds the booking.
  BOOK_TEAM: ['angad@linkmarketing.org.uk', 'jess@linkmarketing.org.uk', 'rubal@jussmarketing.co.uk'],
  // Someone who left: until the date, a check-in that names them (or picks them from an old list) is credited to who took
  // over, as if an admin had moved it (Angad, 26 Oct: Fiza left; anyone in for her that week is Angad's). After it: no booker.
  HANDOVER: [{ from: 'Fiza Iqbal', also: ['Fiza', 'Fizza'], to: 'angad@linkmarketing.org.uk', until: '2026-11-01' }],
  BOOK_CO: 'JUSS',                // every applicant applies to JUSS Marketing, whoever books them
  BOOK_TIME: '10:00',             // presentations: Mon–Fri at 10:00
  BOOK_REMIND_TIME: '18:00',      // the evening before (Sunday for Monday's): whoever booked them gets "N to remind for tomorrow"
  BOOK_MISSED_TIME: '10:30',      // on the day: anyone booked who hasn't checked in by now "didn't come" (and their booker is told)
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
    client: ['NDCS', 'https://www.ndcs.org.uk/'], magazine: ['Link Magazine', 'https://www.linkmarketing.org.uk/magazine/'],  // moved off Manus with the website, 21 Oct 2026
    playbook: ['Link Org Playbook', 'https://link-fr-playbook.vercel.app/'],  // was "Link FR Playbook" (renamed 21 Oct; same address)
    from: 'jess@linkmarketing.org.uk',  // welcome emails only ever go from Jess's or Rubal's inbox (either can send either brand)
    // Week 1, day by day (same as the welcome page's WEEK1 in JS.html): [emoji, what, time, about]
    week1: [
      ['🗓️', 'Induction Day', '1:30pm – 6:00pm', 'Meet the team and learn more about the industry. Expected finish between 5:30 and 6:00 PM.'],
      ['🏢', 'Sales Coaching', '1:00pm – 6:00pm', 'Deep dive into office-based sales coaching. Expected finish between 5:30 and 6:00 PM.'],
      ['👣', 'Practical Learning Day', '10:00am – 8:30pm', 'Meet your 1-on-1 coach & mentor and shadow them.'],
      ['💰', 'Sales Days', '10:30am – 8:30pm', '1st day on badge! Your coach is side by side with you. Apply what you’ve learnt and bag your incentives.'],
    ],
  },
  JUSS: {
    brand: 'JUSS Marketing', colour: '#E4613F', phone: '077823 77774', maps: 'https://maps.app.goo.gl/n2wTFyzScHLr1Voy9', day3: false,
    client: ['Hello Fresh', 'http://www.hellofresh.co.uk/'], website: ['JUSS Marketing', 'https://jussmarketing.co.uk/'], magazine: ['JUSS Magazine', 'https://jussmarketing.co.uk/magazine/'],  // moved off Manus with the JUSS website, 21 Oct 2026
    playbook: ['JUSS Playbook', 'https://juss-playbook.vercel.app/'],  // its own address since 21 Oct 2026 (juss-hf-playbook.vercel.app is the same app and keeps working)
    from: 'rubal@jussmarketing.co.uk',
    week1: [
      ['🗓️', 'Induction Day', '1:30pm – 6:00pm', 'Meet the team and learn more about the industry. Expected finish between 5:30 and 6:00 PM.'],
      ['🏢', 'Sales Coaching', '1:00pm – 6:00pm', 'Deep dive into in-house sales coaching. Expected finish between 5:30 and 6:00 PM.'],
      ['👣', 'Practical Learning Day', '10:00am – 8:30pm', 'Meet your 1-on-1 coach & mentor and shadow them.'],
      ['💰', 'Sales Days', '10:30am – 8:30pm', '1st day on badge! Your coach is side by side with you. Apply what you’ve learnt and bag your incentives.'],
    ],
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
    'outcome_log',  // every call outcome logged, oldest first: [{at, by, o: outcome, d: Day 1 date, cb: call back at, late: 1, n: notes}]
    'callback_at', 'callback_by_id', 'callback_nudged',  // "Thinking it over": when they asked to be called back, who logged it (gets the reminder), reminder sent for
    'booking_id', 'booking_note',  // booked from the app after a call (Bookings tab): which booking, and the notes for the presenter
    'campaign',  // not used: the campaign always follows the company, JUSS = HF, LINK = FR (Angad, 26 Oct). Kept: columns are by position
  ],
  // Presentations booked after a call. status: booked · came (checked in) · no_show (rebooked after missing it) · cancelled.
  // Each message sent (confirmation, reminder, "sorry we missed you"): when, by whom, how.
  Bookings: ['id', 'created_at', 'booked_by_id', 'booked_by', 'first_name', 'last_name', 'mobile', 'source', 'notes',
    'slot_date', 'slot_time', 'company', 'status', 'rebook_of', 'no_whatsapp',
    'confirm_at', 'confirm_by', 'confirm_via', 'confirmed_at', 'confirmed_by', 'remind_at', 'remind_by', 'remind_via',
    'missed_at', 'missed_by', 'missed_via', 'candidate_id', 'came_at', 'updated_at',
    'confirm_token'],  // their "You're booked in" page (booked.html?t=…) with the CONFIRM button
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

// ───────────────────────── MOVE TO SUPABASE (the Vercel back end, server/) ─────────────────────────
// This same file also runs on Vercel, where SUPABASE_BACKEND is defined and none of this applies. On Google it is:
//  - the email relay: Vercel asks Google to send its emails, so they still go from Gmail ("send mail as" Jess / Rubal / Fiza);
//  - the handover: the Sheet's tabs and settings, read once on switch day (relayExport);
//  - the switch: FROZEN = saves wait ("Trying again…", phones retry by themselves) while the data is copied;
//    MOVED_TO = every request from a phone that still has the old address open is passed on to Vercel. Undo = relaySwitch({ to: '' });
//  - the JUSS earnings summaries: Satpal's weekly email lands in this account, so the JUSS Playbook fetches them here (relayEarnings).
// Every relay call carries Vercel's RELAY_SECRET (a long random key in Vercel's settings). Only its SHA-256 fingerprint
// is here (safe to publish: it can't be turned back into the key), so nobody has to copy the key into Google.
const RELAY_SECRET_SHA256 = 'f648c4393028bfc5db8e40b94fd30bb09f068d190d024534f9c9e88e076a3163';
const RELAY_ACTIONS = { relayInfo: relayInfo, relayMail: relayMail, relayExport: relayExport, relayFreeze: relayFreeze, relaySwitch: relaySwitch, relayMirror: relayMirror, relayEarnings: relayEarnings };
/** The live copy for the team (19 Oct): Vercel writes each tab here every 5 minutes when it changed, so the Sheet keeps
 *  showing today's people. Read-only: the app's data lives in Supabase, and edits made here are overwritten (each tab
 *  warns before an edit). Never the login tabs. Everything as plain text, so mobiles keep their leading 0. */
const MIRROR_SKIP = ['Sessions', 'Codes'], MIRROR_INFO = 'ℹ️ Live copy';
function relayMirror(req) {
  relayCheck(req);
  const name = String(req.tab || ''), head = (req.headers || []).map(String), rows = req.rows || [];
  if (!/^[A-Za-z][\w ]{0,40}$/.test(name) || MIRROR_SKIP.indexOf(name) >= 0) throw new Error('Not allowed');
  const book = ss(), width = Math.max(1, head.length);
  const sh = book.getSheetByName(name) || book.insertSheet(name);
  const cell = v => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const values = [head.length ? head : ['']].concat(rows.map(r => head.map((_, i) => cell(r[i]))));
  if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
  if (sh.getMaxRows() < values.length) sh.insertRowsAfter(sh.getMaxRows(), values.length - sh.getMaxRows());
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearContent();
  sh.getRange(1, 1, values.length, width).setNumberFormat('@').setValues(values);
  sh.setFrozenRows(1);
  if (!sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) {
    sh.protect().setWarningOnly(true).setDescription('Live copy from the recruitment app: changes here are overwritten every 5 minutes. Use the app.');
  }
  const info = book.getSheetByName(MIRROR_INFO) || book.insertSheet(MIRROR_INFO, 0);
  info.getRange(1, 1, 3, 1).setValues([['Live copy from the recruitment app (jl-recruitment.vercel.app)'],
    ['Updated every 5 minutes. Read-only: changes made in this Sheet are overwritten, so make them in the app.'],
    ['Last copy: ' + nowStr() + ' (' + name + ')']]);
  return { tab: name, rows: rows.length };
}
function onSupabase() { return typeof SUPABASE_BACKEND !== 'undefined'; }
function relayCheck(req) {
  const want = onSupabase() ? '' : String(PropertiesService.getScriptProperties().getProperty('RELAY_SECRET_SHA256') || RELAY_SECRET_SHA256);
  const given = String((req && req.secret) || ''), got = given.length >= 32 ? sha(given) : '';
  let diff = want && got.length === want.length ? 0 : 1;
  for (let i = 0; i < got.length && i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  if (!want || diff) throw new Error('Not allowed');
}
function relayInfo(req) {
  relayCheck(req);
  const p = PropertiesService.getScriptProperties();
  let quota = -1; try { quota = MailApp.getRemainingDailyQuota(); } catch (e) { /* not available */ }
  let aliases = []; try { aliases = GmailApp.getAliases(); } catch (e) { console.error(e); }
  return { owner: scriptEmail(), quota: quota, aliases: aliases, frozen: !!p.getProperty('FROZEN'), movedTo: p.getProperty('MOVED_TO') || '',
    timers: ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction()),
    // The phone-alert key stays in Google's Script Properties; Vercel asks for it here instead of anyone copying it
    onesignalKey: req.withKeys ? p.getProperty('ONESIGNAL_API_KEY') || '' : undefined };
}
function relayMail(req) {
  relayCheck(req);
  const m = req.mail || {};
  if (m.via === 'mail') MailApp.sendEmail(m.msg);
  else GmailApp.sendEmail(m.to, m.subject, m.body, m.opts || {});
  return { sent: true };
}
/** Every tab exactly as readTable sees it (text), plus the Script Properties (never the secret ones). */
function relayExport(req) {
  relayCheck(req);
  const tabs = {};
  ss().getSheets().forEach(sh => {
    const values = sh.getDataRange().getValues().map(r => r.map(v => (v === null || v === undefined ? '' : String(v))));
    tabs[sh.getName()] = { headers: values.length ? values[0] : [], rows: values.slice(1), max_rows: sh.getMaxRows(), max_cols: sh.getMaxColumns() };
  });
  const props = PropertiesService.getScriptProperties().getProperties(), secret = ['RELAY_SECRET_SHA256', 'ONESIGNAL_API_KEY', 'FROZEN', 'MOVED_TO', 'SS_ID'];
  secret.forEach(k => { delete props[k]; });
  return { at: nowStr(), tabs: tabs, props: props };
}
/** on: saves wait and Google's timers stop (nothing changes in the Sheet while it's copied). off: back to normal. */
function relayFreeze(req) {
  relayCheck(req);
  const p = PropertiesService.getScriptProperties();
  if (req.on) { p.setProperty('FROZEN', nowStr()); ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t)); }
  else { p.deleteProperty('FROZEN'); if (!p.getProperty('MOVED_TO')) installTriggers(); }
  return { frozen: !!req.on };
}
/** to = the Vercel API address: pass everything on and stop Google's timers (Vercel runs them). to = '' undoes it. */
function relaySwitch(req) {
  relayCheck(req);
  const p = PropertiesService.getScriptProperties();
  if (req.to) {
    p.setProperty('MOVED_TO', String(req.to));
    ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  } else {
    p.deleteProperty('MOVED_TO');
    installTriggers();
  }
  p.deleteProperty('FROZEN');
  return { movedTo: p.getProperty('MOVED_TO') || '' };
}
/** JUSS Playbook scorecard (Angad, 25 Oct 2026: "I don't want to be every week that email comes in… figure out a way for
 *  you to open it up"). Satpal's "HF & GC ES WE dd.mm.yy - JUSS" email comes into this account every week; the JUSS
 *  Playbook asks here for its HelloFresh and Green Chef earnings summaries. Read only: one fixed search, only Satpal's
 *  messages, only the "… Earnings Summary … .xlsx" files; nothing in Gmail is marked, moved or changed.
 *  seen = message ids the JUSS Playbook already has (they come back without their files); limit = new ones with files. */
const EARNINGS_QUERY = 'from:satpal@jussmarketing.co.uk subject:ES subject:JUSS has:attachment filename:xlsx';
function relayEarnings(req) {
  relayCheck(req);
  const seen = (req.seen || []).map(String), limit = Math.max(1, Math.min(4, Number(req.limit) || 1)), emails = [];
  GmailApp.search(EARNINGS_QUERY, 0, 12).forEach(t => t.getMessages().forEach(m => {
    if (!/satpal@jussmarketing\.co\.uk/i.test(m.getFrom())) return;
    const files = m.getAttachments().filter(a => /earnings summary.*\.xlsx$/i.test(a.getName()));
    if (files.length) emails.push({ id: m.getId(), date: m.getDate().toISOString(), subject: m.getSubject(), files: files });
  }));
  emails.sort((a, b) => (a.date < b.date ? 1 : -1));
  let sent = 0;
  return { emails: emails.map(e => {
    const send = seen.indexOf(e.id) < 0 && sent < limit;
    if (send) sent++;
    return { id: e.id, date: e.date, subject: e.subject, names: e.files.map(a => a.getName()),
      files: send ? e.files.map(a => ({ name: a.getName(), data: Utilities.base64Encode(a.getBytes()) })) : undefined };
  }) };
}
function switchover(req) {
  if (onSupabase()) return null;
  const p = PropertiesService.getScriptProperties(), to = p.getProperty('MOVED_TO');
  if (to) {
    const r = UrlFetchApp.fetch(to, { method: 'post', contentType: 'text/plain', payload: JSON.stringify(req), muteHttpExceptions: true });
    try { return JSON.parse(r.getContentText()); } catch (e) { return { ok: false, retry: true, error: 'Lots of people are sending at once. Trying again…' }; }
  }
  if (p.getProperty('FROZEN')) return { ok: false, retry: true, error: 'Lots of people are sending at once. Trying again…' };
  return null;
}

/** Single entry point for the browser: google.script.run.api({action, token, ...}) */
function api(req) {
  MEMO = {};
  try {
    if (RELAY_ACTIONS[req.action]) return { ok: true, data: RELAY_ACTIONS[req.action](req) };
    const moved = switchover(req);
    if (moved) return moved;
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
function sheet(name) { return ss().getSheetByName(name) || newTab(name); }
/** A tab a new version added (Bookings, 23 Oct) is made the first time it's needed, so nothing has to be run by hand. */
function newTab(name) {
  const cols = SHEETS[name];
  if (!cols) return null;
  const sh = ss().insertSheet(name);
  ensureCols(sh, cols.length, name);
  sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
  sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
  sh.setFrozenRows(1);
  return sh;
}

let MEMO = {};  // sheet reads cached for the length of one request
function readTable(name, retried) {
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
    // Someone else's request may be adding a new version's columns this very second: look again once before giving up
    if (!retried) { Utilities.sleep(1500); SpreadsheetApp.flush(); return readTable(name, true); }
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
  const dups = hs => hs.map((h, j) => j).filter(j => hs[j] && hs.indexOf(hs[j]) < j && empty(j));
  let dup = dups(headers);
  if (dup.length) {  // look at the header row as it is now: another request may have just written new columns there
    const now = sh.getRange(1, 1, 1, Math.max(headers.length, 1)).getValues()[0].map(String);
    dup = dups(now).filter(j => headers[j] === now[j]);
  }
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
  if (c.rag === 'W') red('Walked out of the presentation: no call, messages or BA Academy booking');
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
/** Walk out: came, but left the presentation before the end. The presenter taps "Walk out" instead of Green / Amber / Red
 *  (Angad, 20 Oct). They still count for the booker's incentive (they checked in and qualify: nobody's fault), but they're
 *  never booked onto the BA Academy, and bookers can see them but not call, message or log an outcome for them. */
function walkedOut(c) { return c.rag === 'W'; }
const WALKED_OUT = 'They walked out of the presentation: no call, messages or BA Academy booking.';
/** Nobody has to log an outcome for them: a non-qualifier or a walk out. */
function noCallNeeded(c) { return !!nonQualifier(c) || walkedOut(c); }

/** Why a candidate does NOT count towards the booker's net attended ('' = counts). */
function payExclusion(c) {
  // A non-qualifier first: they don't count, rated in the room or not (often they aren't: the team speaks to them instead)
  const nq = nonQualifier(c);
  if (nq) return nq;
  if (!truthy(c.in_room)) return 'Not rated by the presenter (not confirmed in the room)';
  const wd = weekday(c.attended_date);
  if (wd === 0 || wd === 6) return 'Weekend appointment';
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
    return newSession(u);
  });
}
/** A logged-in session for this person (inside the lock). */
function newSession(u) {
  const t = token();
  appendRow('Sessions', {
    token: sha(t), user_id: u.id,
    expires: Utilities.formatDate(new Date(Date.now() + CONFIG.SESSION_DAYS * 86400000), CONFIG.TZ, 'yyyy-MM-dd HH:mm'),
  });
  return { token: t, user: publicUser(u) };
}

// ───── One login for every LINK × JUSS app: the hub (link-juss.vercel.app, hub/ in this repo) ─────
// Only on Supabase (CoreAuth comes from server/worker.js). The hub only ever gives a Recruitment ticket to someone active in
// the Users tab: new starters never get in here. The "Sign in with your work email" button, the automatic playbook unlock
// and the hub link in welcome emails switch on at launch with the HUB_SIGNIN setting (jl.props) = 1.
const HUB_URL = 'https://link-juss.vercel.app/';
function hubOn() { return onSupabase() && typeof CoreAuth !== 'undefined' && PropertiesService.getScriptProperties().getProperty('HUB_SIGNIN') === '1'; }
function hubLink(app, path) { return HUB_URL + '?app=' + app + '&r=' + encodeURIComponent(path || '/'); }
function loginInfo() { return { hub: hubOn() ? hubLink('recruit', '/') : '' }; }
/** Arriving from the hub (index.html#hub=<ticket>): the same session a login code gives. Works once, for 2 minutes. */
function hubLogin(req) {
  if (!onSupabase() || typeof CoreAuth === 'undefined') throw new Error('Signing in through the hub isn\'t available here.');
  const r = CoreAuth.redeem(String(req.ticket || ''), 'recruit');
  if (!r) throw new Error('That sign-in link has expired. Please try again.');
  const email = normEmail(r.email);
  const u = usersAll().filter(x => normEmail(x.email) === email && truthy(x.active))[0];
  if (!u) throw new Error('You don\'t have access to the recruitment app. Ask ' + ADMINS.map(a => a.name.split(' ')[0]).join(', ').replace(/, ([^,]*)$/, ' or $1') + '.');
  log(u, 'hub_login', '', email);
  return withLock(() => newSession(u));
}
/** Onboarded → their company's playbook opens (LINK: FR Playbook, JUSS: HelloFresh), email sign-in only. Never Recruitment. */
function unlockPlaybook(c, co, u) {
  if (!hubOn()) return null;
  try {
    const r = CoreAuth.unlockPlaybook({ email: c.email, name: c.full_name, company: co, startDate: c.academy_date });
    log(u, 'playbook_unlocked', c.id, (r && r.app) + (r && r.created ? ' opened' : r && r.existed ? ' already open' : ' ' + (r && r.error)));
    return r;
  } catch (e) { console.error(e); log(u, 'playbook_unlock_failed', c.id, String(e.message || e)); return null; }
}

// ───────────────────────── PUBLIC (candidate) ─────────────────────────
function publicConfig(req) {
  // Anyone who left (CONFIG.HANDOVER) can still be picked by name, as an other name of who took over (typed spellings: matchBooker)
  const hand = handovers(todayStr());
  const bookers = usersAll().filter(u => truthy(u.active) && has(u, 'booker'))
    .map(u => ({ id: u.id, name: u.name, company: u.company, aliases: aliasesOf(u).concat(hand.filter(x => x.to.id === u.id).map(x => x.names[0])) }))
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
  // Picked from a list that's out of date (someone since switched off): whoever took over from them, else nobody
  const pick = f.booker_id ? userById(f.booker_id) : null, gone = pick && !truthy(pick.active) ? pick : null;
  let booker = liveBooker(pick, today);
  // Typed rather than picked ("Daniel Thompson", "Skye Promotions", "Hasini"): credit the booker it clearly means
  const auto = !booker && f.booker_typed ? matchBooker(f.booker_typed, today) : null;
  if (auto) booker = auto;
  // Booked from the app after a call: the booking says who booked them (whoever they picked) and that they're JUSS's
  const bk = bookingFor(mobile, today, name), bkBy = bk ? liveBooker(userById(bk.booked_by_id), today) : null;
  const picked = booker && bkBy && booker.id !== bkBy.id ? booker.name : '';
  if (bkBy) booker = bkBy;
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
      booker_typed: String(f.booker_typed || (gone ? gone.name : '')).trim().slice(0, 60),
      booker_id: booker ? booker.id : '', booker_name: booker ? booker.name : '',
      company: booker ? booker.company : '',
      source: String(f.source || '').slice(0, 40), rtw: f.rtw,
      visa_expiry: rtwLevel(f.rtw) === 'visa' ? String(f.visa_expiry || '') : '',
      privacy_ok: 'TRUE',
      repeat_of: rep ? rep.ref : '', repeat_info: rep ? rep.info : '', repeat_block: rep && rep.block ? 'TRUE' : '',
      brand: bk ? bk.company : '', booking_id: bk ? bk.id : '', booking_note: bk ? bk.notes : '',
    };
    appendRow('Candidates', c);
    if (bk) {  // the booking: they came (read fresh, inside the lock)
      const r = rowOfId('Bookings', bk.id), b = r ? readRow('Bookings', r) : null;
      if (b && b.status === 'booked') { b.status = 'came'; b.candidate_id = c.id; b.came_at = c.created_at; b.updated_at = c.created_at; writeRow('Bookings', b); }
    }
    return { c: c, isNew: true };
  });
  if (res.isNew) log(null, 'checkin', res.c.id, name);
  if (res.isNew && auto && !bk) log(null, 'auto_booker', res.c.id, '"' + res.c.booker_typed + '" → ' + auto.name);
  if (res.isNew && gone && !bk) log(null, 'auto_booker', res.c.id, 'picked ' + gone.name + ' (switched off) → ' + (booker ? booker.name : 'no booker'));
  if (res.isNew && bk) log(null, 'booking_came', res.c.id, 'booked by ' + bk.booked_by + ' for ' + bk.slot_date + (picked ? ' (they picked ' + picked + ')' : '') +
    (bk.mobile !== mobile ? ' (found by name: booked as ' + bk.mobile + ')' : ''));
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
/** A presenter's view of someone else's candidate: only what's needed to rate the room, and who booked them (Angad, 17 Oct).
 *  No evaluation answers, outcome, contact details or eligibility. */
const ROOM_FIELDS = ['id', 'created_at', 'attended_date', 'week_ending', 'full_name', 'company', 'booker_name', 'booker_typed', 'in_room', 'rag', 'stars', 'tags', 'notes',
  'presenter_id', 'presenter_name', 'notes_at', 'p_why_sales', 'p_why_sales_note', 'p_interesting', 'booking_note'];
function roomShape(c) {
  const o = { limited: true, flags: [], first_name: c.full_name.split(' ')[0], eval_at: c.eval_at ? 'yes' : '' };  // eval_at: for the day's count only
  ROOM_FIELDS.forEach(k => { o[k] = c[k]; });
  // Under 18 / no right to work: the presenter doesn't need to rate them (Angad, 20 Oct). Not why, just that.
  if (nonQualifier(c)) o.no_rating = true;
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
  // Walked out: their booker still sees them, but not how to reach them (Angad, 20 Oct: "not be able to call them")
  if (walkedOut(c) && !isAdmin(u)) { o.mobile = ''; o.email = ''; }
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
    bookTeam: bookTeam(),
    book: { time: CONFIG.BOOK_TIME, co: CONFIG.BOOK_CO, missed: CONFIG.BOOK_MISSED_TIME, sources: BOOK_SOURCES },
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
  if (canBook(u)) out.bookings = bookingList(req, u).items;  // Jess, Rubal, Angad: who's booked for the presentations
  // The number on the Chase tab: this week's + carried over from earlier weeks ("3+8")
  const cw = weekEnding(todayStr()), now = chaseNow(u);
  out.chase = now.length;
  out.chaseCarry = now.filter(x => chaseWeek(x.c) < cw).length;
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
    // One tap on the list (Green / Amber / Red / Walk out) sends only: ['rag'], so it never overwrites notes someone else just wrote.
    const set = k => !Array.isArray(req.only) || req.only.indexOf(k) >= 0;
    if (set('rag') && ['G', 'A', 'R', 'W', ''].indexOf(req.rag) >= 0) c.rag = req.rag;
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
    // A walk out is never booked onto the Academy, and their booker logs nothing (an admin can, anything but booked)
    if (walkedOut(c) && (!isAdmin(u) || req.outcome === 'Academy booked')) throw new Error(WALKED_OUT);
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
    // "Thinking it over": when they asked to be called back. Whoever logged it gets "🔁 Call them back now" at that time.
    if (req.outcome === 'Thinking it over' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(req.callback_at || '')) {
      if (req.callback_at !== c.callback_at) c.callback_nudged = '';
      c.callback_at = req.callback_at; c.callback_by_id = u.id;
    } else if (req.outcome !== 'Thinking it over') { c.callback_at = ''; c.callback_by_id = ''; c.callback_nudged = ''; }
    // RED from presenter (or a repeat block) → admin has the final say on an Academy booking.
    if (req.outcome === 'Academy booked' && (c.rag === 'R' || truthy(c.repeat_block))) {
      if (isAdmin(u)) { c.admin_status = 'approved'; c.admin_by = u.name; c.admin_at = nowStr(); }
      else if (c.admin_status !== 'approved') c.admin_status = 'pending';
    } else if (c.admin_status === 'pending') c.admin_status = '';
    const wasPending = c._wasPending, wasBooked = c._wasBooked;
    addOutcomeLog(c, { at: c.outcome_at, by: u.name, o: c.outcome, d: c.academy_date, cb: c.callback_at, late: c.outcome_late ? 1 : 0, n: c.outcome_notes });
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
  if (!Array.isArray(l)) l = [];
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
/** The recruitment team: Jess, Rubal (THANKS_TEAM) + anyone in RECRUIT_TEAM (nobody since 26 Oct). Any of them thanks / congratulates anyone, as LINK or JUSS. */
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
  if (['thanks', 'offer', 'noanswer', 'thinking', 'day1'].indexOf(req.kind) < 0) throw new Error('Unknown message');
  return withLock(() => {
    const c = getC(req.id);
    if (!fullAccess(u, c)) throw new Error('No access');
    if (walkedOut(c) && !isAdmin(u)) throw new Error(WALKED_OUT);
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
    if (c.outcome) { r.outcomes++; if (truthy(c.outcome_late)) r.late++; } else if (!noCallNeeded(c)) r.missing++;
  });
  let list = Object.keys(by).map(k => by[k]).filter(r => r.attended > 0 || r.active);
  if (!isAdmin(u)) list = list.filter(r => r.booker_id === u.id);
  list.sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));
  return {
    weekEnding: we, deadline: outcomeDeadline(addDays(we, -6)),
    target: CONFIG.PAY_TARGET, rows: list, unassigned: isAdmin(u) ? unassigned : [],
    showup: isAdmin(u) ? showupFor(we) : null,
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
/** CONFIG.HANDOVER on this day, once the leaver is switched off or deleted: [{ was (their record, if kept), names, to }]. */
function handovers(day) {
  return (CONFIG.HANDOVER || []).filter(x => day && day <= x.until).map(x => {
    const was = usersAll().filter(u => normName(u.name) === normName(x.from))[0];
    const to = usersAll().filter(u => normEmail(u.email) === normEmail(x.to) && truthy(u.active))[0];
    return { was: was, to: to, names: [x.from].concat(x.also || [], was ? aliasesOf(was) : []) };
  }).filter(x => x.to && !(x.was && truthy(x.was.active)));
}
/** Who gets the credit for a booker picked or found: themselves, or (switched off) whoever took over from them, else nobody. */
function liveBooker(b, day) {
  if (!b || truthy(b.active)) return b || null;
  const h = handovers(day).filter(x => x.was && x.was.id === b.id)[0];
  return h ? h.to : null;
}
/** day: a check-in's day, so the names of anyone who left (CONFIG.HANDOVER) credit who took over from them. */
function matchBooker(typed, day) {
  const t = normName(typed); if (!t) return null;
  const tt = t.split(' '), w = k => k.split(' ');
  const people = usersAll().filter(u => truthy(u.active) && has(u, 'booker')).map(u => ({ u: u, keys: bookerKeys(u) }))
    .concat(handovers(day).map(x => ({ u: x.to, keys: bookerKeys({ name: x.names[0], aliases: x.names.slice(1).join(' | ') }) })));
  const rules = [
    k => k === t,
    k => w(k).length >= 2 && w(k).every(x => tt.indexOf(x) >= 0),
    k => w(k)[0] === tt[0] && (tt.length === 1 || w(k).length === 1),
    k => Math.min(k.length, t.length) >= 6 && editDistance(k, t) <= 2,
  ];
  for (let i = 0; i < rules.length; i++) {
    const hit = people.filter(p => p.keys.some(rules[i])).map(p => p.u).filter((u, j, a) => a.indexOf(u) === j);
    if (hit.length === 1) return hit[0];
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
  hubLogin: hubLogin, loginInfo: loginInfo, bookingByMobile: bookingByMobile, bookingInfo: bookingInfo, confirmBooking: confirmBooking,
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
  saveBooking: saveBooking, bookingAction: bookingAction, bookingList: bookingList,
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
  const rows = readTable('Candidates').filter(c => c.week_ending === we && truthy(c.in_room) && !c.outcome && !noCallNeeded(c));
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
  try { maybeCallbackReminders(); } catch (e) { console.error(e); }
  maybeAcademyBriefing();
  maybeDay1Reminder();
  try { maybeBookingReminders(); } catch (e) { console.error(e); }
  try { maybeMissedBookings(); } catch (e) { console.error(e); }
}

/** Every day at THANKS_TIME: Jess / Rubal get "N thank-you messages to send" for today's appointments not thanked yet.
 *  Nothing to send = no message. Tapping it opens their send list. */
function maybeThanksReminder() {
  const now = nowStr(), today = now.slice(0, 10), hm = now.slice(11, 16);
  if (hm < CONFIG.THANKS_TIME || hm > '20:59') return;
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('THANKS_REMINDED') === today) return;
  p.setProperty('THANKS_REMINDED', today);  // claim it first so an overlapping run can't send twice
  const rows = readTable('Candidates').filter(c => c.attended_date === today && !c.thanks_sent_at && !walkedOut(c));  // no thank-you for a walk out
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

/** "Thinking it over" → when the call-back time they asked for comes, whoever logged it gets "🔁 Call Pooja back now" (once per time;
 *  not for times more than 12 hours gone, e.g. after the app was down). Runs from keepWarm, every 5 minutes. */
function maybeCallbackReminders() {
  const now = nowStr(), from = Utilities.formatDate(new Date(Date.now() - 12 * 3600000), CONFIG.TZ, 'yyyy-MM-dd HH:mm');
  const due = c => c.outcome === 'Thinking it over' && c.callback_at && c.callback_at <= now && c.callback_at >= from && c.callback_nudged !== c.callback_at;
  const ids = readTable('Candidates').filter(due).map(c => c.id);
  if (!ids.length) return;
  const send = withLock(() => ids.map(id => getC(id)).filter(due).map(c => { c.callback_nudged = c.callback_at; writeRow('Candidates', c); return c; }));
  send.forEach(c => {
    const u = userById(c.callback_by_id) || userById(c.booker_id);
    notify([u], '🔁 Call ' + c.full_name.split(' ')[0] + ' back now', 'They asked for a call back at ' + c.callback_at.slice(11, 16) + ' (Thinking it over). Tap to call.', c.id);  // notify logs it
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
 *  log (rated in the room, no outcome yet) · callback (No answer / Thinking it over) · stale (those, over 2 weeks).
 *  Day 1 people (Academy booked: Day 1 text, not confirmed, no-show, admin's decision) are on the Day 1 tab only (Angad, 19 Oct). */
const BOOKER_LEAKS = ['stale', 'log', 'callback'];
function leakOf(c, today) {
  const from = addDays(today, -(CONFIG.CHASE_DAYS - 1));
  if (c.outcome === 'Academy booked') return '';
  if (!truthy(c.in_room) || noCallNeeded(c)) return '';
  // No answer / Thinking it over never just drop off: after 2 weeks they're "stale" until someone logs a final answer
  // (Declined, Not suitable, Academy booked). A call-back time they asked for that's still to come keeps them as a call back.
  if (c.outcome === 'No answer' || c.outcome === 'Thinking it over') return c.attended_date < from && !(c.callback_at > nowStr()) ? 'stale' : 'callback';
  if (c.attended_date < from) return '';
  return c.outcome ? '' : 'log';
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
/** Chase goes week by week (week ending Sunday): a chase belongs to its appointment's week, or to a later call-back's
 *  week ("call me next Tuesday" is next week's job). Anything from before this week still open is "carried over". */
function chaseWeek(c) {
  const cb = String(c.callback_at || '').slice(0, 10);
  return weekEnding(cb > c.attended_date ? cb : c.attended_date);
}
/** What's on Chase now: this week's plus carried over (call-backs booked for later weeks wait for their week). */
function chaseNow(u) {
  const cw = weekEnding(todayStr());
  return chaseRows(u).filter(x => chaseWeek(x.c) <= cw);
}
function chaseList(req, u) {
  return { today: todayStr(), weekEnding: weekEnding(todayStr()), days: CONFIG.CHASE_DAYS, items: chaseRows(u).map(x => Object.assign(shape(x.c, u), { leak: x.k })) };
}
const LEAK_LINES = [['stale', '🔴 Stale: close it out'], ['log', '📞 Log the call'], ['callback', '🔁 Call back']];
/** Admin, one tap (Chase tab): every booker with someone to chase gets an alert listing exactly who (email if they're not set up).
 *  Only the week on screen (req.week; this week also takes in what's carried over). The same booker isn't nudged twice in 30 minutes. */
function chaseOutcomes(req, u) {
  if (!isAdmin(u)) throw new Error('Admin only');
  const today = todayStr(), now = nowStr(), only = Array.isArray(req.ids) && req.ids.length ? req.ids : null;
  const cw = weekEnding(today), week = /^\d{4}-\d{2}-\d{2}$/.test(req.week || '') ? weekEnding(req.week) : cw;
  const inView = c => { const w = chaseWeek(c); return w === week || (week === cw && w < cw); };
  const by = {};
  chaseRows(u).forEach(x => { if (x.c.booker_id && BOOKER_LEAKS.indexOf(x.k) >= 0 && inView(x.c)) { const b = (by[x.c.booker_id] = by[x.c.booker_id] || {}); (b[x.k] = b[x.k] || []).push(x.c); } });
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

/** Everyone booked onto the BA Academy: admins see everyone, bookers their own. The Day 1 tab goes week by week, like the
 *  All tab (Angad, 20 Oct): with no week asked for, last week's Monday onwards (last week, this week, every week ahead);
 *  { weekEnding } = that week only (Mon–Sun), for going back further. Admins also get the bookings waiting on their
 *  decision (these used to be on Chase). */
function academyList(req, u) {
  try { backfillSends(); } catch (e) { console.error(e); }
  const today = todayStr(), longer = addDays(today, -(CONFIG.CHASE_DAYS - 1));
  const we = /^\d{4}-\d\d-\d\d$/.test(req.weekEnding || '') ? weekEnding(req.weekEnding) : '';
  const from = we ? addDays(we, -6) : addDays(weekEnding(today), -13);
  const booked = readTable('Candidates').filter(c => c.outcome === 'Academy booked' && c.admin_status !== 'rejected' && c.academy_date && fullAccess(u, c));
  const rows = booked.filter(c => c.admin_status !== 'pending' && c.academy_date >= from && (!we || c.academy_date <= we));
  const out = { today: today, from: from, items: rows.sort((a, b) => a.academy_date.localeCompare(b.academy_date) || a.full_name.localeCompare(b.full_name)).map(c => shape(c, u)) };
  if (we) out.weekEnding = we;
  else if (isAdmin(u)) out.pending = booked.filter(c => c.admin_status === 'pending' && c.academy_date >= longer).map(c => shape(c, u));
  return out;
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
/** A Log time as 'yyyy-MM-dd HH:mm'. The Log tab's time column turned its text into real dates (Sheets did it),
 *  so it reads back as "Thu Oct 15 2026 16:35:00 GMT+0100…": handle both. '' if it isn't a time. */
function tsText(v) {
  const s = String(v == null ? '' : v);
  if (/^\d{4}-\d\d-\d\d \d\d:\d\d/.test(s)) return s.slice(0, 16);
  const d = s ? new Date(s) : null;
  return d && !isNaN(d.getTime()) ? Utilities.formatDate(d, CONFIG.TZ, 'yyyy-MM-dd HH:mm') : '';
}
/** Once: the call log for outcomes logged before it existed, from the Log ("outcome · No answer LATE" by Fiza at 11:59).
 *  The latest one gets its Day 1 date and notes from the candidate. One write for the whole column (runs from keepWarm). */
function backfillOutcomes() {
  // _2: the first run (15 Oct) read the Log's times as blank; it fills them in for those call logs
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('OUTCOMES_BACKFILLED_2')) return;
  withLock(() => {
    if (p.getProperty('OUTCOMES_BACKFILLED_2')) return;
    const by = {};
    readTable('Log').forEach(l => {
      if (!l.candidate_id || (l.action !== 'outcome' && l.action !== 'admin_rejected')) return;
      const at = tsText(l.at);
      const e = l.action === 'outcome' ? { at: at, by: l.user, o: String(l.detail).replace(/ LATE$/, '') }
        : { at: at, by: l.user, o: 'Not suitable', n: 'Academy booking rejected' + (l.detail ? ': ' + l.detail : '') };
      if (/ LATE$/.test(l.detail) && l.action === 'outcome') e.late = 1;
      (by[l.candidate_id] = by[l.candidate_id] || []).push(e);
    });
    const rows = readTable('Candidates');
    const vals = rows.map(c => {
      const l = by[c.id];
      let had = []; try { had = c.outcome_log ? JSON.parse(c.outcome_log) : []; } catch (e) { had = []; }
      if (!Array.isArray(had)) had = [];
      if (!l || (had.length && had.every(e => e.at))) return [c.outcome_log];  // nothing in the Log, or already complete
      // Keep entries saved since (they have their own time and notes); the rest come from the Log
      const keep = had.filter(e => e.at), add = l.slice();
      keep.forEach(k => { const i = add.findIndex(e => e.at === k.at && e.o === k.o); if (i >= 0) add.splice(i, 1); });  // one each: two saves can share a minute
      const all = add.concat(keep).sort((a, b) => String(a.at).localeCompare(String(b.at)) || (keep.indexOf(a) >= 0) - (keep.indexOf(b) >= 0));
      const last = all[all.length - 1];
      if (add.indexOf(last) >= 0 && last.o === c.outcome) { if (c.academy_date) last.d = c.academy_date; if (c.outcome_notes) last.n = c.outcome_notes.slice(0, 300); }
      return [JSON.stringify(all.slice(-30))];
    });
    if (rows.length) sheet('Candidates').getRange(2, SHEETS.Candidates.indexOf('outcome_log') + 1, rows.length, 1).setValues(vals);
    delete MEMO.Candidates;
    p.setProperty('OUTCOMES_BACKFILLED_2', nowStr());
  });
}
/** On Day 1: arrived / no-show (or clear it). Admins, or the person who booked them. Gives the real show-up rate.
 *  next_day / prev_day: some starters are booked for Tuesday instead of the usual Monday (Angad, 19 Oct). Their Day 1
 *  moves a day (still confirmed), before the day or on it, so they're on that day's list and its PDF, never a Monday
 *  no-show. prev_day undoes it. dropped: they've pulled out (Angad, 26 Oct), before the day or on it: off the reminders and the
 *  expected count, at the bottom of the list; '' puts them back. */
function markDay1(req, u) {
  if (['arrived', 'no_show', 'dropped', 'next_day', 'prev_day', ''].indexOf(req.status) < 0) throw new Error('Choose arrived, no-show or dropped out');
  const move = req.status === 'next_day' || req.status === 'prev_day';
  return withLock(() => {
    const c = getC(req.id);
    if (!fullAccess(u, c)) throw new Error('No access');
    if (c.outcome !== 'Academy booked') throw new Error('They aren\'t booked onto the Academy.');
    if (req.status && !move && req.status !== 'dropped' && c.academy_date > todayStr()) throw new Error('Their Day 1 hasn\'t happened yet.');
    if (move) {
      const from = c.academy_date, to = addDays(from, req.status === 'next_day' ? 1 : -1);
      if (to < todayStr()) throw new Error('That day has already gone.');
      c.academy_date = to; c.day1_status = ''; c.day1_by = ''; c.day1_at = '';
      writeRow('Candidates', c);
      log(u, 'day1_moved', c.id, from + ' → ' + to);
      return shape(c, u);
    }
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
  const rows = readTable('Candidates').filter(c => c.outcome === 'Academy booked' && c.academy_date === tomorrow && c.admin_status !== 'rejected' && c.admin_status !== 'pending' &&
    c.day1_status !== 'dropped');
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
// ───────────────────────── BOOKING A PRESENTATION, straight after the call (Angad, 23 Oct) ─────────────────────────
// Jess, Rubal and Angad call the applicants (Teamtailor CVs, all JUSS), book them into a 10:00 presentation in the app, and send
// the confirmation from their own WhatsApp. The evening before, whoever booked them gets "N to remind for tomorrow"; anyone who
// hasn't checked in by 10:30 "didn't come" (a "sorry we missed you" + rebook). At check-in their mobile finds the booking.
const BOOK_SOURCES = ['Teamtailor', 'Indeed', 'Referral', 'Other'];
function bookTeam() {
  const emails = (CONFIG.BOOK_TEAM || []).map(e => String(e).toLowerCase());
  return usersAll().filter(x => truthy(x.active) && emails.indexOf(String(x.email).toLowerCase()) >= 0).map(x => ({ id: x.id, name: x.name }));
}
function canBook(u) { return !!u && bookTeam().some(t => t.id === u.id); }
function bookOut(b) { const o = Object.assign({}, b); delete o._row; return o; }
function getBooking(id) {
  const r = rowOfId('Bookings', id);
  if (!r) throw new Error('Booking not found');
  return readRow('Bookings', r);
}
/** Bookings from a week ago onwards (cancelled ones left off): the Today page's "Expected today", "Coming up" and "Didn't come". */
function bookingList(req, u) {
  if (!canBook(u)) return { items: [] };
  const from = addDays(weekEnding(todayStr()), -13);  // last week's Monday: Book Appts goes back a week, day by day or the whole week
  // Booked before CONFIRM existed (23 Oct): give them their page now
  if (readTable('Bookings').some(b => b.status === 'booked' && b.slot_date >= from && !b.confirm_token)) {
    withLock(() => { delete MEMO.Bookings; readTable('Bookings').filter(b => b.status === 'booked' && !b.confirm_token).forEach(b => { b.confirm_token = token().slice(0, 24); writeRow('Bookings', b); }); });
  }
  return { items: readTable('Bookings').filter(b => b.status !== 'cancelled' && b.slot_date >= from).map(bookOut) };
}
/** The open booking a check-in on this mobile belongs to: the one nearest today (they may come on another day than booked). */
function bookingFor(mobile, today, name) {
  const open = readTable('Bookings').filter(b => b.status === 'booked'), near = b => Math.abs(daysBetween(today, b.slot_date));
  const byMobile = open.filter(b => b.mobile === mobile && b.slot_date >= addDays(today, -14) && b.slot_date <= addDays(today, 60))
    .sort((a, b) => near(a) - near(b) || a.slot_date.localeCompare(b.slot_date))[0];
  if (byMobile || !name) return byMobile || null;
  // Typed another number than the one on their booking (a second phone, a typo at booking): today's booking under the same
  // full name, if it's the only one (Angad, 26 Oct: "make sure booked appointments go on the list properly")
  const key = s => String(s || '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
  const same = open.filter(b => b.slot_date === today && key(b.first_name + ' ' + b.last_name) === key(name));
  return same.length === 1 ? same[0] : null;
}
/** Check-in page: their mobile → "Found your booking: today 10:00, booked by Jess Grace" (who booked them, nothing about them). */
function bookingByMobile(req) {
  const m = normMobile(req.mobile), today = todayStr();
  const b = m ? readTable('Bookings').filter(x => x.status === 'booked' && x.mobile === m && x.slot_date === today)[0] : null;
  const u = b ? userById(b.booked_by_id) : null;
  return b && u ? { found: true, booker_id: u.id, booker_name: u.name, booker_company: u.company, company: b.company, time: b.slot_time } : { found: false };
}
/** Their "You're booked in" page (booked.html?t=…): only what the page shows, nothing else about them. */
function bookingByToken(t) {
  const b = t && String(t).length >= 16 ? readTable('Bookings').filter(x => x.confirm_token === String(t))[0] : null;
  if (!b || b.status === 'cancelled') throw new Error('This link has expired. Message the person who booked you and they\'ll sort it.');
  return b;
}
function bookingInfo(req) {
  const b = bookingByToken(req.t), u = userById(b.booked_by_id);
  return { first_name: b.first_name, slot_date: b.slot_date, slot_time: b.slot_time || CONFIG.BOOK_TIME, company: b.company || CONFIG.BOOK_CO,
    confirmed_at: b.confirmed_at, came: b.status === 'came', booker: u ? u.name.split(' ')[0] : '', today: todayStr() };
}
/** They tapped 🔒 Confirm I'm coming: confirmed in the app, and whoever booked them hears about it (once). */
function confirmBooking(req) {
  const b = withLock(() => {
    delete MEMO.Bookings;
    const x = bookingByToken(req.t);
    if (!x.confirmed_at && x.status === 'booked') { x.confirmed_at = nowStr(); x.confirmed_by = 'CONFIRM'; x.updated_at = nowStr(); writeRow('Bookings', x); x._new = true; }
    return x;
  });
  if (b._new) {
    log(null, 'booking_confirmed', b.candidate_id || '', b.first_name + ' ' + b.last_name + ' · ' + b.slot_date);
    notify([userById(b.booked_by_id)], '✅ ' + b.first_name + ' confirmed ' + DAYS_LONG[weekday(b.slot_date)] + '\'s presentation',
      bookingName(b) + ' tapped CONFIRM for ' + longDate(b.slot_date) + ' at ' + (b.slot_time || CONFIG.BOOK_TIME) + '.', 'book');
  }
  return { confirmed_at: b.confirmed_at };
}
function bookingName(b) { return (b.first_name + ' ' + (b.last_name || '')).trim(); }
/** New booking, or a booking moved to another day (its messages start again: the new day needs confirming).
 *  rebook_of: they missed one; it stays as a no-show and this is a new booking. */
function saveBooking(req, u) {
  if (!canBook(u)) throw new Error('Presentations are booked by ' + (orList(bookTeam().map(t => t.name.split(' ')[0])) || 'the booking team') + '.');
  const f = req.booking || {}, today = todayStr();
  const first = cleanName(f.first_name), last = cleanName(f.last_name), mobile = normMobile(f.mobile), day = String(f.slot_date || '');
  if (!first) throw new Error('Add their first name.');
  if (!mobile) throw new Error('Add a valid UK mobile (07…).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < today) throw new Error('Pick the day of their presentation.');
  if (weekday(day) === 0 || weekday(day) === 6) throw new Error('Presentations are Monday to Friday.');
  if (day > addDays(today, 60)) throw new Error('That\'s more than 2 months away.');
  const source = BOOK_SOURCES.indexOf(f.source) >= 0 ? f.source : BOOK_SOURCES[0];
  const notes = String(f.notes || '').trim().slice(0, 300);
  return withLock(() => {
    if (f.id) {
      const b = getBooking(f.id);
      if (b.status !== 'booked') throw new Error(b.status === 'came' ? 'They\'ve already checked in.' : 'This booking was cancelled.');
      const moved = b.slot_date !== day;
      Object.assign(b, { first_name: first, last_name: last, mobile: mobile, source: source, notes: notes, slot_date: day, updated_at: nowStr() });
      if (moved) ['confirm_at', 'confirm_by', 'confirm_via', 'confirmed_at', 'confirmed_by', 'remind_at', 'remind_by', 'remind_via', 'missed_at', 'missed_by', 'missed_via'].forEach(k => { b[k] = ''; });
      writeRow('Bookings', b);
      log(u, moved ? 'booking_moved' : 'booking_edited', '', first + ' ' + last + ' → ' + day);
      return bookOut(b);
    }
    const open = readTable('Bookings').filter(x => x.status === 'booked' && x.mobile === mobile && x.slot_date >= today && x.id !== f.rebook_of)[0];
    if (open) throw new Error('Already booked for ' + longDate(open.slot_date) + ' (by ' + open.booked_by.split(' ')[0] + '). Open their booking to change the day.');
    const old = f.rebook_of ? getBooking(f.rebook_of) : null;
    if (old && old.status === 'booked') { old.status = 'no_show'; old.updated_at = nowStr(); writeRow('Bookings', old); }
    const b = appendRow('Bookings', {
      id: uid(), created_at: nowStr(), booked_by_id: u.id, booked_by: u.name, first_name: first, last_name: last, mobile: mobile,
      source: source, notes: notes, slot_date: day, slot_time: CONFIG.BOOK_TIME, company: CONFIG.BOOK_CO, status: 'booked', confirm_token: token().slice(0, 24),
      rebook_of: old ? old.id : '', no_whatsapp: old ? old.no_whatsapp : '', updated_at: nowStr(),
    });
    log(u, old ? 'booking_rebooked' : 'booking', '', first + ' ' + last + ' → ' + day);
    return bookOut(b);
  });
}
/** act: sent (kind confirm · remind · missed, via whatsapp · sms) · yes (they replied YES) · cancel. */
function bookingAction(req, u) {
  if (!canBook(u)) throw new Error('Only the booking team can do that.');
  const via = req.via === 'sms' ? 'sms' : 'whatsapp';
  if (['sent', 'yes', 'cancel'].indexOf(req.act) < 0 || (req.act === 'sent' && ['confirm', 'remind', 'missed'].indexOf(req.kind) < 0)) throw new Error('Unknown action');
  return withLock(() => {
    const b = getBooking(req.id);
    if (req.act === 'sent') {
      b[req.kind + '_at'] = nowStr(); b[req.kind + '_by'] = u.name; b[req.kind + '_via'] = via;
      if (via === 'sms') b.no_whatsapp = 'TRUE';  // not on WhatsApp: their next message goes by text too
    }
    if (req.act === 'yes' && !b.confirmed_at) { b.confirmed_at = nowStr(); b.confirmed_by = u.name; }
    if (req.act === 'cancel') { if (b.status !== 'booked') throw new Error('Only a booking still to come can be cancelled.'); b.status = 'cancelled'; }
    b.updated_at = nowStr();
    writeRow('Bookings', b);
    log(u, 'booking_' + (req.act === 'sent' ? via + '_' + req.kind : req.act), b.candidate_id || '', b.first_name + ' ' + b.last_name + ' · ' + b.slot_date);
    return bookOut(b);
  });
}
/** BOOK_REMIND_TIME the evening before (Sunday for Monday's): whoever booked them gets "📲 N to remind for tomorrow". */
function maybeBookingReminders() {
  const now = nowStr(), today = now.slice(0, 10), hm = now.slice(11, 16);
  if (hm < CONFIG.BOOK_REMIND_TIME || hm > '21:59') return;
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('BOOK_REMINDED') === today) return;
  p.setProperty('BOOK_REMINDED', today);  // claim it first so an overlapping run can't send twice
  const tomorrow = addDays(today, 1);
  const rows = readTable('Bookings').filter(b => b.status === 'booked' && b.slot_date === tomorrow && String(b.remind_at).slice(0, 10) !== today);
  const by = {};
  rows.forEach(b => { (by[b.booked_by_id] = by[b.booked_by_id] || []).push(b); });
  Object.keys(by).forEach(id => {
    const list = by[id];
    notify([userById(id)], '📲 ' + list.length + ' to remind for tomorrow', DAYS_LONG[weekday(tomorrow)] + '\'s ' + CONFIG.BOOK_TIME + ' presentation: ' +
      list.map(b => b.first_name + (b.confirmed_at ? ' ✅' : ' ⏳')).join(', ') + '. Tap to send the reminders, signed by you.', 'bookrem');
  });
}
/** BOOK_MISSED_TIME on the day: whoever booked them hears who didn't come, with a "sorry we missed you" to send. */
function maybeMissedBookings() {
  const now = nowStr(), today = now.slice(0, 10), hm = now.slice(11, 16);
  if (hm < CONFIG.BOOK_MISSED_TIME || hm > '16:59') return;
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('BOOK_MISSED') === today) return;
  p.setProperty('BOOK_MISSED', today);
  const rows = readTable('Bookings').filter(b => b.status === 'booked' && b.slot_date === today);
  const by = {};
  rows.forEach(b => { (by[b.booked_by_id] = by[b.booked_by_id] || []).push(b); });
  Object.keys(by).forEach(id => {
    const list = by[id];
    notify([userById(id)], '😕 ' + list.length + ' didn\'t come today', firstNames(list.map(b => ({ full_name: b.first_name })), 6) +
      ' didn\'t check in for the ' + CONFIG.BOOK_TIME + ' presentation. Tap to send "sorry we missed you" and rebook them.', 'bookmiss');
  });
}
/** Show-up for the week (admins, Appts Attended): booked vs came, by who booked them and where they applied.
 *  Today's only count once BOOK_MISSED_TIME has passed (before that, the ones still to come aren't no-shows). */
function showupFor(we) {
  const mon = addDays(we, -6), fri = addDays(we, -2), now = nowStr(), today = now.slice(0, 10), past = now.slice(11, 16) >= CONFIG.BOOK_MISSED_TIME;
  const rows = readTable('Bookings').filter(b => b.status !== 'cancelled' && b.slot_date >= mon && b.slot_date <= fri &&
    (b.slot_date < today || (b.slot_date === today && (past || b.status === 'came'))));
  const by = {}, src = {};
  rows.forEach(b => {
    const k = b.booked_by_id, s = b.source || 'Other';
    by[k] = by[k] || { id: k, name: b.booked_by, booked: 0, came: 0 };
    src[s] = src[s] || { source: s, booked: 0, came: 0 };
    by[k].booked++; src[s].booked++;
    if (b.status === 'came') { by[k].came++; src[s].came++; }
  });
  const list = o => Object.keys(o).map(k => o[k]).sort((a, b) => b.booked - a.booked);
  return { rows: list(by), sources: list(src), booked: rows.length, came: rows.filter(b => b.status === 'came').length };
}
/** After 12 weeks a booking keeps who, when and whether they came; the notes from the call and their page's link go. */
function trimOldBookings(before) {
  readTable('Bookings').forEach(b => { if (b.slot_date && b.slot_date < before && (b.notes || b.confirm_token)) { b.notes = ''; b.confirm_token = ''; writeRow('Bookings', b); } });
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
  // Signed under the other company (Jess sending a JUSS email, Rubal a LINK one): "In association with …" (Angad, 20 Oct)
  const signCo = homeCo(u.email) && homeCo(u.email) !== co ? 'In association with ' + o.brand : o.brand;
  // After launch the playbook button goes through the hub: they sign in with this email and land in their own playbook
  const pbUrl = hubOn() ? hubLink(co === 'JUSS' ? 'hf' : 'fr', '/') : o.playbook[1];
  // The app's look (Angad, 20 Oct: "more immersive, like we have the app"): the dark stage with the brand's glow on top,
  // light cards below, and Week 1 as cards that step up like the Sales Skill Ladder instead of the poster
  const S = co === 'JUSS'
    ? { bg: '#EDF5F5', line: '#CFE4E6', tint: '#DDF2F3', dark: '#0D2833', solid: '#2BA9B8',
        stage: 'radial-gradient(55% 110% at 96% 0%,rgba(237,160,58,.55) 0%,rgba(237,160,58,0) 70%),radial-gradient(60% 130% at 66% 0%,rgba(52,177,192,.45) 0%,rgba(52,177,192,0) 70%),radial-gradient(130% 160% at 85% 0%,#1D5566 0%,#0D2833 55%,#071820 100%)',
        grad: 'linear-gradient(120deg,#E4613F 0%,#EDA03A 48%,#34B1C0 100%)' }
    : { bg: '#F7F1EC', line: '#EEDED3', tint: '#FFEBE1', dark: '#17171D', solid: '#F15A24',
        stage: 'radial-gradient(60% 120% at 94% 0%,rgba(241,90,36,.62) 0%,rgba(241,90,36,0) 70%),radial-gradient(130% 160% at 85% 0%,#2C2C38 0%,#17171D 55%,#0F0F14 100%)',
        grad: 'linear-gradient(120deg,#FF8A3D 0%,#F15A24 48%,#CF3A10 100%)' };
  const F = "font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
  const D_ = "font-family:Impact,'Arial Black','Helvetica Neue',sans-serif;";
  const d1 = c.academy_date, img = CONFIG.PUBLIC_URL ? CONFIG.PUBLIC_URL + 'img/' : '';
  // Their own welcome page, in the company this email is for (Jess sending a JUSS starter's email as LINK: the LINK page)
  const wUrl = c.welcome_token ? welcomeUrl(Object.assign({}, c, { brand: co })) : '';
  const ymd = d1.replace(/-/g, ''), title = 'BA Academy Day 1 – ' + o.brand;
  const gcal = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(title) + '&dates=' + ymd + 'T133000/' + ymd + 'T180000&ctz=Europe/London' +
    '&location=' + encodeURIComponent(CONFIG.OFFICE_ADDRESS) + '&details=' + encodeURIComponent('Induction 1:30pm. Bring a notepad and pen, photo ID and your right-to-work share code.');
  // Gmail's dark theme (its own setting, not the phone's: Angad's phone was light, his Gmail dark) recolours emails: white
  // text on our colours went dark, and the light page and cards went dark. Every background is set as background-image
  // (Gmail leaves those alone), white text sits in white() and dark text in dk(): Gmail-only CSS (u + .body) that undoes
  // its recolouring, so the email looks the same in its light and dark themes. Nothing changes in other apps. Emojis stay
  // outside both (inside, their colours would be flipped).
  // dk() is two white layers that cancel out (difference), so nothing shows behind the text in either theme. The first
  // version (black + white) left a grey box behind every line in Gmail's dark theme, which makes white #202124, not black
  // (Angad's phone, 20 Oct: "it's underlining everything"). If a Gmail can't blend, the worst case is a white box.
  const white = s => '<span class="jls" style="display:inline-block"><span class="jld" style="display:inline-block">' + s + '</span></span>';
  const dk = s => '<span class="jks" style="display:inline-block"><span class="jkd" style="display:block">' + s + '</span></span>';
  // Text inside a table always gets its own colour, size and weight: iPhone Mail can open an email in "quirks" mode, where
  // a table forgets the colour, size and weight around it (Angad's phone, 20 Oct: Day 4's title and words went dark on
  // the dark card, and the day titles thin). TXT is the usual body text.
  const TXT = F + 'font-size:15px;line-height:1.5;font-weight:400;color:#22222B;';
  /** An emoji beside a line of text (side by side: a long line would push the emoji onto its own line). */
  const iconRow = (emoji, s, size, ts) => '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="width:' + (size || 26) + 'px;vertical-align:top;font-size:17px;line-height:1.5">' + emoji + '</td>' +
    '<td style="vertical-align:top;' + (ts || TXT) + '">' + dk(s) + '</td></tr></table>';
  /** A light card's outline: Gmail's dark theme turns a border black, so it's a frame of background-image instead
   *  (1px of the brand's line colour; 2px of its gradient for the first day on badge). */
  const framed = (style, inner, frame) => '<tr><td style="padding:' + (frame ? 2 : 1) + 'px;border-radius:23px;' + (frame || fill(S.line)) + '"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td style="border-radius:' + (frame ? 21 : 22) + 'px;' + fill('#ffffff') + style + '">' + inner + '</td></tr></table></td></tr>';
  const split = (s, wrap) => { const m = /^([^\x00-\x7E]\S*) (.*)$/.exec(s); return m ? m[1] + ' ' + wrap(m[2]) : wrap(s); };
  const fill = col => 'background:' + col + ';background-image:linear-gradient(' + col + ',' + col + ');';
  const stageBg = 'background:' + S.dark + ';background-image:' + S.stage + ';';
  const gradBg = 'background:' + S.solid + ';background-image:' + S.grad + ';';
  const btn = (label, url, solid) => '<a href="' + esc(url) + '" style="display:inline-block;margin:6px 6px 0 0;padding:12px 18px;border-radius:14px;' + F + 'font-weight:800;font-size:15px;text-decoration:none;' +
    (solid ? gradBg + 'color:#ffffff;border:0;">' + split(label, white) : fill(S.tint) + 'color:#22222B;border:0;">' + split(label, dk)) + '</a>';
  const bigBtn = (label, url) => '<a href="' + esc(url) + '" style="display:block;margin:10px 0 0;padding:16px 18px;border-radius:16px;text-align:center;' + F + 'font-weight:800;font-size:16px;text-decoration:none;color:#ffffff;' + gradBg + '">' + split(label, white) + '</a>';
  const gap = h => '<tr><td style="height:' + h + 'px;line-height:' + h + 'px;font-size:0">&nbsp;</td></tr>';
  /** A section heading like the app's: emoji tile, label, one line under it. */
  const head = (emoji, label, sub) => '<tr><td style="padding:28px 2px 12px;' + F + '"><table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
    '<td style="width:40px;height:40px;border-radius:13px;' + fill(S.tint) + 'text-align:center;font-size:19px;line-height:40px">' + emoji + '</td>' +
    '<td style="padding-left:12px;font-size:13px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#22222B">' + dk(label) +
    (sub ? '<div style="font-size:14px;font-weight:500;letter-spacing:0;text-transform:none;color:#6E6C78;margin-top:2px">' + dk(sub) + '</div>' : '') + '</td></tr></table></td></tr>';
  const card = inner => framed('padding:20px;' + F + 'font-size:15px;line-height:1.5;color:#22222B', inner);
  /** The numbered tile (Business Development steps, the Week 1 cards): brand gradient, white number. */
  const tile = (n, size) => '<span style="display:inline-block;width:' + size + 'px;height:' + size + 'px;line-height:' + size + 'px;border-radius:' + Math.round(size / 3) + 'px;text-align:center;' + gradBg +
    'color:#ffffff;' + D_ + 'font-weight:400;font-size:' + Math.round(size * .46) + 'px">' + white(n) + '</span>';
  const pill = (emoji, t) => '<span style="display:inline-block;padding:6px 12px;border-radius:999px;' + F + 'font-weight:800;font-size:14px;line-height:1.5;' +
    fill(S.tint) + 'color:#22222B">' + emoji + ' ' + dk(t) + '</span>';
  /** The day's label, as the welcome page shows it: a dark pill. */
  const dayPill = t => '<span style="display:inline-block;padding:4px 11px;border-radius:999px;' + F + 'font-size:12px;line-height:1.5;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#ffffff;' +
    fill(S.dark) + '">' + white(t) + '</span>';
  /** The Skill Ladder's level meter: how far into the week this day is. */
  const meter = (lit, total) => '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px"><tr>' +
    Array.from({ length: total }, (x, j) => '<td style="padding:0 ' + (j < total - 1 ? 4 : 0) + 'px 0 0"><div style="height:5px;border-radius:99px;font-size:0;line-height:0;' +
      (j < lit ? gradBg : fill(S.tint)) + '">&nbsp;</div></td>').join('') + '</tr></table>';
  const step = (n, t) => '<tr><td style="vertical-align:top;width:40px;padding:7px 0">' + tile(String(n), 30) + '</td><td style="padding:7px 0 7px 10px;' + TXT + 'line-height:1.45">' + dk(t) + '</td></tr>';
  const chip = (emoji, t) => '<span style="display:inline-block;margin:0 6px 8px 0;padding:9px 14px;border-radius:14px;' + fill(S.tint) + 'color:#22222B;font-weight:700;font-size:15px">' + emoji + ' ' + dk(t) + '</span>';
  const pre = '<div style="display:none;max-height:0;overflow:hidden;opacity:0">You\'re in, ' + esc(first) + ' 🎉 Day 1: ' + esc(longDate(d1)) + ' @ 1:30 PM. Activate FieldIQ from its invite and read your ' + esc(o.playbook[0]) + ' before you come in.</div>';

  // Week 1: a card a day, stepping up to the first day on badge (framed in the brand's gradient, like Mastery on the ladder).
  // All four white: the dark Day 4 card was hard to read on iPhone Mail (Angad, 20 Oct: "do it in the same white background")
  // Day 4 onwards for both companies (Angad, 20 Oct: LINK "should be Thursday onwards like on JUSS")
  const W = o.week1, dayName = i => 'Day ' + (i + 1) + (i === W.length - 1 ? ' onwards' : '') + ' · ' + longDate(addDays(d1, i));
  const day1More = '<div style="margin-top:12px">' + iconRow('📍', esc(CONFIG.OFFICE_ADDRESS) + '<br><span style="color:#6E6C78;font-size:13px">2 mins from Slough station</span>') + '</div>' +
    '<div style="margin-top:4px">' + btn('🗺️ Google Maps', o.maps, true) + btn('📅 Add to calendar', gcal) + '</div>';
  const dayCard = (r, i) => {
    const last = i === W.length - 1;
    const inner = meter(i + 1, W.length) +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="width:58px;vertical-align:middle">' + tile('0' + (i + 1), 46) + '</td>' +
      '<td style="vertical-align:middle;padding-left:12px">' + dayPill(esc(dayName(i))) +
        '<div style="margin:6px 0 0">' + iconRow(r[0], esc(r[1]), 30, F + 'font-size:20px;font-weight:900;letter-spacing:-.01em;line-height:1.25;color:#22222B;') + '</div></td></tr>' +
      '<tr><td colspan="2" style="padding-top:12px">' + pill('⏰', esc(r[2])) +
        '<div style="margin-top:10px;' + TXT + 'color:#3A3942">' + dk(esc(r[3])) + '</div>' + (i === 0 ? day1More : '') +
      '</td></tr></table>';
    return framed('padding:18px 20px 20px;' + TXT, inner, last ? gradBg : '') + (last ? '' : gap(10));
  };

  const logoW = co === 'JUSS' ? 90 : 51;  // the logo's width at 56px high, so its box keeps its shape before the image loads
  // iPhone Mail underlined every date and time as a link (Angad's phone, 20 Oct): the meta asks it not to, and the CSS makes
  // any it still finds look like the text around them (phone numbers stay tappable)
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">' +
    '<meta name="format-detection" content="date=no,address=no,email=no">' +
    '<style>a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important}' +
    'u + .body .jls{background:#000;mix-blend-mode:screen}u + .body .jld{background:#000;mix-blend-mode:difference}' +
    'u + .body .jks{background:#fff;mix-blend-mode:difference}u + .body .jkd{background:#fff;mix-blend-mode:difference}</style></head>' +
    '<body class="body" style="margin:0;padding:0;' + fill(S.bg) + '">' + pre +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="' + fill(S.bg) + '"><tr><td align="center" style="padding:18px 12px 30px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">' +
    // Hero: the app's dark stage with the brand's light on it
    '<tr><td style="border-radius:28px;padding:24px 24px 28px;' + stageBg + F + 'color:#ffffff">' +
      '<div style="height:5px;width:64px;border-radius:99px;font-size:0;line-height:0;margin:0 0 18px;' + gradBg + '">&nbsp;</div>' +
      (img ? '<div style="display:inline-block;' + fill('#ffffff') + 'border-radius:18px;padding:8px 12px;margin-bottom:18px"><img src="' + img + 'logo-' + co.toLowerCase() + '.png" alt="' + esc(o.brand) + '" width="' + logoW + '" height="56" style="display:block;width:' + logoW + 'px;height:56px;border:0"></div>' : '') +
      '<div style="font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;margin:0 0 6px">' + white(esc(o.brand) + ' · BA Academy') + '</div>' +
      '<div style="font-size:32px;line-height:1.1;font-weight:900;letter-spacing:-.02em;margin:0 0 12px">' + white('You\'re in, ' + esc(first)) + ' 🎉</div>' +
      '<div style="font-size:17px;line-height:1.45;margin:0 0 18px">' + white('Welcome to the <b>' + esc(o.brand) + '</b> team, and <b>Congratulations</b> on being selected to join us!') + '</div>' +
      // The date with its emoji in a cell of its own: on a narrow phone the 📅 sat alone on a line above the date
      '<div style="display:inline-block;border-radius:999px;' + gradBg + '"><table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
        '<td style="padding:10px 0 10px 16px;font-size:17px;line-height:1.3;vertical-align:middle">📅</td>' +
        '<td style="padding:10px 16px 10px 8px;font-weight:800;font-size:15px;line-height:1.3;vertical-align:middle;color:#ffffff">' + white(esc(longDate(d1)) + ' · 1:30 PM') + '</td></tr></table></div>' +
    '</td></tr>' +
    '<tr><td style="padding:22px 6px 0;' + F + 'font-size:15px;line-height:1.6;color:#3A3942">' + dk('Hi ' + esc(first) + ', you’re coming on board at an exciting time as we continue to expand our business and head into a highly productive season. ' +
      'We’re confident that with your enthusiasm and dedication, you’ll thrive in your new role as a <b>Brand Ambassador</b>. Product training and sales coaching begins <b>' + esc(longDate(d1)) + ' @ 1:30 PM</b>.') + '</td></tr>' +
    // A reply is the strongest "this isn't spam" signal there is, and tells Jess / Rubal it arrived
    '<tr><td style="padding:16px 0 0"><div style="border:2px dashed ' + S.solid + ';border-radius:16px;padding:12px 16px;' + fill('#ffffff') + F + 'font-size:15px;line-height:1.45;color:#22222B">' +
      iconRow('✅', '<b>Quick one:</b> reply <b>GOT IT</b> to this email so we know it reached you.') + '</div></td></tr>' +
    // Their Week 1 plan + CONFIRM straight after (Angad, 20 Oct), then the week day by day
    (wUrl ? '<tr><td style="padding:6px 0 0">' + bigBtn('👀 See my Week 1 plan + CONFIRM', wUrl) +
      '<div style="' + F + 'font-size:13px;color:#6E6C78;text-align:center;margin-top:8px">' + dk('Your welcome page, with the Sales Skill Ladder. Tap <b>CONFIRM</b> so we know you’re coming.') + '</div></td></tr>' : '') +
    head('🗓️', 'Your Week 1', 'From induction to your first day on badge') +
    W.map(dayCard).join('') +
    // Before Day 1
    head('⚡', 'Before Day 1', 'Two minutes now saves you an hour on Day 1') +
    card('<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
      // FieldIQ won't log anyone in until they've tapped the link in its own invite (Rubal, 23 Oct: "Your account isn't activated yet")
      step(1, '<b>Activate FieldIQ first:</b> find the invitation from FieldIQ (email or text, check Junk) and tap its link. Then download the app, log in with that same email and complete your vetting form before your first day.') +
      (o.preCoaching ? step(2, 'Complete the short online <b>Pre-Coaching Module</b>: around <b>15–20 minutes</b> of short videos and quick questions. It’s important it’s done before ' + DAYS_LONG[weekday(d1)] + ', so you’re fully prepared for coaching.') : '') +
      step(o.preCoaching ? 3 : 2, 'Read your <b>' + esc(o.playbook[0]) + '</b>, so you walk in on Day 1 already knowing how we work.') +
      '</table>' + bigBtn('📲 Download FieldIQ', ONBOARD.FIELDIQ_URL) + (o.preCoaching ? bigBtn('📝 Open the Pre-Coaching Module', o.preCoaching[1]) : '') +
      bigBtn('📘 Open my ' + esc(o.playbook[0]), pbUrl)) +
    // Bring
    head('🎒', 'Bring with you') +
    card(chip('📝', 'Notepad &amp; pen') + chip('🪪', 'Photo ID') + chip('🔑', 'Your right-to-work share code')) +
    // Get ready
    head('📚', 'Get ready') +
    card('<p style="margin:0">' + dk((co === 'JUSS' ? 'We highly recommend you read up on our client, <b>' + esc(o.client[0]) + '</b>, ahead of your training.' : 'Read up and do some research on our client, <b>' + esc(o.client[0]) + '</b>, before your product coaching.') +
      ' And check out the team in our online magazine!') + '</p><div style="margin-top:6px">' + btn('🌐 ' + esc(o.client[0]), o.client[1], true) + btn('📖 ' + esc(o.magazine[0]), o.magazine[1]) +
      (o.website ? btn('✨ ' + esc(o.website[0]), o.website[1]) : '') + '</div>') +
    // Sign-off, as a signature card
    gap(24) +
    card('<div style="margin:0 0 16px">' + iconRow('💬', 'Any questions' + (co === 'JUSS' ? ' regarding anything' : '') + ', just reply to this email or call <b>' + esc(o.phone) + '</b>.') +
      '<div style="height:8px;font-size:0;line-height:0">&nbsp;</div>' + iconRow('🔥', 'I’ll be in the office to meet you when you arrive. Excited to work with you!') + '</div>' +
      '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="width:58px;vertical-align:middle">' + tile(initialsOf(u.name), 48) + '</td>' +
      '<td style="padding-left:12px;vertical-align:middle;' + TXT + 'line-height:1.35"><div style="font-size:13px;color:#6E6C78">' + dk('Thanks, Kind Regards,') + '</div>' +
      '<div style="font-size:17px">' + dk('<b>' + esc(u.name) + '</b>') + '</div><div style="font-weight:700">' + dk(esc(signCo)) + '</div></td></tr></table>') +
    '<tr><td style="padding:18px 6px 0;' + F + 'font-size:12px;line-height:1.5;color:#8A8794;text-align:center">' + dk(esc(o.brand) + ' · ' + esc(CONFIG.OFFICE_ADDRESS)) + '</td></tr>' +
    '</table></td></tr></table></body></html>';
  const text = 'Hi ' + first + ',\n\nWelcome to the ' + o.brand + ' team, and Congratulations on being selected to join us!\n\n' +
    'Product training and sales coaching begins ' + longDate(d1) + ' @ 1:30 PM.\n\n' +
    'Quick one: reply GOT IT to this email so we know it reached you.\n\n' +
    (wUrl ? 'Your Week 1 plan + CONFIRM: ' + wUrl + '\n\n' : '') +
    'YOUR WEEK 1\n' + W.map((r, i) => dayName(i) + ': ' + r[1] + ', ' + r[2] + '. ' + r[3]).join('\n') + '\n' +
    'Address: ' + CONFIG.OFFICE_ADDRESS + ' · ' + o.maps + '\n' +
    '\nBEFORE DAY 1\n1. Activate FieldIQ first: find the invitation from FieldIQ (email or text, check Junk) and tap its link. Then download the app (' + ONBOARD.FIELDIQ_URL + '), log in with that same email and complete your vetting form before your first day.\n' +
    (o.preCoaching ? '2. Complete the Pre-Coaching Module (15-20 minutes): ' + o.preCoaching[1] + '\n' : '') +
    (o.preCoaching ? '3' : '2') + '. Read your ' + o.playbook[0] + ': ' + pbUrl + '\n' +
    '\nBRING: notepad and pen, photo ID, your right-to-work share code\n' +
    '\nGet ready: ' + o.client[0] + ' ' + o.client[1] + ' · ' + o.magazine[0] + ' ' + o.magazine[1] + (o.website ? ' · ' + o.website[1] : '') + '\n' +
    '\nAny questions, just reply to this email or call ' + o.phone + '.\nI’ll be in the office to meet you when you arrive. Excited to work with you!\n\nThanks,\nKind Regards,\n' + u.name + '\n' + signCo;
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
 *  signed by them: replies go straight to them. No copy back to the sender (Angad, 22 Oct: "it shouldn't come back as a
 *  BCC"); the app's card and Log say who sent it and when. Databyte first: FieldIQ only works once they're on it. */
function onboardSend(req, u) {
  if (!isAdmin(u)) throw new Error('Admin only');
  const c = getC(req.id);
  if (!onboardable(c)) throw new Error('Only people booked onto the Academy are onboarded.');
  if (!c.databyte_at) throw new Error('Add them to Databyte first: FieldIQ only works once they\'re on Databyte.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email || '')) throw new Error('No valid email for ' + c.full_name + '.');
  const pick = brandPick(req, u), s = welcomeSender(c, u, pick), bad = welcomeNotReady(s);
  if (bad) throw new Error(bad);
  unlockPlaybook(c, brandCo(c, pick), u);  // their playbook is open before they tap the link (after launch)
  const m = onboardEmail(c, s, pick), brand = ONBOARD[brandCo(c, pick)].brand;
  const opts = { htmlBody: m.html, name: s.name + ' | ' + brand };
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
/** "Jess Grace" → "JG": the signature card's tile. */
function initialsOf(name) { return String(name || '').trim().split(/\s+/).map(p => p.charAt(0)).join('').slice(0, 2).toUpperCase(); }
/** The company someone works for, from their email address ('' if it's neither company's). */
function homeCo(email) { const e = String(email || '').toLowerCase(); return /@jussmarketing\./.test(e) ? 'JUSS' : /@linkmarketing\./.test(e) ? 'LINK' : ''; }
function scriptEmail() { try { return String(Session.getEffectiveUser().getEmail()).toLowerCase(); } catch (e) { return ''; } }
/** Addresses this script's Gmail can send as: its own + its "Send mail as" addresses (checked every 10 minutes). */
function sendableFrom() {
  const cache = CacheService.getScriptCache(), hit = cache.get('send_as');
  if (hit) return JSON.parse(hit);
  let list = [];
  try { list = [scriptEmail()].concat(GmailApp.getAliases().map(x => String(x).toLowerCase())); } catch (e) { console.error(e); }
  // No "Send mail as" addresses can also mean Google was slow to answer (Vercel waits 3 s, then uses the last answer it
  // kept): ask again in 15 seconds, not ten minutes, so a second tap on Send works (22 Oct)
  cache.put('send_as', JSON.stringify(list), list.length > 1 ? 600 : 15);
  return list;
}
function welcomeNotReady(s) {
  return sendableFrom().indexOf(s.email) >= 0 ? '' : 'Can\'t send as ' + s.email + ' yet. Angad: add it in Gmail → Settings → Accounts → "Send mail as" (SETUP.md, "Welcome emails"), then try again in a few minutes.';
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
  const toClose = mine.filter(c => truthy(c.in_room) && !c.outcome && !noCallNeeded(c)).sort((a, b) => (b.eval_at ? 1 : 0) - (a.eval_at ? 1 : 0));
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
    open: mine.filter(c => !c.outcome && !noCallNeeded(c)),
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
    deleteWhere('Log', r => { const t = tsText(r.at); return !!t && t.slice(0, 10) < cutoff; });  // times can be real dates in this tab
    deleteWhere('Bookings', r => !!r.slot_date && r.slot_date < cutoff);
    trimOldDetails(trim);
    trimOldBookings(trim);
  });
}
/** After 12 weeks: keep name, contact, booker, result and what pay needs (to spot repeat applicants); wipe the rest,
 *  including evaluation answers (and the convictions answer), presenter notes and comments. */
const TRIM_FIELDS = ['resume_token', 'booker_typed', 'visa_expiry', 'rag', 'stars', 'tags', 'notes',
  'q1_excitement', 'q2_stood_out', 'q3_reason', 'q4_situation', 'q4_looking_for', 'q5_start_date', 'q6_days', 'q7_commute',
  'q8_resilience', 'q9_results_paid', 'q9_results_detail', 'q10_door', 'q11_coach', 'q12_bdp_stage', 'q12_bdp_why',
  'q13_unspent', 'q14_questions', 'outcome_notes', 'admin_note', 'welcome_token', 'p_why_sales', 'p_why_sales_note', 'p_interesting', 'booking_note'];
function trimOldDetails(before) {
  let n = 0;
  readTable('Candidates').forEach(r => {
    const log = withoutNotes(r.outcome_log);  // the call log keeps who / when / outcome; its notes go with outcome_notes
    if (!r.attended_date || r.attended_date >= before || (!TRIM_FIELDS.some(k => r[k]) && log === r.outcome_log)) return;
    TRIM_FIELDS.forEach(k => { r[k] = ''; });
    r.outcome_log = log;
    writeRow('Candidates', r); n++;
  });
  return n;
}
function withoutNotes(json) {
  if (!json) return '';
  try { return JSON.stringify(JSON.parse(json).map(e => { const o = Object.assign({}, e); delete o.n; return o; })); } catch (e) { return ''; }
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
  installTriggers();
  return 'Setup complete. Admin: ' + email;
}
/** The scheduled alerts (Google's timers). On Vercel, vercel.json's cron runs the same functions instead. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('weeklyProgressEmails').timeBased().onWeekDay(ScriptApp.WeekDay.WEDNESDAY).atHour(10).inTimezone(CONFIG.TZ).create();
  ScriptApp.newTrigger('weeklyProgressEmails').timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(10).inTimezone(CONFIG.TZ).create();
  ScriptApp.newTrigger('saturdayDeadlineEmails').timeBased().onWeekDay(ScriptApp.WeekDay.SATURDAY).atHour(14).inTimezone(CONFIG.TZ).create();
  ScriptApp.newTrigger('mondayPayReportEmail').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).inTimezone(CONFIG.TZ).create();
  ScriptApp.newTrigger('dailyMaintenance').timeBased().everyDays(1).atHour(2).inTimezone(CONFIG.TZ).create();
  ScriptApp.newTrigger('keepWarm').timeBased().everyMinutes(5).create();
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
