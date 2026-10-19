// Google's timers, run by Vercel Cron every 5 minutes (vercel.json). Times are London time, like the Apps Script triggers:
// keepWarm every 5 min (it sends the 10:00 / 12:00 / 18:00 reminders when they're due), dailyMaintenance 02:00,
// weeklyProgressEmails Wed + Fri 10:00, saturdayDeadlineEmails Sat 14:00, mondayPayReportEmail Mon 09:00.
// Then the live copy of the data into the team's Google Sheet (server/mirror.js).
// Nothing runs until switch day sets VERCEL_LIVE (until then Google's own timers are the live ones).
'use strict';
const { runtime, relay, db } = require('../server/live');
const { mirrorToSheet } = require('../server/mirror');

const SCHEDULE = [
  { fn: 'dailyMaintenance', days: [0, 1, 2, 3, 4, 5, 6], hour: 2 },
  { fn: 'mondayPayReportEmail', days: [1], hour: 9 },
  { fn: 'weeklyProgressEmails', days: [3, 5], hour: 10 },
  { fn: 'saturdayDeadlineEmails', days: [6], hour: 14 },
];

function london(d) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(d).reduce((a, x) => (a[x.type] = x.value, a), {});
  return { date: p.year + '-' + p.month + '-' + p.day, hour: Number(p.hour), day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

module.exports = async (req, res) => {
  if (process.env.CRON_SECRET && req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET) { res.statusCode = 401; return res.end('no'); }
  const rt = await runtime();
  const live = await rt.withDb(q => q("select val from jl.props where key = 'VERCEL_LIVE'"));
  if (!live.length) return res.end('not live yet (Google runs the timers)');
  const now = london(new Date()), ran = [];
  // Each scheduled job once per day, at or after its hour (a missed tick catches up within the day)
  for (const s of SCHEDULE) {
    if (!s.days.includes(now.day) || now.hour < s.hour) continue;
    const key = 'CRON_LAST_' + s.fn;
    const claimed = await rt.withDb(async q => {
      const last = (await q('select val from jl.props where key = $1', [key]))[0];
      if (last && last.val === now.date) return false;
      await q('insert into jl.props (key, val) values ($1, $2) on conflict (key) do update set val = excluded.val', [key, now.date]);
      return true;
    });
    if (!claimed) continue;
    try { await rt.call(s.fn); ran.push(s.fn); } catch (e) { console.error(s.fn, e); ran.push(s.fn + ' FAILED'); }
  }
  try { await rt.call('keepWarm'); ran.push('keepWarm'); } catch (e) { console.error('keepWarm', e); ran.push('keepWarm FAILED'); }
  const retried = await relay().retry();
  // Keep the app's API and Google's email relay awake, so a login code goes out straight away even after a quiet spell
  // (19 Oct: 9 s from tap to Gmail with both asleep; 0.2 s for the app when awake)
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL, t0 = Date.now(), warm = {};
  await Promise.all([
    host ? fetch('https://' + host + '/api/rpc', { method: 'POST', body: '{"action":"publicConfig"}', signal: AbortSignal.timeout(20000) })
      .then(r => { warm.api = r.status + ' in ' + (Date.now() - t0) + 'ms'; }, e => { warm.api = 'failed: ' + e.message; }) : null,
    relay().call('relayInfo').then(() => { warm.relay = 'ok in ' + (Date.now() - t0) + 'ms'; }, e => { warm.relay = 'failed: ' + e.message; }),
  ]);
  // The team's live copy in the Google Sheet (only the tabs that changed)
  let mirrored;
  try { mirrored = await mirrorToSheet(db().sql, relay().call); } catch (e) { console.error('mirror', e); mirrored = 'failed: ' + e.message; }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ at: now, ran, mailRetried: retried, warm, mirrored }));
};
