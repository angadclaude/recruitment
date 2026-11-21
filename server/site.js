// Website applicants onto Book Appts (Angad, 20 Nov 2026). The Apply form on jussmarketing.co.uk saves each application in the
// website's own list (the shared Supabase, schema `jsite`, table `applications`: JUSS Website/lib/apply.js) and emails it to the
// recruitment inbox. Every 5 minutes this reads the last month of that list and hands it to Code.gs (siteImport), which adds the
// ones it hasn't got yet, by the application's own number, and alerts the people who call them.
// Look-only: nothing in the website's list is ever written. Nothing changes on the website and no key is shared: the app's
// database login can already read that list (checked on the live database, 20 Nov).
'use strict';

const WINDOW_DAYS = 31;  // a day more than Code.gs's back-fill at switch-on (CONFIG.WEB.BACKFILL_DAYS), so nobody at its edge is missed

/** A moment as London's 'yyyy-MM-dd HH:mm': the app's own way of writing a time. */
function london(d) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).reduce((a, x) => (a[x.type] = x.value, a), {});
  return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute;
}

/**
 * @param {object}   rt  the Runtime (server/runtime.js): rt.call(fn, ...args) runs a Code.gs function
 * @param {function} sql postgres-js tagged template (live): reads jsite.applications
 * @returns {Promise<object>} { read, added, backfill, again, known }, or { error } when the website's list couldn't be read
 */
async function siteApplicants(rt, sql) {
  let rows;
  try {
    rows = await sql`select id::text as id, created_at, first_name, last_name, phone, email, visa_status, preferred_day, availability, how_heard, additional_notes
      from jsite.applications where origin = 'website' and created_at > now() - ${WINDOW_DAYS + ' days'}::interval order by id`;
  } catch (e) {
    // No such list in this database (a test copy), or the database was busy: said, and tried again in 5 minutes. Nobody is lost:
    // they stay in the website's list until they're read
    return { error: String((e && e.message) || e).slice(0, 200) };
  }
  const out = await rt.call('siteImport', rows.map(r => ({
    id: String(r.id), at: london(new Date(r.created_at)), first_name: r.first_name, last_name: r.last_name, phone: r.phone, email: r.email,
    visa_status: r.visa_status, preferred_day: r.preferred_day, availability: r.availability, how_heard: r.how_heard, notes: r.additional_notes,
  })));
  return Object.assign({ read: rows.length }, out);
}

module.exports = { siteApplicants, london, WINDOW_DAYS };
