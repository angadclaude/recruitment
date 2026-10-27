// The week's new starters onto the bell sheets (Angad, 27 Oct): into the NEW STARTS section at the bottom of that week's tab,
// FR on the LINK FR bell sheet, HF on the JUSS HF one. Code.gs decides who's due and keeps who went on (bellDue / bellDone);
// Google writes them (Code.gs relayBell), since the bell sheets are the team's Google Sheets.
'use strict';

/**
 * @param {object}   rt    the Runtime (server/runtime.js): rt.call(fn, ...args) runs a Code.gs function
 * @param {function} relay async (action, extra) → data: the Google relay
 * @returns {Promise<object|null>} what happened, or null when nobody is due
 */
async function bellToSheets(rt, relay) {
  const due = await rt.call('bellDue');
  if (!due) return null;
  const out = { we: due.we, tab: due.tab, sheets: [] };
  for (const s of due.sheets) {
    try {
      const r = await relay('relayBell', { id: s.id, we: due.we, section: s.section, rows: s.rows.map(x => [x.name, x.coach]) });
      out.sheets.push({ key: s.key, title: r.title || '', tab: r.tab || '', error: r.error || '', rows: s.rows.map((x, i) => Object.assign({}, x, { status: (r.rows || [])[i] || '' })) });
    } catch (e) {
      out.sheets.push({ key: s.key, error: e.message, rows: s.rows.map(x => Object.assign({}, x, { status: '' })) });
    }
  }
  await rt.call('bellDone', out);
  return out;
}

module.exports = { bellToSheets };
