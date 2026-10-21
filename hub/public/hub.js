// LINK × JUSS home. ?app=fr&r=/home (from an app's "Sign in") → sign in if needed, then straight back to that app.
'use strict';
(function () {
  const $ = id => document.getElementById(id);
  const steps = ['stepEmail', 'stepCode', 'stepGo', 'stepHome'];
  const show = id => steps.forEach(s => { $(s).hidden = s !== id; });
  const params = new URLSearchParams(location.search);
  const want = params.get('app'), back = params.get('r') || '/';
  const ICON = { recruit: '🗂️', fr: '📘', hf: '🥗', leaders: '🏆', jleaders: '🏆' };
  const NAMES = { recruit: 'Recruitment', fr: 'Link Org Playbook', hf: 'JUSS Playbook', leaders: 'Leaders Playbook', jleaders: 'Leaders Playbook' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let email = '';

  const api = (path, body) => fetch('/api/' + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
    .then(r => r.json()).catch(() => ({ ok: false, error: 'No connection. Check your signal and try again.' }));
  const msg = (id, text) => { const m = $(id); m.textContent = text || ''; m.hidden = !text; };
  const busy = (btn, on, label) => { btn.disabled = on; if (label) btn.textContent = on ? label : btn.dataset.label || btn.textContent; };
  const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning,' : h < 18 ? 'Good afternoon,' : 'Good evening,'; };
  const goUrl = app => '/api/go?app=' + encodeURIComponent(app) + '&r=' + encodeURIComponent(app === want ? back : '/');

  // One brand at a time: JUSS people (and anyone arriving from the JUSS Playbook) see only JUSS, LINK people only LINK.
  // Before we know who you are and where you came from: both logos.
  const APP_BRAND = { fr: 'LINK', leaders: 'LINK', hf: 'JUSS', jleaders: 'JUSS' };
  const BRAND_NAME = { LINK: 'LINK Marketing', JUSS: 'JUSS Marketing' };
  function theme(company) {
    const c = company === 'LINK' || company === 'JUSS' ? company : '';
    document.documentElement.classList.remove('t-LINK', 't-JUSS');
    if (c) document.documentElement.classList.add('t-' + c);
    $('logoLINK').hidden = c === 'JUSS'; $('logoJUSS').hidden = c === 'LINK'; $('logoX').hidden = !!c;
    document.title = c ? BRAND_NAME[c] : 'LINK × JUSS';
    document.querySelector('meta[name=theme-color]').content = c === 'JUSS' ? '#0A1D26' : '#17171D';
  }
  const arrivalBrand = (params.get('brand') || '').toUpperCase() || APP_BRAND[want] || '';
  function header(d) {
    const person = d.person, first = (person.name || person.email).split(' ')[0];
    $('hello').textContent = greet();
    $('title').textContent = first;
    $('lead').textContent = 'Your apps, one tap away.';
    $('chips').innerHTML = (person.company ? '<span class="chip">' + esc(person.company) + '</span>' : '') +
      (d.stageLabel ? '<span class="chip">' + esc(d.stageLabel) + '</span>' : '') +
      (d.admin ? '<span class="chip">Admin</span>' : d.approver ? '<span class="chip">Approver</span>' : '');
  }

  // CG1-style path: where you are, and what opens next
  function journey(d) {
    if (!d.stage) { $('journey').hidden = true; return; }
    // Angad's ladder: Stages 1 & 2 = Brand Ambassador (the playbook's Cycle of Development 1, then 2 "Becoming a Leader"), Stage 3 = Leader
    const juss = d.person.company === 'JUSS', pb = juss ? 'JUSS Playbook' : 'Link Org Playbook';
    // LINK: Stage 3 opens inside the Link Org Playbook (21 Oct); JUSS: its own Leaders Playbook
    const s3 = juss ? 'your Leaders Playbook' : 'Stage 3 in your Link Org Playbook';
    const steps = [
      { n: 2, dot: '1–2', t: 'Brand Ambassador', s: 'Stages 1 & 2 · your ' + pb + ' and Cycle of Development' },
      { n: 3, dot: '3', t: 'Leader', s: d.stage >= 3 ? (d.waitingForLeaders ? 'Approved · ' + s3 + ' opens very soon' : 'Stage 3 · ' + s3 + ' is open') : 'Stage 3 · opens when an approver moves you on' },
    ];
    $('ladder').innerHTML = steps.map(x => '<li class="' + (x.n < d.stage ? 'done' : x.n === d.stage ? 'now' : 'next') + '"><div class="dot">' + (x.n < d.stage ? '✓' : x.dot) + '</div><div><b>' + esc(x.t) + '</b><span>' + esc(x.s) + '</span></div></li>').join('');
    $('journey').hidden = false;
  }

  // Approvers: their company's BAs, two taps to move someone on
  let TEAM = [];
  function drawTeam() {
    const f = $('teamSearch').value.trim().toLowerCase();
    const list = TEAM.filter(p => !f || p.name.toLowerCase().includes(f)).slice(0, 60);
    $('people').innerHTML = list.map(p => '<div class="person"><div class="who"><b>' + esc(p.name) + '</b><span>' + esc(p.company) + ' · ' + (p.app === 'fr' ? 'Link Org Playbook' : 'JUSS Playbook') + (p.email ? '' : ' · needs to sign in once') + '</span></div>' +
      (p.stage >= 3 ? '<span class="badge l">Leader</span>' : p.canPromote ? '<button class="mini" data-app="' + p.app + '" data-id="' + esc(p.id) + '" data-name="' + esc(p.name) + '">Move to Stage 3</button>' : '<span class="badge">BA</span>') + '</div>').join('') ||
      '<p class="hint" style="margin:6px 2px">Nobody matches.</p>';
  }
  function loadTeam() {
    api('team').then(r => {
      if (!r.ok) { $('moveOn').hidden = true; return; }
      TEAM = r.people;
      const co = r.companies.join();
      $('moveHint').textContent = 'Approve a ' + r.companies.join(' or ') + ' BA to Stage 3 · Leader and ' +
        (co === 'JUSS' ? 'their Leaders Playbook opens' : co === 'LINK' ? 'Stage 3 opens in their Link Org Playbook' : 'Stage 3 opens in their playbook') + ' on their phone.';
      $('moveOn').hidden = false; drawTeam();
    });
  }
  $('teamSearch').addEventListener('input', drawTeam);
  $('people').addEventListener('click', e => {
    const b = e.target.closest('button.mini'); if (!b) return;
    if (!b.classList.contains('sure')) { b.classList.add('sure'); b.textContent = 'Tap to confirm'; setTimeout(() => { if (b.isConnected && !b.disabled) { b.classList.remove('sure'); b.textContent = 'Move to Stage 3'; } }, 4000); return; }
    b.disabled = true; b.textContent = 'Moving on…';
    api('promote', { app: b.dataset.app, id: b.dataset.id }).then(r => {
      const m = $('moveMsg'); m.className = 'msg ' + (r.ok ? 'ok' : 'err'); m.hidden = false;
      m.textContent = r.ok ? (r.already ? r.name + ' is already a Leader.' : r.name + ' is now a Leader 🎉 ' + (r.opened ? 'Stage 3 is open for them.' : 'Stage 3 opens for them as soon as it can.')) : r.error;
      loadTeam();
    });
  });

  // Admins: who can approve
  function drawApprovers(list) {
    $('approverList').innerHTML = list.map(a => '<div class="person"><div class="who"><b>' + esc(a.name || a.email) + '</b><span>' + esc((a.company ? a.company + ' · ' : '') + a.email) + '</span></div><button class="mini ghost" data-email="' + esc(a.email) + '">Remove</button></div>').join('') ||
      '<p class="hint" style="margin:6px 2px">No approvers yet. Admins can move anyone on.</p>';
  }
  function loadApprovers() { api('approvers').then(r => { $('approversCard').hidden = !r.ok; if (r.ok) drawApprovers(r.approvers); }); }
  $('addApprover').addEventListener('submit', e => {
    e.preventDefault();
    api('approvers', { email: $('approverEmail').value, on: true }).then(r => { msg('approverMsg', r.ok ? '' : r.error); $('approverMsg').className = 'msg err'; if (r.ok) { $('approverEmail').value = ''; drawApprovers(r.approvers); } });
  });
  $('approverList').addEventListener('click', e => {
    const b = e.target.closest('button.mini'); if (!b) return;
    api('approvers', { email: b.dataset.email, on: false }).then(r => { if (r.ok) drawApprovers(r.approvers); });
  });

  function render(d) {
    theme(d.person.company);
    header(d);
    // Came from an app: go straight back, signed in (one tap if the browser blocks the jump)
    if (want && d.tiles.some(t => t.id === want)) {
      $('goTitle').textContent = 'Opening ' + NAMES[want] + '…';
      $('goHint').textContent = 'Signed in as ' + d.person.email + '.';
      $('goBtn').href = goUrl(want);
      show('stepGo');
      setTimeout(() => { location.replace(goUrl(want)); }, 450);
      return;
    }
    const tiles = $('tiles');
    tiles.innerHTML = d.tiles.map(t => '<a class="tile rise co-' + (t.company || 'both') + '" href="' + goUrl(t.id) + '"><div class="ic">' + (ICON[t.id] || '•') + '</div><div><b>' + t.name + '</b><span>' + t.blurb + '</span></div><div class="go">›</div></a>').join('') ||
      '<div class="card rise"><h2>No apps yet</h2><p class="hint">We couldn\'t find an account for this email in any app. Ask your manager to add you.</p></div>';
    $('connectHf').hidden = !d.canConnectHf;
    const no = params.get('noaccount') || (want && !d.tiles.some(t => t.id === want) ? want : '');
    msg('homeMsg', no ? 'You don\'t have a ' + (NAMES[no] || no) + ' account with this email yet. Ask your manager, or connect your old account below.' : '');
    journey(d);
    if (d.approver) loadTeam(); else $('moveOn').hidden = true;
    if (d.admin) loadApprovers(); else $('approversCard').hidden = true;
    show('stepHome');
  }

  $('stepEmail').addEventListener('submit', e => {
    e.preventDefault();
    email = $('email').value.trim().toLowerCase();
    const btn = $('sendBtn'); btn.dataset.label = 'Email me a code'; busy(btn, true, 'Sending…'); msg('emailMsg', '');
    api('code', { email }).then(r => {
      busy(btn, false);
      if (!r.ok) return msg('emailMsg', r.error);
      $('codeHint').textContent = 'If ' + email + ' is on any of our apps, a code is on its way. It works for 10 minutes. Check Spam if it isn\'t there in a minute.';
      show('stepCode'); $('code').value = ''; $('code').focus();
    });
  });
  $('code').addEventListener('input', () => { const v = $('code').value.replace(/\D/g, '').slice(0, 6); $('code').value = v; if (v.length === 6) $('stepCode').requestSubmit(); });
  $('stepCode').addEventListener('submit', e => {
    e.preventDefault();
    const btn = $('codeBtn'); btn.dataset.label = 'Sign in'; busy(btn, true, 'Checking…'); msg('codeMsg', '');
    api('verify', { email, code: $('code').value }).then(r => { busy(btn, false); r.ok ? render(r) : msg('codeMsg', r.error); });
  });
  $('again').addEventListener('click', () => { show('stepEmail'); $('email').focus(); });
  const signOut = () => api('logout', {}).then(() => { theme(arrivalBrand); location.href = location.pathname + (want ? location.search : ''); });
  $('logout').addEventListener('click', signOut);
  $('notMe').addEventListener('click', signOut);
  $('connectHf').addEventListener('submit', e => {
    e.preventDefault();
    const btn = $('hfBtn'); btn.dataset.label = 'Connect'; busy(btn, true, 'Checking…'); msg('hfMsg', '');
    api('connect', { username: $('hfUser').value, password: $('hfPass').value }).then(r => { busy(btn, false); $('hfPass').value = ''; r.ok ? render(r) : msg('hfMsg', r.error); });
  });

  theme(arrivalBrand);
  if (arrivalBrand) { $('hello').textContent = BRAND_NAME[arrivalBrand]; }
  api('me').then(r => {
    if (r.ok) return render(r);
    if (want) $('lead').textContent = 'Sign in to open ' + (NAMES[want] || 'your app') + '. You\'ll only need to do this once on this phone.';
    show('stepEmail');
  });
})();
