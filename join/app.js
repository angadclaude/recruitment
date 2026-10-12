
(function () {
'use strict';

// ───────────── basics ─────────────
const BOOT = document.getElementById('boot').dataset;
const $app = document.getElementById('app');
const S = { token: '', me: null, tab: '', week: '', day: '', timer: null, users: null, filter: 'all' };

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('lr_' + k) || 'null'); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('lr_' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('lr_' + k); } catch (e) {} },
};
function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}
const CFG = window.APP_CONFIG || {};
function call(action, payload) {
  const req = Object.assign({}, payload || {}, { action: action, token: S.token });
  let p;
  if (CFG.API_URL) {
    // Installable app (GitHub Pages): plain-text POST to the Apps Script /exec URL.
    p = fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify(req) }).then(r => r.json());
  } else if (window.google && google.script) {
    p = new Promise((res, rej) => google.script.run.withSuccessHandler(res).withFailureHandler(rej).api(req));
  } else {
    return Promise.reject(new Error('This app is not connected yet (admin: add the Apps Script link to config.js).'));
  }
  return p.then(res => {
    if (res && res.ok) return res.data;
    if (res && res.auth) { store.del('tok'); S.token = ''; S.me = null; startStaff(); return new Promise(() => {}); } // session expired → login
    throw new Error((res && res.error) || 'Something went wrong');
  }, err => { throw new Error((err && err.message && !/fetch/i.test(err.message)) ? err.message : 'No connection — check your signal and try again'); });
}
function stopTimer() { if (S.timer) { clearInterval(S.timer); S.timer = null; } }
function scrollTop() { window.scrollTo(0, 0); }
function logos(size) {
  return '<div class="brandbar"><img alt="LINK Marketing" src="' + LOGOS.LINK + '" style="height:' + size + 'px">' +
    '<span class="x">×</span><img alt="JUSS Marketing" src="' + LOGOS.JUSS + '" style="height:' + size + 'px"></div>';
}

// ───────────── dates (YYYY-MM-DD strings, no time zone surprises) ─────────────
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function D(ymd) { return new Date(ymd + 'T00:00:00Z'); }
function addDays(ymd, n) { const d = D(ymd); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function fmt(ymd) { if (!ymd) return ''; const d = D(ymd); return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; }
function fmtLong(ymd) { const d = D(ymd); return DAYS_LONG[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS_LONG[d.getUTCMonth()]; }
function fmtTs(ts) { return ts ? fmt(ts.slice(0, 10)) + ' ' + ts.slice(11, 16) : ''; }
function nextMonday(ymd) { const w = D(ymd).getUTCDay(); return addDays(ymd, w === 1 ? 7 : (8 - w) % 7 || 7); }

// ───────────── shared form bits ─────────────
function chips(name, opts, val, stack) {
  return '<div class="chips' + (stack ? ' stack' : '') + '" data-name="' + name + '">' +
    opts.map(o => '<button type="button" class="chip' + (o === val ? ' on' : '') + '" data-v="' + h(o) + '">' + h(o) + '</button>').join('') + '</div>';
}
function bindChips(root, onChange) {
  root.querySelectorAll('.chips[data-name]').forEach(g => {
    g.addEventListener('click', e => {
      const b = e.target.closest('.chip'); if (!b) return;
      const multi = g.dataset.multi === '1';
      if (multi) b.classList.toggle('on');
      else { g.querySelectorAll('.chip').forEach(x => x.classList.remove('on')); b.classList.add('on'); }
      if (onChange) onChange(g.dataset.name, b.dataset.v);
    });
  });
}
function chipVal(root, name) {
  const b = root.querySelector('.chips[data-name="' + name + '"] .chip.on');
  return b ? b.dataset.v : '';
}
function chipVals(root, name) {
  return Array.from(root.querySelectorAll('.chips[data-name="' + name + '"] .chip.on')).map(b => b.dataset.v);
}
function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.l = btn.innerHTML; btn.disabled = true; btn.innerHTML = label || 'Saving…'; }
  else { btn.disabled = false; btn.innerHTML = btn.dataset.l || btn.innerHTML; }
}
function showErr(el, msg) { el.innerHTML = msg ? '<div class="err">' + h(msg) + '</div>' : ''; if (msg) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }

// ═════════════════════════ CANDIDATE ═════════════════════════
const C = { cfg: null, rec: null };

function startCandidate() {
  if (BOOT.mode === 'welcome') return startWelcome();
  const saved = store.get('cand');
  const known = saved && saved.id
    ? call('candidateStatus', { id: saved.id, resume: saved.resume }).then(st => (st.attended_date === st.today ? st : null)).catch(() => null)
    : Promise.resolve(null);
  known.then(st => {
    if (st) { C.rec = saved; C.rec.first_name = st.first_name; } else store.del('cand');
    if (BOOT.mode === 'eval') {
      if (st) return st.evalDone ? renderDone() : renderEval();
      return renderFind();
    }
    if (st) return renderCheckedIn(st.first_name, st.evalDone);
    loadCheckin('');
  });
}

/** then = 'eval' when someone scans the evaluation QR without having checked in. */
function loadCheckin(then) {
  $app.innerHTML = '<div class="loading">Loading…</div>';
  call('publicConfig').then(cfg => { C.cfg = cfg; renderCheckin(then); })
    .catch(e => { $app.innerHTML = logos(48) + '<div class="err">' + h(e.message) + '</div>'; });
}

function renderCheckin(then) {
  scrollTop();
  const sources = ['Indeed', 'TikTok', 'Instagram', 'Facebook', 'LinkedIn', 'Friend / referral', 'Other'];
  $app.innerHTML = logos(56) +
    (then === 'eval' ? '<h1>Quick check-in first 👋</h1><p class="muted">We couldn\'t find you, so fill this in, then your evaluation opens straight after.</p>'
      : '<h1>Welcome — let\'s check you in 👋</h1><p class="muted">Takes about a minute.</p>') +
    '<form id="f" class="card" novalidate autocomplete="on">' +
    '<label class="q">Full name <span class="req">*</span></label><input type="text" name="full_name" autocomplete="name" placeholder="First and last name">' +
    '<label class="q">Mobile number <span class="req">*</span></label><input type="tel" name="mobile" autocomplete="tel" inputmode="tel" placeholder="07…">' +
    '<label class="q">Email <span class="req">*</span></label><input type="email" name="email" autocomplete="email" placeholder="you@email.com">' +
    '<label class="q">Are you 18 or over? <span class="req">*</span></label>' + chips('over18', ['Yes', 'No']) +
    '<label class="q">Who booked you in today? <span class="req">*</span></label>' +
    '<div class="help">Start typing their name, then tap it.</div>' +
    '<div id="bk"></div>' +
    '<label class="check"><input type="checkbox" id="unsure"> I\'m not sure who booked me</label>' +
    '<label class="q">Where did you find us?</label>' + chips('source', sources) +
    '<label class="q">Your right to work in the UK <span class="req">*</span></label>' +
    '<select name="rtw"><option value="">Choose one…</option>' + C.cfg.rtw.map(r => '<option>' + h(r.label) + '</option>').join('') + '</select>' +
    '<div id="exp" hidden><label class="q">Visa expiry date <span class="req">*</span></label><input type="date" name="visa_expiry"></div>' +
    '<label class="check"><input type="checkbox" name="privacy_ok"> <span>I agree that LINK Marketing and JUSS Marketing can use these details to assess my application and contact me about it. They are kept for a maximum of 12 months.</span></label>' +
    '<div id="err"></div>' +
    '<button class="btn block" id="go" type="submit">Check in</button>' +
    '</form>';

  const f = document.getElementById('f');
  bindChips(f);
  let booker = null;
  const bk = document.getElementById('bk');
  const drawBooker = (typed) => {
    if (booker) {
      bk.innerHTML = '<div class="picked"><span>✓ ' + h(booker.name) + ' <span class="co ' + h(booker.company) + '">' + h(booker.company) + '</span></span>' +
        '<button type="button" class="btn ghost sm" id="chg">Change</button></div>';
      document.getElementById('chg').onclick = () => { booker = null; drawBooker(''); bk.querySelector('input').focus(); };
      return;
    }
    bk.innerHTML = '<input type="text" id="bkq" autocomplete="off" placeholder="Type their name…" value="' + h(typed || '') + '"><div id="sg"></div>';
    const inp = document.getElementById('bkq');
    const sg = document.getElementById('sg');
    const draw = () => {
      const q = inp.value.trim().toLowerCase();
      if (q.length < 2) { sg.innerHTML = ''; return; }
      const hits = C.cfg.bookers.filter(b => b.name.toLowerCase().split(' ').some(p => p.indexOf(q) === 0) || b.name.toLowerCase().indexOf(q) === 0).slice(0, 6);
      sg.innerHTML = hits.length
        ? '<div class="suggest">' + hits.map(b => '<button type="button" data-id="' + h(b.id) + '"><span>' + h(b.name) + '</span><span class="co ' + h(b.company) + '">' + h(b.company) + '</span></button>').join('') + '</div>'
        : '<div class="help" style="margin-top:6px">No match — check the spelling, or tick "I\'m not sure".</div>';
    };
    inp.addEventListener('input', draw);
    sg.addEventListener('click', e => {
      const b = e.target.closest('button[data-id]'); if (!b) return;
      booker = C.cfg.bookers.filter(x => x.id === b.dataset.id)[0];
      document.getElementById('unsure').checked = false;
      drawBooker('');
    });
    draw();
  };
  drawBooker('');

  f.rtw.addEventListener('change', () => {
    const r = C.cfg.rtw.filter(x => x.label === f.rtw.value)[0];
    document.getElementById('exp').hidden = !(r && r.level === 'visa');
  });

  f.addEventListener('submit', e => {
    e.preventDefault();
    const err = document.getElementById('err');
    const unsure = document.getElementById('unsure').checked;
    const typedEl = document.getElementById('bkq');
    const typed = typedEl ? typedEl.value.trim() : '';
    // Exact typed match counts as a pick.
    if (!booker && typed) {
      const exact = C.cfg.bookers.filter(b => b.name.toLowerCase() === typed.toLowerCase());
      if (exact.length === 1) booker = exact[0];
    }
    const form = {
      full_name: f.full_name.value, mobile: f.mobile.value, email: f.email.value,
      over18: chipVal(f, 'over18'), source: chipVal(f, 'source'),
      booker_id: booker ? booker.id : '', booker_typed: booker ? booker.name : typed,
      rtw: f.rtw.value, visa_expiry: f.visa_expiry.value, privacy_ok: f.privacy_ok.checked,
    };
    if (!form.full_name.trim() || !form.mobile.trim() || !form.email.trim()) return showErr(err, 'Please fill in your name, mobile and email.');
    if (!form.over18) return showErr(err, 'Please answer whether you are 18 or over.');
    if (!booker && !unsure) return showErr(err, 'Who booked you in? Tap their name from the list as you type, or tick "I\'m not sure".');
    if (!form.rtw) return showErr(err, 'Please choose your right to work status.');
    if (!document.getElementById('exp').hidden && !form.visa_expiry) return showErr(err, 'Please add your visa expiry date.');
    if (!form.privacy_ok) return showErr(err, 'Please tick the privacy box to continue.');
    showErr(err, '');
    const btn = document.getElementById('go'); busy(btn, true, 'Checking in…');
    call('checkin', { form: form }).then(r => {
      C.rec = { id: r.id, resume: r.resume, first_name: r.first_name };
      store.set('cand', C.rec);
      if (r.evalDone) return renderDone();
      if (then === 'eval') return renderEval();
      renderCheckedIn(r.first_name);
    }).catch(ex => { busy(btn, false); showErr(err, ex.message); });
  });
}

/** Evaluation QR scanned on a phone we don't recognise: find today's check-in by mobile. */
function renderFind(notFound) {
  scrollTop();
  $app.innerHTML = logos(56) + '<div class="card"><div class="big-emoji">📝</div><h1 class="center">Evaluation time</h1>' +
    '<p class="muted center">Enter the mobile number you checked in with this morning.</p>' +
    '<input type="tel" id="m" inputmode="tel" autocomplete="tel" placeholder="07…" value="' + h(store.get('lastMobile') || '') + '"><div id="err">' +
    (notFound ? '<div class="err">We can\'t find a check-in for that number today. Check the number, or check in now.</div>' : '') + '</div>' +
    '<button class="btn block" id="go" style="margin-top:12px">Start my evaluation</button>' +
    (notFound ? '<button class="btn ghost block" id="ci" style="margin-top:8px">I didn\'t check in — do it now</button>' : '') + '</div>';
  document.getElementById('go').onclick = () => {
    const btn = document.getElementById('go'); busy(btn, true, 'Looking…');
    const mobile = document.getElementById('m').value;
    store.set('lastMobile', mobile);
    call('resumeByMobile', { mobile: mobile }).then(r => {
      if (!r.found) return renderFind(true);
      C.rec = { id: r.id, resume: r.resume, first_name: r.first_name }; store.set('cand', C.rec);
      r.evalDone ? renderDone() : renderEval();
    }).catch(ex => { busy(btn, false); showErr(document.getElementById('err'), ex.message); });
  };
  const ci = document.getElementById('ci'); if (ci) ci.onclick = () => loadCheckin('eval');
}

function renderCheckedIn(first, evalDone) {
  if (evalDone) return renderDone();
  scrollTop();
  $app.innerHTML = logos(56) + '<div class="card center"><div class="big-emoji">✅</div><h1>You\'re checked in, ' + h(first) + '!</h1>' +
    '<p>Sit back and enjoy the presentation 🙌</p>' +
    '<div class="ok" style="text-align:left">📝 <b>At the end</b>, scan the second QR code on the screen (<b>Evaluation</b>) to fill in your evaluation.</div></div>';
}

const EVAL = [
  { k: 'q1_excitement', t: 'On a scale of 1–10, how excited are you about this opportunity right now?', type: 'scale' },
  { k: 'q2_stood_out', t: 'What stood out to you most from today?', type: 'text' },
  { k: 'q3_reason', t: 'Pick your #1 reason for joining (choose one)', opts: ['Uncapped earnings', 'Leadership', 'Sales skills', 'Personal development', 'Travel', 'Team environment'] },
  { k: 'q4_situation', t: 'What is your current situation?', opts: ['Working full-time', 'Working part-time', 'Studying', 'Looking for work'] },
  { k: 'q4_looking_for', t: 'How long have you been looking for work?', opts: ['Less than 1 month', '1–3 months', '3–6 months', '6+ months'], showIf: a => a.q4_situation === 'Looking for work' },
  { k: 'q5_start_date', t: 'What is your earliest start date?', type: 'date' },
  { k: 'q6_days', t: 'How many days a week do you want to work?', opts: ['4 days', '5 days', '6–7 days'] },
  { k: 'q7_commute', t: 'Can you commute to our office in Slough (next to the train station) every day?', opts: ['Yes', 'No'] },
  { k: 'q8_resilience', t: 'Tell us about a time you kept going when things got tough. What did you do?', type: 'area' },
  { k: 'q9_results_paid', t: 'Have you ever earned money based on results? (commission, tips, targets, selling anything)', opts: ['Yes', 'No'] },
  { k: 'q9_results_detail', t: 'Tell us in one line', type: 'text', optional: true, placeholder: 'e.g. Commission selling phones at Carphone Warehouse' },
  { k: 'q10_door', t: 'A door gets shut in your face. What\'s your first thought?', opts: ['A) "Next door."', 'B) "What did I do wrong?"', 'C) "Maybe this isn\'t for me."', 'D) "Annoying, but I\'ll keep going."'], stack: true },
  { k: 'q11_coach', t: 'Your coach tells you your pitch isn\'t working. You…', opts: ['A) Ask them to show me, then copy it', 'B) Keep doing it my way', 'C) Feel knocked back', 'D) Practise it until it lands'], stack: true },
  { k: 'q12_bdp_stage', t: 'Where do you want to be in 2 years?', type: 'bdp', opts: ['Stage 2 – Brand Ambassador', 'Stage 3–4 – Leadership', 'Stage 5–6 – Ownership (my own business)', 'Not sure yet'], stack: true },
  { k: 'q12_bdp_why', t: 'What would running your own business mean to you? (one line)', type: 'text', optional: true },
  { k: 'q13_unspent', t: 'Do you have any unspent criminal convictions?', opts: ['No', 'Yes'], help: 'You do not need to tell us about spent convictions. Only senior admin can see this answer.' },
  { k: 'q14_questions', t: 'Any questions for us?', type: 'area', optional: true },
];

const LADDER = [
  ['#F0A23A', 'Stage 1 · 6 Days Evaluation', 'learn the systems, first week'],
  ['#8CC152', 'Stage 2 · Brand Ambassador', 'pass COD 1, lead by example'],
  ['#3BAA5C', 'Stage 3 · Leadership', 'coach others, run sectors'],
  ['#3BB6B2', 'Stage 4 · Crew Leadership', 'develop leaders, travel'],
  ['#2D8FD5', 'Stage 5 · Assistant Ownership', 'learn to run the business'],
  ['#5AA05A', 'Stage 6 · Owner', 'open your own marketing company + £10k start-up investment'],
];

function renderEval() {
  stopTimer(); scrollTop();
  const a = store.get('evaldraft_' + C.rec.id) || {};
  const qhtml = q => {
    if (q.showIf && !q.showIf(a)) return '';
    let w = '<div class="qwrap" data-k="' + q.k + '"><label class="q">' + h(q.t) + (q.optional ? '' : ' <span class="req">*</span>') + '</label>';
    if (q.help) w += '<div class="help">' + h(q.help) + '</div>';
    if (q.type === 'bdp') {
      w = '<div class="qwrap" data-k="' + q.k + '"><label class="q">Our Business Development Programme</label>' +
        '<div class="help">Start with no experience and progress all the way to running your own marketing company. We are actively looking for future business owners.</div>' +
        '<div class="ladder">' + LADDER.map(l => '<div style="background:' + l[0] + '">' + h(l[1]) + ' <span>— ' + h(l[2]) + '</span></div>').join('') + '</div>' +
        '<label class="q">' + h(q.t) + ' <span class="req">*</span></label>';
    }
    if (q.type === 'scale') w += chips(q.k, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], a[q.k]).replace('class="chips"', 'class="chips scale"') + '<div class="row between small muted"><span>Not really</span><span>Can\'t wait</span></div>';
    else if (q.type === 'text') w += '<input type="text" name="' + q.k + '" maxlength="300" value="' + h(a[q.k] || '') + '" placeholder="' + h(q.placeholder || '') + '">';
    else if (q.type === 'area') w += '<textarea name="' + q.k + '" maxlength="1000">' + h(a[q.k] || '') + '</textarea>';
    else if (q.type === 'date') w += '<input type="date" name="' + q.k + '" value="' + h(a[q.k] || '') + '">';
    else w += chips(q.k, q.opts, a[q.k], q.stack);
    return w + '</div>';
  };
  const draw = () => {
    $app.innerHTML = logos(48) + '<h1>Your evaluation, ' + h(C.rec.first_name) + '</h1><p class="muted">About 4 minutes. Be honest — there are no wrong answers.</p>' +
      '<form id="f" class="card" novalidate>' + EVAL.map(qhtml).join('') + '<div id="err"></div><button class="btn block" id="go" type="submit">Submit my evaluation</button></form>';
    const f = document.getElementById('f');
    bindChips(f, (name, v) => {
      a[name] = v; store.set('evaldraft_' + C.rec.id, a);
      if (name === 'q4_situation') { const y = window.scrollY; draw(); window.scrollTo(0, y); }
    });
    f.addEventListener('input', e => { if (e.target.name) { a[e.target.name] = e.target.value; store.set('evaldraft_' + C.rec.id, a); } });
    f.addEventListener('submit', e => {
      e.preventDefault();
      const err = document.getElementById('err');
      const missing = EVAL.filter(q => !q.optional && (!q.showIf || q.showIf(a)) && !String(a[q.k] || '').trim());
      if (missing.length) {
        showErr(err, 'Please answer every question marked *. Missing: "' + missing[0].t + '"');
        const w = f.querySelector('.qwrap[data-k="' + missing[0].k + '"]'); if (w) w.scrollIntoView({ block: 'center' });
        return;
      }
      const btn = document.getElementById('go'); busy(btn, true, 'Sending…');
      call('submitEval', { id: C.rec.id, resume: C.rec.resume, answers: a })
        .then(r => { store.del('evaldraft_' + C.rec.id); renderDone(r.booker_first); })
        .catch(ex => { busy(btn, false); showErr(err, ex.message); });
    });
  };
  draw();
}

function renderDone(bookerFirst) {
  stopTimer(); scrollTop();
  $app.innerHTML = logos(56) + '<div class="card center"><div class="big-emoji">🙌</div><h1>Thank you!</h1>' +
    '<p>' + h(bookerFirst || 'Our team') + ' will give you a call shortly to talk about your next steps.</p>' +
    '<p class="muted">Keep your phone close — and check WhatsApp.</p></div>';
}

// ═════════════════════════ WELCOME PAGE (link in the WhatsApp) ═════════════════════════
const WEEK1 = {
  LINK: [
    ['🗓️', 'Monday', 'Induction Day', '1:30pm – 6:00pm', 'Meet the team and learn more about the industry'],
    ['👣', 'Tuesday', 'Sales Coaching', '1:00pm – 6:00pm', 'Deep dive into office-based sales coaching'],
    ['🏢', 'Wednesday', 'Practical Learning Day', '10:00am – 8:30pm', 'Meet your 1-on-1 coach & mentor and shadow them'],
    ['💰', 'Thursday', 'Sales Day', '10:30am – 8:30pm', '1st day on badge! Your coach is side by side with you. Apply what you\'ve learnt and bag your incentives'],
  ],
  JUSS: [
    ['🗓️', 'Monday', 'Induction Day', '1:30pm – 6:00pm', 'Meet the team and learn more about the industry'],
    ['👣', 'Tuesday', 'Sales Coaching', '1:00pm – 6:00pm', 'Deep dive into in-house sales coaching'],
    ['🏢', 'Wednesday', 'Practical Learning Day', '10:00am – 8:30pm', 'Meet your 1-on-1 coach & mentor and shadow them'],
    ['💰', 'Thursday onwards', 'Sales Days', '10:30am – 8:30pm', '1st day on badge! Your coach is side by side with you. Apply what you\'ve learnt and bag your incentives'],
  ],
};
const MAPS = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Automotive House, Grays Place, Slough SL2 5AF');

function startWelcome() {
  call('welcomeInfo', { t: BOOT.k }).then(renderWelcome)
    .catch(e => { $app.innerHTML = logos(56) + '<div class="card center"><div class="big-emoji">🔗</div><p>' + h(e.message) + '</p></div>'; });
}

function renderWelcome(w) {
  scrollTop();
  const co = w.company === 'JUSS' ? 'JUSS' : 'LINK';
  const brand = co + ' Marketing';
  const days = Math.round((D(w.academy_date) - D(w.today)) / 86400000);
  const when = days > 1 ? 'Day 1 is in ' + days + ' days' : days === 1 ? 'Day 1 is TOMORROW 👀' : days === 0 ? 'Day 1 is TODAY 🔥' : 'Day 1 was ' + fmt(w.academy_date);
  const mon = D(w.academy_date).getUTCDay() === 1;
  const ymd = w.academy_date.replace(/-/g, '');
  const title = 'BA Academy Day 1 – ' + brand;
  const gcal = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(title) +
    '&dates=' + ymd + 'T133000/' + ymd + 'T180000&ctz=Europe/London&location=' + encodeURIComponent(w.address) +
    '&details=' + encodeURIComponent('Induction Day 1:30pm – 6:00pm. Bring photo ID + your right-to-work share code.');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LINK x JUSS//Recruitment//EN', 'BEGIN:VEVENT', 'UID:' + BOOT.k + '@recruit',
    'DTSTAMP:' + ymd + 'T090000', 'DTSTART:' + ymd + 'T133000', 'DTEND:' + ymd + 'T180000', 'SUMMARY:' + title,
    'LOCATION:' + w.address.replace(/,/g, '\\,'), 'DESCRIPTION:Bring photo ID + your right-to-work share code.', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const steps = WEEK1[co].map((r, i) => '<div class="wk"><div class="wk-ic">' + r[0] + '</div><div><div class="wk-d">' + h(mon ? r[1] : 'Day ' + (i + 1) + (i === 3 && co === 'JUSS' ? ' onwards' : '')) +
    ' · <b>' + h(r[2]) + '</b></div><div class="wk-t">' + h(r[3]) + '</div><div class="wk-x">' + h(r[4]) + '</div></div></div>').join('');

  $app.innerHTML = '<div class="wl wl-' + co + '">' +
    '<div class="wl-hero"><img class="wl-logo" src="' + LOGOS[co] + '" alt="' + h(brand) + '">' +
    '<h1>You\'re in, ' + h(w.first_name) + ' 🎉</h1><p>Welcome to the <b>' + h(brand) + ' BA Academy</b></p>' +
    '<span class="wl-pill">' + h(when) + '</span></div>' +

    '<div class="card"><div class="small muted">DAY 1 · INDUCTION</div><div class="wl-date">' + h(fmtLong(w.academy_date)) + '</div>' +
    '<div class="wl-time">⏰ 1:30pm – 6:00pm</div><p>📍 ' + h(w.address) + '<br><span class="muted small">2 mins from Slough station</span></p>' +
    '<div class="row"><a class="btn sm" href="' + MAPS + '" target="_blank" rel="noopener">🗺️ Directions</a>' +
    '<a class="btn ghost sm" href="' + h(gcal) + '" target="_blank" rel="noopener">📅 Google Calendar</a>' +
    '<a class="btn ghost sm" id="ics" href="#" download="ba-academy-day1.ics">🍏 Apple / Outlook</a></div></div>' +

    (co === 'LINK' ? '<div class="wl-alert">⚡ <b>Before Day 1:</b> finish the <b>Pre-Coaching Module</b> attached in your welcome email.</div>' : '') +
    '<div class="card"><div class="small muted">BRING WITH YOU</div><p style="font-size:17px;margin:8px 0 0">🪪 Photo ID<br>🔑 Your right-to-work share code</p></div>' +

    '<h3>Your Week 1 game plan</h3><div class="card wl-week">' + steps + '</div>' +

    '<details class="card"><summary><b>🚀 Where this can take you</b></summary><div class="ladder" style="margin-top:10px">' +
    LADDER.map(l => '<div style="background:' + l[0] + '">' + h(l[1]) + ' <span>— ' + h(l[2]) + '</span></div>').join('') + '</div></details>' +

    '<details class="card"><summary><b>🖼️ View the Week 1 poster</b></summary><img src="img/poster-' + co.toLowerCase() + '.jpg" alt="Week 1 schedule poster" style="width:100%;border-radius:10px;margin-top:10px" onerror="this.parentNode.hidden=true"></details>' +

    '<p class="center muted small" style="margin:18px 0 110px">Questions? Just reply to the WhatsApp message 💬</p>' +
    '<div class="wl-cta" id="cta"></div></div>';

  const icsA = document.getElementById('ics');
  icsA.onclick = e => {
    e.preventDefault();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); a.download = 'ba-academy-day1.ics';
    document.body.appendChild(a); a.click(); a.remove();
  };
  const cta = document.getElementById('cta');
  const drawCta = (confirmed) => {
    cta.innerHTML = confirmed
      ? '<div class="wl-done">✅ You\'re locked in. See you ' + h(mon ? 'Monday' : fmt(w.academy_date)) + '! 🔥</div>'
      : '<button class="btn block wl-btn" id="conf">🔒 Confirm I\'m coming</button>';
    const b = document.getElementById('conf');
    if (b) b.onclick = () => {
      busy(b, true, 'Locking in…');
      call('confirmAcademy', { t: BOOT.k }).then(() => { drawCta(true); burst(); }).catch(ex => { busy(b, false); toast(ex.message); });
    };
  };
  drawCta(!!w.confirmed_at);
}

function burst() {
  const em = ['🎉', '🔥', '🧡', '💙', '✨', '🙌'];
  for (let i = 0; i < 28; i++) {
    const sp = document.createElement('span');
    sp.className = 'confetti'; sp.textContent = em[i % em.length];
    sp.style.left = Math.random() * 100 + 'vw'; sp.style.animationDelay = (Math.random() * 0.6) + 's';
    document.body.appendChild(sp); setTimeout(() => sp.remove(), 2600);
  }
}

// ═════════════════════════ STAFF ═════════════════════════
function roles() { return (S.me && S.me.user.roles) || []; }
function isAdmin() { return roles().indexOf('admin') >= 0; }
function isPresenter() { return isAdmin() || roles().indexOf('presenter') >= 0; }
function isBooker() { return roles().indexOf('booker') >= 0; }

function startStaff() {
  stopTimer();
  S.token = store.get('tok') || '';
  if (!S.token) return renderLogin();
  call('me').then(m => {
    S.me = m; S.week = S.week || m.weekEnding; S.day = S.day || m.today;
    initPush();
    if (BOOT.cid) { const id = BOOT.cid; BOOT.cid = ''; S.tab = isBooker() ? 'mine' : (isAdmin() ? 'all' : 'today'); return openCandidate(id); }
    go(S.tab || (isPresenter() ? 'today' : 'mine'));
  }).catch(e => { if (S.token) $app.innerHTML = '<div class="err">' + h(e.message) + '</div>'; });
}

function renderLogin() {
  scrollTop();
  $app.innerHTML = logos(56) + '<div class="card"><h1>Staff login</h1><p class="muted">We\'ll email you a 6-digit code. No password needed.</p>' +
    '<label class="q">Work email</label><input type="email" id="em" autocomplete="email" value="' + h(store.get('lastEmail') || '') + '">' +
    '<div id="codeBox" hidden><label class="q">6-digit code</label><input type="text" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></div>' +
    '<div id="err"></div><button class="btn block" id="go" style="margin-top:14px">Email me a code</button></div>';
  let sent = false;
  const btn = document.getElementById('go');
  btn.onclick = () => {
    const email = document.getElementById('em').value.trim();
    const err = document.getElementById('err');
    if (!sent) {
      busy(btn, true, 'Sending…');
      call('requestCode', { email: email }).then(() => {
        sent = true; store.set('lastEmail', email); busy(btn, false);
        btn.textContent = 'Log in';
        document.getElementById('codeBox').hidden = false;
        err.innerHTML = '<div class="ok">If that email has access, a code is on its way. Check your inbox (and junk).</div>';
        document.getElementById('code').focus();
      }).catch(ex => { busy(btn, false); showErr(err, ex.message); });
    } else {
      busy(btn, true, 'Checking…');
      call('verifyCode', { email: email, code: document.getElementById('code').value }).then(r => {
        S.token = r.token; store.set('tok', r.token); startStaff();
      }).catch(ex => { busy(btn, false); showErr(err, ex.message); });
    }
  };
}

function shell(content) {
  const tabs = [];
  if (isPresenter()) tabs.push(['today', '🎤', 'Today']);
  if (isBooker()) tabs.push(['mine', '📞', 'My candidates']);
  if (isAdmin()) tabs.push(['all', '📋', 'All']);
  tabs.push(['pay', '💷', 'Pay']);
  if (isAdmin()) tabs.push(['team', '👥', 'Team']);
  const u = S.me.user;
  return '<div class="topbar"><img src="' + LOGOS.LINK + '" alt="LINK"><img src="' + LOGOS.JUSS + '" alt="JUSS">' +
    '<div class="who">' + h(u.name) + '<br><a href="#" id="logout">Log out</a></div></div>' + pushBar() + content +
    '<nav class="tabs">' + tabs.map(t => '<button data-tab="' + t[0] + '" class="' + (S.tab === t[0] ? 'on' : '') + '"><b>' + t[1] + '</b>' + t[2] + '</button>').join('') + '</nav>';
}
function bindShell() {
  document.querySelectorAll('.tabs button').forEach(b => { b.onclick = () => go(b.dataset.tab); });
  const lo = document.getElementById('logout');
  if (lo) lo.onclick = e => {
    e.preventDefault(); store.del('tok'); S.token = ''; S.me = null;
    if (PUSH.os) PUSH.os.logout().catch(() => {});
    startStaff();
  };
  const pb = document.getElementById('pushon');
  if (pb) pb.onclick = () => PUSH.os.Notifications.requestPermission().then(() => { PUSH.granted = PUSH.os.Notifications.permission; go(S.tab); });
}

// ───── Phone push notifications (OneSignal, only in the installable app) ─────
const PUSH = { os: null, granted: false };
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const IS_STANDALONE = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
function initPush() {
  if (!CFG.ONESIGNAL_APP_ID || !window.OneSignalDeferred || PUSH.started) return;
  PUSH.started = true;
  const base = location.pathname.replace(/[^/]*$/, '');  // e.g. /recruitment/join/
  window.OneSignalDeferred.push(function (OneSignal) {
    return OneSignal.init({
      appId: CFG.ONESIGNAL_APP_ID,
      serviceWorkerPath: base.slice(1) + 'OneSignalSDKWorker.js',
      serviceWorkerParam: { scope: base },
      notifyButton: { enable: false },
    }).then(() => OneSignal.login(S.me.user.id)).then(() => {
      PUSH.os = OneSignal; PUSH.granted = OneSignal.Notifications.permission;
      OneSignal.Notifications.addEventListener('permissionChange', g => { PUSH.granted = g; });
      if (!PUSH.granted && S.me) go(S.tab);  // show the "turn on" bar
    }).catch(e => console.warn('push init', e));
  });
}
function pushBar() {
  if (!CFG.ONESIGNAL_APP_ID) return '';
  if (IS_IOS && !IS_STANDALONE) {
    return '<div class="pushbar">📲 <b>Get candidate alerts on your iPhone:</b> tap <b>Share</b> <span style="font-size:16px">⎋</span> → <b>Add to Home Screen</b>, then open the app from your home screen.</div>';
  }
  if (PUSH.os && !PUSH.granted) {
    return '<div class="pushbar row between"><span>🔔 Turn on alerts so you never miss a check-in or evaluation.</span><button class="btn sm" id="pushon">Turn on</button></div>';
  }
  return '';
}
function go(tab) {
  stopTimer(); S.tab = tab; scrollTop();
  ({ today: viewToday, mine: viewMine, all: viewAll, pay: viewPay, team: viewTeam }[tab] || viewMine)();
}
function loadingView() { $app.innerHTML = shell('<div class="loading">Loading…</div>'); bindShell(); }
function errorView(e) { $app.innerHTML = shell('<div class="err">' + h(e.message) + '</div>'); bindShell(); }

function flagCounts(c) {
  const r = c.flags.filter(f => f.level === 'red').length, a = c.flags.filter(f => f.level === 'amber').length;
  return (r ? '<span class="pill red">' + r + ' red</span> ' : '') + (a ? '<span class="pill amber">' + a + ' amber</span>' : '');
}
function statusPill(c) {
  if (c.admin_status === 'pending') return '<span class="pill red">Awaiting admin</span>';
  if (c.outcome) return '<span class="pill ' + (c.outcome === 'Academy booked' ? 'green' : 'blue') + '">' + h(c.outcome) + (c.outcome_late ? ' · late' : '') + '</span>';
  if (c.eval_at) return '<span class="pill amber">📞 Call needed</span>';
  return '<span class="pill">Waiting for evaluation</span>';
}
function item(c, showStatus) {
  return '<div class="item" data-id="' + h(c.id) + '"><span class="dot ' + h(c.rag) + '"></span><div class="main">' +
    '<div class="name">' + h(c.full_name) + (c.stars ? ' <span style="color:#F2A900">' + '★'.repeat(Number(c.stars)) + '</span>' : '') + '</div>' +
    '<div class="sub">' + (c.booker_name ? h(c.booker_name) + ' <span class="co ' + h(c.company) + '">' + h(c.company) + '</span>' : '<i>Booker not confirmed' + (c.booker_typed ? ': "' + h(c.booker_typed) + '"' : '') + '</i>') + '</div>' +
    '<div class="row" style="margin-top:4px;gap:4px">' + (showStatus ? statusPill(c) + ' ' : '') + (c.in_room ? '' : '<span class="pill">Not rated yet</span> ') + flagCounts(c) + '</div>' +
    '</div><span class="muted">›</span></div>';
}
function bindItems() {
  document.querySelectorAll('.item[data-id]').forEach(el => { el.onclick = () => openCandidate(el.dataset.id); });
}
function groupByDate(items) {
  const g = {};
  items.forEach(c => { (g[c.attended_date] = g[c.attended_date] || []).push(c); });
  return Object.keys(g).sort().map(d => '<div class="datehead">' + fmt(d) + ' · ' + g[d].length + '</div><div class="list">' + g[d].map(c => item(c, true)).join('') + '</div>').join('');
}
function weekNav() {
  return '<div class="weeknav"><button class="btn ghost sm" id="wprev">‹</button><div class="lbl">Week ending ' + fmt(S.week) + '</div>' +
    '<button class="btn ghost sm" id="wnext"' + (S.week >= S.me.weekEnding ? ' disabled' : '') + '>›</button></div>';
}
function bindWeekNav(reload) {
  document.getElementById('wprev').onclick = () => { S.week = addDays(S.week, -7); reload(); };
  document.getElementById('wnext').onclick = () => { S.week = addDays(S.week, 7); reload(); };
}

// ───── Today (presenter) ─────
function viewToday() {
  loadingView();
  call('listDay', { date: S.day }).then(d => {
    const inRoom = d.items.filter(c => c.in_room).length, evals = d.items.filter(c => c.eval_at).length;
    const isToday = S.day === S.me.today;
    $app.innerHTML = shell(
      '<h1>' + (isToday ? 'Today' : fmt(S.day)) + '</h1>' +
      '<div class="row"><input type="date" id="day" value="' + h(S.day) + '" style="max-width:180px"></div>' +
      '<div class="card tight row between"><div><div class="stat">' + d.items.length + '</div><div class="small muted">checked in</div></div>' +
      '<div><div class="stat">' + inRoom + '</div><div class="small muted">in room</div></div>' +
      '<div><div class="stat">' + evals + '</div><div class="small muted">evaluations</div></div></div>' +
      '<p class="small muted">Tap a name to rate them. Rating someone confirms they were in the room (that\'s what counts for pay).</p>' +
      '<div class="list">' + (d.items.length ? d.items.map(c => item(c, false)).join('') : '<p class="muted center" style="padding:24px 0">No check-ins yet. They appear here as people scan the check-in QR on your first slide.</p>') + '</div>'
    );
    bindShell(); bindItems();
    document.getElementById('day').onchange = e => { S.day = e.target.value || S.me.today; viewToday(); };
    if (isToday) S.timer = setInterval(() => { if (S.tab === 'today') viewTodayQuiet(); }, 20000);
  }).catch(errorView);
}
function viewTodayQuiet() {
  call('listDay', { date: S.day }).then(d => {
    const list = document.querySelector('.list'); if (!list || S.tab !== 'today') return;
    list.innerHTML = d.items.length ? d.items.map(c => item(c, false)).join('') : list.innerHTML;
    bindItems();
  }).catch(() => {});
}
// ───── QR codes for the presentation slides (admin) ─────
/** Slide-ready PNG: title, big QR, caption. Same code forever, so it can live on the slides. */
function slideQR(url, title, caption, colour) {
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
  const n = qr.getModuleCount(), cell = Math.floor(860 / (n + 4)), size = cell * (n + 4);
  const W = 1000, H = size + 300;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.fillStyle = colour; x.fillRect(0, 0, W, 150);
  x.fillStyle = '#fff'; x.font = '800 64px -apple-system, Segoe UI, Roboto, Arial'; x.textAlign = 'center';
  x.fillText(title, W / 2, 98);
  const ox = Math.floor((W - size) / 2), oy = 170;
  x.fillStyle = '#111';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) x.fillRect(ox + (c + 2) * cell, oy + (r + 2) * cell, cell, cell);
  x.fillStyle = '#2F2F38'; x.font = '600 38px -apple-system, Segoe UI, Roboto, Arial';
  x.fillText(caption, W / 2, oy + size + 80);
  return cv.toDataURL('image/png');
}
function viewSlideQR() {
  stopTimer(); scrollTop();
  const L = S.me.links;
  const card = (url, title, cap, col, file, where) => {
    const png = slideQR(url, title, cap, col);
    return '<div class="card qrcard"><h2>' + h(where) + '</h2><img src="' + png + '" alt="' + h(title) + ' QR">' +
      '<div class="row" style="justify-content:center;margin-top:10px"><a class="btn sm" href="' + png + '" download="' + file + '">⬇️ Download PNG</a></div>' +
      '<p class="small muted" style="word-break:break-all">' + h(url) + '</p></div>';
  };
  $app.innerHTML = shell('<button class="btn ghost sm" id="back" style="margin-top:6px">‹ Team</button><h1>QR codes for your slides</h1>' +
    '<p class="muted">These never change. Put them on the presentation once and you\'re done. No presenter taps needed.</p>' +
    card(L.checkin, 'SCAN TO CHECK IN', 'Takes 1 minute · do it now 👋', '#F15A24', 'qr-1-checkin.png', '1 · First slide: Check-in') +
    card(L.eval, 'SCAN FOR YOUR EVALUATION', '4 minutes · be honest, no wrong answers', '#2FB5C0', 'qr-2-evaluation.png', '2 · Last slide: Evaluation') +
    '<p class="small muted">If Download doesn\'t work on your phone, press and hold the image → Save. On a laptop, right-click → Save image.</p>');
  bindShell();
  document.getElementById('back').onclick = () => go('team');
}

// ───── My candidates (booker) ─────
function viewMine() {
  loadingView();
  const reload = viewMine;
  Promise.all([call('listWeek', { weekEnding: S.week, mine: true }), call('payReport', { weekEnding: S.week })]).then(([w, p]) => {
    const me = p.rows.filter(r => r.booker_id === S.me.user.id)[0] || { net: 0, attended: 0, excluded: [] };
    const pct = Math.min(100, Math.round(me.net / p.target * 100));
    const toCall = w.items.filter(c => c.eval_at && !c.outcome);
    $app.innerHTML = shell(
      '<h1>My candidates</h1>' + weekNav() +
      '<div class="card"><div class="row between"><div><div class="stat">' + me.net + '<span class="muted" style="font-size:20px">/' + p.target + '</span></div>' +
      '<div class="small muted">net attended (Mon–Fri)</div></div><div class="small muted" style="text-align:right">' + me.attended + ' attended<br>' + me.excluded.length + ' don\'t count</div></div>' +
      '<div class="progress' + (me.net >= p.target ? ' done' : '') + '"><i style="width:' + pct + '%"></i></div>' +
      (me.excluded.length ? '<div class="small muted">Not counted: ' + me.excluded.map(x => h(x.name) + ' (' + h(x.why) + ')').join('; ') + '</div>' : '') + '</div>' +
      (toCall.length ? '<div class="flag amber">📞 ' + toCall.length + ' to call — log outcomes by Sat ' + h(S.me.deadlineTime) + '</div>' : '') +
      (w.items.length ? groupByDate(w.items) : '<p class="muted center" style="padding:24px 0">No candidates this week yet.</p>')
    );
    bindShell(); bindItems(); bindWeekNav(reload);
  }).catch(errorView);
}

// ───── All (admin) ─────
function viewAll() {
  loadingView();
  call('listWeek', { weekEnding: S.week }).then(w => {
    const F = {
      all: ['All', () => true],
      call: ['Needs outcome', c => !c.outcome],
      pending: ['Awaiting admin', c => c.admin_status === 'pending'],
      red: ['Red flags', c => c.flags.some(f => f.level === 'red')],
      nobooker: ['No booker', c => !c.booker_id],
      late: ['Late', c => !!c.outcome_late],
    };
    const items = w.items.filter(F[S.filter][1]);
    $app.innerHTML = shell(
      '<h1>All candidates</h1><input type="text" id="q" placeholder="Search name, mobile or email (last 12 months)">' +
      '<div id="sr"></div>' + weekNav() +
      '<div class="chips" id="flt">' + Object.keys(F).map(k => '<button class="chip' + (S.filter === k ? ' on' : '') + '" data-f="' + k + '">' + F[k][0] + ' (' + w.items.filter(F[k][1]).length + ')</button>').join('') + '</div>' +
      (items.length ? groupByDate(items) : '<p class="muted center" style="padding:24px 0">Nothing here.</p>')
    );
    bindShell(); bindItems(); bindWeekNav(viewAll);
    document.querySelectorAll('#flt .chip').forEach(b => { b.onclick = () => { S.filter = b.dataset.f; viewAll(); }; });
    let t;
    document.getElementById('q').oninput = e => {
      clearTimeout(t); const q = e.target.value;
      t = setTimeout(() => {
        const sr = document.getElementById('sr');
        if (q.trim().length < 2) { sr.innerHTML = ''; return; }
        call('search', { q: q }).then(r => {
          sr.innerHTML = '<div class="list">' + (r.items.length ? r.items.map(c => item(c, true)).join('') : '<p class="muted">No matches.</p>') + '</div><hr>';
          bindItems();
        });
      }, 350);
    };
  }).catch(errorView);
}

// ───── Candidate snapshot (the one page) ─────
const TAGS = ['Learn new skills', 'Earnings driven', 'Personal development', 'Sales experience', 'Customer service exp', 'Confident', 'Quiet', 'Great energy', 'Holiday booked', 'Leadership potential', 'Future owner'];

function openCandidate(id) {
  stopTimer(); scrollTop(); loadingView();
  const need = isAdmin() && !S.users ? call('listUsers').then(r => { S.users = r.users; }) : Promise.resolve();
  Promise.all([call('getCandidate', { id: id }), need]).then(([c]) => renderCandidate(c)).catch(errorView);
}

function brandOf(c) { return c.company === 'JUSS' ? 'JUSS Marketing' : 'LINK Marketing'; }
function waUrl(mobile, text) { return 'https://wa.me/44' + String(mobile).slice(1) + '?text=' + encodeURIComponent(text); }

const HEART = { LINK: '🧡', JUSS: '🧡💙' };
function heartOf(c) { return HEART[c.company === 'JUSS' ? 'JUSS' : 'LINK']; }
function msgThanks(c) {
  const b = c.booker_name ? c.booker_name.split(' ')[0] : '';
  return 'Hey ' + c.first_name + '! 👋\n\n' +
    'Thanks for coming through to ' + brandOf(c) + ' today ' + heartOf(c) + ' Loved having you in the room.\n\n' +
    (b ? b + ' will' : 'We\'ll') + ' hit you up shortly about your next steps 📲 Keep your phone close!';
}
function msgNoAnswer(c) {
  return 'Hey ' + c.first_name + ' 👋 it\'s ' + S.me.user.name.split(' ')[0] + ' from ' + brandOf(c) + '!\n\n' +
    'Just tried calling about today\'s presentation 📞 When\'s good for a quick 2-min chat? Drop me a time 👇';
}
/** Short, scannable, one link. The link opens their personal page (schedule, poster, map, calendar, CONFIRM). */
function msgAcademy(c) {
  const juss = c.company === 'JUSS';
  const lines = [
    c.first_name.toUpperCase() + '!! 🎉 You\'re IN.',
    '',
    'Welcome to the *' + brandOf(c) + ' BA Academy* ' + heartOf(c),
    '',
    '📅 *Day 1: ' + fmt(c.academy_date) + ' · 1:30pm*',
    '📍 Automotive House, Slough (2 mins from the station)',
    '',
  ];
  if (c.welcome_url) lines.push('👇 Your Week 1 game plan + tap *CONFIRM* to lock in your spot:', c.welcome_url, '');
  if (!juss) lines.push('⚡ Before Day 1: finish the *Pre-Coaching Module* in your welcome email');
  const sign = (S.me.signoff || {})[juss ? 'JUSS' : 'LINK'] || S.me.user.name.split(' ')[0];
  lines.push('🪪 Bring photo ID + your right-to-work share code', '', 'Let\'s get it 🔥', '– ' + sign + ', ' + brandOf(c));
  return lines.join('\n');
}

function renderCandidate(c) {
  const canNotes = isPresenter();
  const canOutcome = isAdmin() || c.booker_id === S.me.user.id;
  const red = c.flags.filter(f => f.level === 'red'), amber = c.flags.filter(f => f.level === 'amber'), green = c.flags.filter(f => f.level === 'green');
  const flags = red.concat(amber, green);
  const kv = (k, v) => v ? '<dt>' + h(k) + '</dt><dd>' + h(v) + '</dd>' : '';
  const qa = (q, a) => '<div class="qa"><div class="qq">' + h(q) + '</div><div class="aa">' + (a ? h(a) : '<span class="muted">—</span>') + '</div></div>';
  const evalHtml = c.eval_at
    ? qa('Excitement (1–10)', c.q1_excitement) + qa('What stood out', c.q2_stood_out) + qa('#1 reason for joining', c.q3_reason) +
      qa('Current situation', c.q4_situation + (c.q4_looking_for ? ' — looking for ' + c.q4_looking_for : '')) +
      qa('Earliest start', c.q5_start_date ? fmt(c.q5_start_date) : '') + qa('Days per week', c.q6_days) + qa('Commute to Slough daily', c.q7_commute) +
      qa('Kept going when it got tough', c.q8_resilience) + qa('Earned on results', c.q9_results_paid + (c.q9_results_detail ? ' — ' + c.q9_results_detail : '')) +
      qa('Door shut in face', c.q10_door) + qa('Coach says pitch isn\'t working', c.q11_coach) +
      qa('2-year ambition (BDP)', c.q12_bdp_stage + (c.q12_bdp_why ? ' — ' + c.q12_bdp_why : '')) +
      (isAdmin() ? qa('Unspent convictions (admin only)', c.q13_unspent) : '') + qa('Questions for us', c.q14_questions)
    : '<p class="muted">Not submitted yet.</p>';

  const academyDefault = c.academy_date || nextMonday(S.me.today);
  const offerReady = c.outcome === 'Academy booked' && c.admin_status !== 'pending' && c.admin_status !== 'rejected';

  let html = '<button class="btn ghost sm" id="back" style="margin-top:6px">‹ Back</button>' +
    '<div class="card"><div class="row between"><h1 style="margin:0">' + h(c.full_name) + '</h1><span class="dot ' + h(c.rag) + '" style="width:20px;height:20px"></span></div>' +
    '<p class="muted small">Attended ' + fmt(c.attended_date) + ' · w/e ' + fmt(c.week_ending) + '</p>' +
    '<p>' + (c.booker_name ? 'Booked by <b>' + h(c.booker_name) + '</b> <span class="co ' + h(c.company) + '">' + h(c.company) + '</span>' : '<b class="muted">Booker not confirmed</b>' + (c.booker_typed ? ' (typed "' + h(c.booker_typed) + '")' : '')) + '</p>' +
    '<div class="row"><a class="btn sm" href="tel:' + h(c.mobile) + '">📞 ' + h(c.mobile) + '</a><a class="btn ghost sm" href="mailto:' + h(c.email) + '">✉️ Email</a></div>' +
    (c.stars ? '<p style="color:#F2A900;font-size:20px;margin-top:10px">' + '★'.repeat(Number(c.stars)) + '<span style="color:#D5D3CF">' + '★'.repeat(5 - Number(c.stars)) + '</span></p>' : '') +
    '</div>' +
    (flags.length ? '<div class="flags">' + flags.map(f => '<div class="flag ' + f.level + '">' + (f.level === 'red' ? '🔴 ' : f.level === 'amber' ? '🟠 ' : '🟢 ') + h(f.text) + '</div>').join('') + '</div>' : '');

  // Presenter
  html += '<h3>Presenter</h3><div class="card" id="pres">';
  if (canNotes) {
    html += '<button type="button" class="toggle' + (c.in_room ? ' on' : '') + '" id="inroom">' + (c.in_room ? '✅ In the room' : '⬜ Tap to confirm they\'re in the room') + '</button>' +
      '<label class="q">Recommendation</label><div class="rag"><button type="button" class="G' + (c.rag === 'G' ? ' on' : '') + '" data-r="G">Green</button>' +
      '<button type="button" class="A' + (c.rag === 'A' ? ' on' : '') + '" data-r="A">Amber</button><button type="button" class="R' + (c.rag === 'R' ? ' on' : '') + '" data-r="R">Red</button></div>' +
      '<label class="q">Stars</label><div class="stars">' + [1, 2, 3, 4, 5].map(n => '<button type="button" data-s="' + n + '" class="' + (Number(c.stars) >= n ? 'on' : '') + '">★</button>').join('') + '</div>' +
      '<label class="q">Quick tags</label><div class="chips" data-name="tags" data-multi="1">' + TAGS.map(t => '<button type="button" class="chip' + ((c.tags || '').split(', ').indexOf(t) >= 0 ? ' on' : '') + '" data-v="' + h(t) + '">' + h(t) + '</button>').join('') + '</div>' +
      '<label class="q">Notes</label><textarea id="notes" placeholder="e.g. Done sales in Turkey, likes speaking to people. Loves football.">' + h(c.notes) + '</textarea>' +
      '<div id="perr"></div><button class="btn block" id="savenotes" style="margin-top:10px">Save notes</button>' +
      (c.notes_at ? '<p class="small muted">Last saved ' + fmtTs(c.notes_at) + ' by ' + h(c.presenter_name) + '</p>' : '');
  } else {
    html += '<dl class="kv">' + kv('In the room', c.in_room ? 'Yes' : 'Not confirmed') + kv('Recommendation', { G: 'Green', A: 'Amber', R: 'Red' }[c.rag] || '') +
      kv('Stars', c.stars ? c.stars + ' / 5' : '') + kv('Tags', c.tags) + kv('Presenter', c.presenter_name) + '</dl>' +
      (c.notes ? '<p style="white-space:pre-wrap;margin-top:10px">' + h(c.notes) + '</p>' : '<p class="muted">No notes yet.</p>');
  }
  html += '</div>';

  // Check-in
  html += '<h3>Check-in</h3><div class="card"><dl class="kv">' + kv('Email', c.email) + kv('18 or over', c.over18) + kv('Right to work', c.rtw) +
    kv('Visa expiry', c.visa_expiry ? fmt(c.visa_expiry) : '') + kv('Found us via', c.source) + kv('Typed booker', c.booker_typed) + kv('Checked in', fmtTs(c.created_at)) + '</dl></div>';

  // Evaluation
  html += '<h3>Evaluation' + (c.eval_at ? ' · ' + fmtTs(c.eval_at) : '') + '</h3><div class="card">' + evalHtml + '</div>';

  // Outcome
  html += '<h3>Call outcome</h3><div class="card" id="out">';
  if (c.outcome) {
    html += '<p><span class="pill ' + (c.outcome === 'Academy booked' ? 'green' : 'blue') + '">' + h(c.outcome) + '</span>' +
      (c.academy_date ? ' <b>Day 1: ' + fmtLong(c.academy_date) + '</b>' : '') + '</p>' +
      '<p class="small muted">Logged ' + fmtTs(c.outcome_at) + ' by ' + h(c.outcome_by) + (c.outcome_late ? ' · <b style="color:var(--amber)">LATE (after deadline ' + fmtTs(c.deadline) + ')</b>' : '') + '</p>' +
      (c.outcome_notes ? '<p style="white-space:pre-wrap">' + h(c.outcome_notes) + '</p>' : '') +
      (c.outcome === 'Academy booked' && offerReady ? (c.academy_confirmed_at
        ? '<div class="flag green">✅ ' + h(c.first_name) + ' confirmed Day 1 on their welcome page · ' + fmtTs(c.academy_confirmed_at) + '</div>'
        : '<div class="flag amber">⏳ Not confirmed yet. They confirm by tapping the link in your WhatsApp.</div>') : '') +
      (c.admin_status === 'pending' ? '<div class="flag red">Waiting for admin to approve this Academy booking (presenter marked RED or previously not suitable).</div>' : '') +
      (c.admin_status === 'approved' ? '<div class="flag green">Approved by ' + h(c.admin_by) + (c.admin_note ? ': ' + h(c.admin_note) : '') + '</div>' : '') +
      (c.admin_status === 'rejected' ? '<div class="flag red">Rejected by ' + h(c.admin_by) + (c.admin_note ? ': ' + h(c.admin_note) : '') + '</div>' : '');
    if (canOutcome) html += '<hr>';
  } else if (!canOutcome) html += '<p class="muted">Not logged yet. Deadline ' + fmtTs(c.deadline) + '.</p>';
  if (canOutcome) {
    html += '<p class="small muted">Deadline: ' + fmtTs(c.deadline) + '. Logging after this is allowed but flagged late.</p>' +
      '<label class="q">' + (c.outcome ? 'Update outcome' : 'How did the call go?') + '</label>' + chips('outcome', S.me.outcomes, c.outcome, true) +
      '<div id="acad"' + (c.outcome === 'Academy booked' ? '' : ' hidden') + '><label class="q">BA Academy Day 1 date</label><input type="date" id="adate" value="' + h(academyDefault) + '"></div>' +
      '<label class="q">Notes from the call</label><textarea id="onotes" placeholder="Anything the team should know">' + h(c.outcome_notes) + '</textarea>' +
      '<div id="oerr"></div><button class="btn block" id="saveout" style="margin-top:10px">Save outcome</button>';
  }
  html += '</div>';

  // WhatsApp
  const wa = [];
  if (canNotes) wa.push('<a class="btn wa block" target="_blank" rel="noopener" data-kind="thanks" href="' + h(waUrl(c.mobile, msgThanks(c))) + '">💬 Send thank-you message</a>' +
    (c.thanks_sent_at ? '<p class="small muted center">Opened ' + fmtTs(c.thanks_sent_at) + '</p>' : ''));
  if (canOutcome && offerReady) wa.push('<a class="btn wa block" target="_blank" rel="noopener" data-kind="offer" href="' + h(waUrl(c.mobile, msgAcademy(c))) + '">🎉 Send BA Academy Day 1 details (' + h(c.company || 'LINK') + ')</a>' +
    (c.offer_sent_at ? '<p class="small muted center">Opened ' + fmtTs(c.offer_sent_at) + '</p>' : '') +
    (c.welcome_url ? '<a class="btn ghost sm" target="_blank" rel="noopener" href="' + h(c.welcome_url) + '">👀 Preview their welcome page</a>' : ''));
  if (canOutcome && c.outcome === 'No answer') wa.push('<a class="btn wa block" target="_blank" rel="noopener" data-kind="noanswer" href="' + h(waUrl(c.mobile, msgNoAnswer(c))) + '">📞 Send "missed you" message</a>');
  if (wa.length) html += '<h3>WhatsApp</h3><div class="card" style="display:grid;gap:8px">' + wa.join('') + '<p class="small muted center">Opens WhatsApp with the message ready, then just tap send.</p></div>';

  // Admin
  if (isAdmin()) {
    html += '<h3>Admin</h3><div class="card">';
    if (c.admin_status === 'pending') {
      html += '<p><b>Decision needed:</b> ' + h(c.outcome_by) + ' wants to book BA Academy.</p><input type="text" id="anote" placeholder="Note (optional)">' +
        '<div class="row" style="margin-top:8px"><button class="btn green grow" id="approve">Approve</button><button class="btn red grow" id="reject">Reject</button></div><hr>';
    }
    html += '<p><b>Pay count:</b> ' + (c.pay_reason ? '<span style="color:var(--red)">Doesn\'t count — ' + h(c.pay_reason) + '</span>' : '<span style="color:var(--green)">Counts towards ' + h(c.booker_name || 'booker') + '\'s net ' + S.me.payTarget + '</span>') + '</p>' +
      (c.pay_excluded
        ? '<button class="btn ghost sm" id="incl">Count it again</button>'
        : '<div class="row"><input type="text" id="exr" class="grow" placeholder="Reason, e.g. share code failed" style="flex:1"><button class="btn ghost sm" id="excl">Remove from pay</button></div>') +
      '<hr><label class="q" style="margin-top:0">Booker</label><div class="row"><select id="rb" style="flex:1"><option value="">Choose booker…</option>' +
      (S.users || []).filter(u => u.active && (u.roles.indexOf('booker') >= 0 || u.roles.indexOf('admin') >= 0)).map(u => '<option value="' + h(u.id) + '"' + (u.id === c.booker_id ? ' selected' : '') + '>' + h(u.name) + ' (' + h(u.company) + ')</option>').join('') +
      '</select><button class="btn ghost sm" id="reas">Save</button></div></div>';
  }

  $app.innerHTML = shell(html);
  bindShell();
  document.getElementById('back').onclick = () => go(S.tab);

  // presenter bindings
  if (canNotes) {
    const st = { rag: c.rag, stars: Number(c.stars) || 0, in_room: !!c.in_room };
    const pres = document.getElementById('pres');
    bindChips(pres);
    document.getElementById('inroom').onclick = e => {
      st.in_room = !st.in_room;
      e.currentTarget.classList.toggle('on', st.in_room);
      e.currentTarget.textContent = st.in_room ? '✅ In the room' : '⬜ Tap to confirm they\'re in the room';
      call('markInRoom', { id: c.id, in_room: st.in_room }).then(() => toast(st.in_room ? 'Marked in the room' : 'Unmarked')).catch(x => toast(x.message));
    };
    pres.querySelectorAll('.rag button').forEach(b => { b.onclick = () => { st.rag = st.rag === b.dataset.r ? '' : b.dataset.r; pres.querySelectorAll('.rag button').forEach(x => x.classList.toggle('on', x.dataset.r === st.rag)); }; });
    pres.querySelectorAll('.stars button').forEach(b => { b.onclick = () => { st.stars = Number(b.dataset.s); pres.querySelectorAll('.stars button').forEach(x => x.classList.toggle('on', Number(x.dataset.s) <= st.stars)); }; });
    document.getElementById('savenotes').onclick = e => {
      const btn = e.currentTarget; busy(btn, true);
      call('saveNotes', { id: c.id, in_room: st.in_room, rag: st.rag || '', stars: st.stars, tags: chipVals(pres, 'tags'), notes: document.getElementById('notes').value })
        .then(nc => { toast('Notes saved'); renderCandidate(nc); }).catch(x => { busy(btn, false); showErr(document.getElementById('perr'), x.message); });
    };
  }
  // outcome bindings
  if (canOutcome) {
    const out = document.getElementById('out');
    bindChips(out, (n, v) => { if (n === 'outcome') document.getElementById('acad').hidden = v !== 'Academy booked'; });
    document.getElementById('saveout').onclick = e => {
      const btn = e.currentTarget; busy(btn, true);
      call('saveOutcome', { id: c.id, outcome: chipVal(out, 'outcome'), academy_date: document.getElementById('adate').value, outcome_notes: document.getElementById('onotes').value })
        .then(nc => { toast(nc.outcome_late ? 'Saved — flagged late' : 'Outcome saved'); renderCandidate(nc); }).catch(x => { busy(btn, false); showErr(document.getElementById('oerr'), x.message); });
    };
  }
  // whatsapp: record that it was opened
  document.querySelectorAll('a.wa[data-kind]').forEach(a => {
    a.addEventListener('click', () => { if (a.dataset.kind !== 'noanswer') call('markSent', { id: c.id, kind: a.dataset.kind }).catch(() => {}); });
  });
  // admin bindings
  if (isAdmin()) {
    const dec = d => () => call('adminDecision', { id: c.id, decision: d, note: (document.getElementById('anote') || {}).value || '' }).then(nc => { toast('Decision saved'); renderCandidate(nc); }).catch(x => toast(x.message));
    const ap = document.getElementById('approve'); if (ap) { ap.onclick = dec('approved'); document.getElementById('reject').onclick = dec('rejected'); }
    const ex = document.getElementById('excl');
    if (ex) ex.onclick = () => {
      const r = document.getElementById('exr').value.trim();
      if (!r) return toast('Add a reason first');
      call('setPayExcluded', { id: c.id, excluded: true, reason: r }).then(nc => { toast('Removed from pay count'); renderCandidate(nc); }).catch(x => toast(x.message));
    };
    const inc = document.getElementById('incl');
    if (inc) inc.onclick = () => call('setPayExcluded', { id: c.id, excluded: false }).then(nc => { toast('Counted again'); renderCandidate(nc); }).catch(x => toast(x.message));
    document.getElementById('reas').onclick = () => {
      const v = document.getElementById('rb').value; if (!v) return toast('Choose a booker');
      call('reassignBooker', { id: c.id, booker_id: v }).then(nc => { toast('Booker updated'); renderCandidate(nc); }).catch(x => toast(x.message));
    };
  }
}

// ───── Pay ─────
function viewPay() {
  loadingView();
  call('payReport', { weekEnding: S.week }).then(p => {
    const rows = p.rows.filter(r => r.attended > 0 || isAdmin());
    $app.innerHTML = shell(
      '<h1>Pay — net attended</h1>' + weekNav() +
      '<p class="small muted">Counts Mon–Fri appointments confirmed in the room by the presenter. Doesn\'t count: under 18, not eligible to work self-employed (incl. Tier 4), repeats within 12 months, or removed by admin. Target: <b>' + p.target + '</b>. Outcome deadline: ' + fmtTs(p.deadline) + '.</p>' +
      '<div class="card" style="padding:8px 12px"><table class="t"><tr><th>Booker</th><th class="n">Att.</th><th class="n">Net</th><th class="n">Late</th><th class="n">No outcome</th></tr>' +
      (rows.length ? rows.map((r, i) => '<tr data-i="' + i + '" style="cursor:pointer"><td><b>' + h(r.name) + '</b> <span class="co ' + h(r.company) + '">' + h(r.company) + '</span>' +
        '<div class="small muted" hidden>' + (r.excluded.length ? r.excluded.map(x => h(x.name) + ': ' + h(x.why)).join('<br>') : 'Nothing excluded') + '</div></td>' +
        '<td class="n">' + r.attended + '</td><td class="n"><b>' + r.net + '</b> ' + (r.net >= p.target ? '✅' : '') + '</td>' +
        '<td class="n">' + (r.late ? '<span class="pill amber">' + r.late + '</span>' : '0') + '</td><td class="n">' + (r.missing ? '<span class="pill red">' + r.missing + '</span>' : '0') + '</td></tr>').join('')
        : '<tr><td colspan="5" class="muted">No appointments this week.</td></tr>') +
      '</table><p class="small muted">Tap a row to see what didn\'t count.</p></div>' +
      (p.unassigned.length ? '<h3>No confirmed booker (' + p.unassigned.length + ')</h3><div class="list">' + p.unassigned.map(x => '<div class="item" data-id="' + h(x.id) + '"><div class="main"><div class="name">' + h(x.name) + '</div><div class="sub">Typed: "' + h(x.typed || '—') + '" — tap to assign</div></div>›</div>').join('') + '</div>' : '')
    );
    bindShell(); bindItems(); bindWeekNav(viewPay);
    document.querySelectorAll('tr[data-i]').forEach(tr => { tr.onclick = () => { const d = tr.querySelector('div.small'); d.hidden = !d.hidden; }; });
  }).catch(errorView);
}

// ───── Team (admin) ─────
function viewTeam() {
  loadingView();
  call('listUsers').then(r => {
    S.users = r.users;
    const row = u => '<div class="item" data-u="' + h(u.id) + '"><div class="main"><div class="name">' + h(u.name) + ' <span class="co ' + h(u.company) + '">' + h(u.company) + '</span>' +
      (u.active ? '' : ' <span class="pill red">No access</span>') + '</div><div class="sub">' + h(u.email) + ' · ' + h(u.roles.join(', ')) + '</div></div>›</div>';
    $app.innerHTML = shell('<div class="row between"><h1>Team</h1><button class="btn sm" id="add">+ Add person</button></div>' +
      '<button class="btn ghost block" id="slideqr" style="margin:4px 0 8px">📲 QR codes for the presentation slides</button>' +
      '<p class="small muted">' + r.users.filter(u => u.active).length + ' with access. Bookers appear in the candidate check-in list.</p>' +
      '<div class="list">' + r.users.map(row).join('') + '</div>');
    bindShell();
    document.getElementById('add').onclick = () => editUser(null);
    document.getElementById('slideqr').onclick = viewSlideQR;
    document.querySelectorAll('.item[data-u]').forEach(el => { el.onclick = () => editUser(r.users.filter(u => u.id === el.dataset.u)[0]); });
  }).catch(errorView);
}

function editUser(u) {
  scrollTop();
  const x = u || { name: '', email: '', company: 'LINK', roles: ['booker'], active: true };
  $app.innerHTML = shell('<button class="btn ghost sm" id="back" style="margin-top:6px">‹ Team</button><div class="card" id="uf"><h2>' + (u ? 'Edit ' + h(u.name) : 'Add a person') + '</h2>' +
    '<label class="q">Full name</label><input type="text" id="un" value="' + h(x.name) + '">' +
    '<label class="q">Email (used to log in)</label><input type="email" id="ue" value="' + h(x.email) + '">' +
    '<label class="q">Company</label>' + chips('company', ['LINK', 'JUSS'], x.company) +
    '<div class="help" style="margin-top:6px">Decides which WhatsApp welcome message (LINK or JUSS) they send.</div>' +
    '<label class="q">Access</label><div class="chips" data-name="roles" data-multi="1">' +
    [['booker', 'Booker'], ['presenter', 'Presenter'], ['admin', 'Admin (adds/removes people, sees everything)']].map(r => '<button type="button" class="chip' + (x.roles.indexOf(r[0]) >= 0 ? ' on' : '') + '" data-v="' + r[0] + '">' + r[1] + '</button>').join('') + '</div>' +
    '<label class="check"><input type="checkbox" id="ua"' + (x.active ? ' checked' : '') + '> Has access (untick to switch off instantly)</label>' +
    '<div id="uerr"></div><button class="btn block" id="usave">Save</button>' +
    (u && u.id !== S.me.user.id ? '<button class="btn ghost block" id="udel" style="margin-top:8px;color:var(--red)">Delete person</button>' : '') + '</div>');
  bindShell();
  const uf = document.getElementById('uf'); bindChips(uf);
  document.getElementById('back').onclick = () => go('team');
  document.getElementById('usave').onclick = e => {
    const btn = e.currentTarget; busy(btn, true);
    call('saveUser', { user: { id: u ? u.id : '', name: document.getElementById('un').value, email: document.getElementById('ue').value, company: chipVal(uf, 'company'), roles: chipVals(uf, 'roles'), active: document.getElementById('ua').checked } })
      .then(() => { toast('Saved'); go('team'); }).catch(x2 => { busy(btn, false); showErr(document.getElementById('uerr'), x2.message); });
  };
  const del = document.getElementById('udel');
  if (del) del.onclick = () => {
    if (!confirm('Delete ' + u.name + '? If they have candidates, their access is switched off instead so pay history stays correct.')) return;
    call('deleteUser', { id: u.id }).then(r => { toast(r.deleted ? 'Deleted' : 'Access switched off (they have candidates)'); go('team'); }).catch(x2 => toast(x2.message));
  };
}

// ───────────── go ─────────────
if (BOOT.mode === 'staff') startStaff(); else startCandidate();
})();
