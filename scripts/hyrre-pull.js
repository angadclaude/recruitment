// Runs INSIDE a hyrre.co.uk tab that's logged in (Rubal's login, in Angad's Chrome), from the scheduled task (08:15, 11:15, 17:15):
// reads the Slough pipeline's appointments (GET requests) and hands them to J&L with a one-time ticket from
// `node scripts/hyrre-sync.js ticket`. J&L decides what to keep (approved only) and who booked them. Once a presentation is over, J&L
// answers with who to mark from our check-ins (attended, or no-show with Hyrre's rebook), and this page marks them: the only change
// it makes in Hyrre (Angad, 30 Oct).
// The task swaps __TICKET__ for the ticket and __DRY__ for false; dry run (true) only says what it found, sends and marks nothing.
(async (TICKET, DRY) => {
  const PIPELINE = '403';                                // Slough (Cardiff is 402)
  const JL = 'https://jl-recruitment.vercel.app/api/rpc';
  const ymd = d => d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const today = new Date(), from = ymd(new Date(today - 7 * 864e5)), to = ymd(new Date(+today + 45 * 864e5));
  const q = new URLSearchParams({ appointment_date__gte: from, appointment_date__lte: to, timezone: 'Europe/London' });
  const r = await fetch('/api/applications/?' + q, { headers: { 'X-Pipeline-Id': PIPELINE }, credentials: 'include' });
  if (r.status === 401 || r.status === 403) return { ok: false, error: 'Hyrre is logged out in this browser (' + r.status + '). Log in to hyrre.co.uk, then run it again.' };
  if (!r.ok) return { ok: false, error: 'Hyrre answered ' + r.status };
  const j = await r.json(), apps = Array.isArray(j) ? j : (j.results || []);
  if (!Array.isArray(j) && j.next) return { ok: false, error: 'Hyrre sent more than one page; the snippet needs to read them all.' };
  // Only what J&L needs: no emails, no call notes beyond the "Booked by …" line, no recordings
  const items = apps.filter(a => a.first_appointment && a.pipeline === Number(PIPELINE)).map(a => {
    const fa = a.first_appointment, st = a.screening_stage_state || {};
    const booked = (String(st.note || '').match(/booked by\s+[a-z][a-z' -]{0,40}/i) || [''])[0];
    return { id: String(a.id), name: String(a.name || ''), phone: String(a.phone || ''), date: fa.local_date || '', time: String(fa.local_time || '').slice(0, 5),
      approval: fa.approval_status || '', attendance: fa.attendance_status || '', note: booked, source: a.source_label_snapshot || a.cv_source || '',
      archived: !!a.is_archived, active: a.is_active_application !== false };
  });
  if (DRY) {
    const count = (f) => items.reduce((o, x) => (o[f(x)] = (o[f(x)] || 0) + 1, o), {});
    return { ok: true, dry: true, window: { from, to }, found: items.length, byApproval: count(x => x.approval), byDate: count(x => x.date + ' ' + x.time),
      byAttendance: count(x => x.date + ' ' + (x.attendance || 'none')), byNote: count(x => x.note || '(none)'), bySource: count(x => x.source), phonesLookUk: items.filter(x => /^(\+44|0)7\d{9}$/.test(x.phone.replace(/\s/g, ''))).length };
  }
  const res = await fetch(JL, { method: 'POST', body: JSON.stringify({ action: 'hyrreImport', ticket: TICKET, pipeline: PIPELINE, window: { from, to }, items }) });
  const out = await res.json().catch(() => ({ ok: false, error: 'J&L answered ' + res.status }));
  if (!out.ok) return { ok: false, error: out.error || 'J&L refused it' };
  // Attended / no-show from our check-ins (Angad, 30 Oct), the way Hyrre's own appointment box does it: only appointments this
  // read showed as still unmarked, and only those two marks. A no-show is asked to rebook (Hyrre sends its message), unless
  // the team has rebooked them in J&L already (rebook: false), so they don't get Hyrre's link for a day they've just agreed.
  const unmarked = {}; items.forEach(x => { if (!x.attendance || x.attendance === 'none') unmarked[x.id] = true; });
  const marked = { attended: 0, no_show: 0, skipped: 0, failed: 0 };
  for (const m of (out.data && out.data.marks) || []) {
    if (!/^\d+$/.test(String(m.id)) || !unmarked[m.id] || (m.status !== 'attended' && m.status !== 'no_show')) { marked.skipped++; continue; }
    const p = await fetch('/api/applications/' + m.id + '/first-appointment/', { method: 'PATCH', credentials: 'include',
      headers: { 'X-Pipeline-Id': PIPELINE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ attendance_status: m.status, ask_rebook: m.status === 'no_show' && m.rebook !== false }) });
    if (p.ok) marked[m.status]++; else marked.failed++;
  }
  const data = Object.assign({}, out.data); delete data.marks;
  return Object.assign({ ok: true }, data, { marked });
})('__TICKET__', __DRY__);
