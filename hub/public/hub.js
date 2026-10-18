// LINK × JUSS home. ?app=fr&r=/home (from an app's "Sign in") → sign in if needed, then straight back to that app.
'use strict';
(function () {
  const $ = id => document.getElementById(id);
  const steps = ['stepEmail', 'stepCode', 'stepGo', 'stepHome'];
  const show = id => steps.forEach(s => { $(s).hidden = s !== id; });
  const params = new URLSearchParams(location.search);
  const want = params.get('app'), back = params.get('r') || '/';
  const ICON = { recruit: '🗂️', fr: '📘', hf: '🥗', leaders: '🏆' };
  const NAMES = { recruit: 'Recruitment', fr: 'Fund Raising Playbook', hf: 'HelloFresh Playbook', leaders: 'Leaders Playbook' };
  let email = '';

  const api = (path, body) => fetch('/api/' + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
    .then(r => r.json()).catch(() => ({ ok: false, error: 'No connection. Check your signal and try again.' }));
  const msg = (id, text) => { const m = $(id); m.textContent = text || ''; m.hidden = !text; };
  const busy = (btn, on, label) => { btn.disabled = on; if (label) btn.textContent = on ? label : btn.dataset.label || btn.textContent; };
  const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning,' : h < 18 ? 'Good afternoon,' : 'Good evening,'; };
  const goUrl = app => '/api/go?app=' + encodeURIComponent(app) + '&r=' + encodeURIComponent(app === want ? back : '/');

  // One brand at a time: JUSS people (and anyone arriving from the HelloFresh Playbook) see only JUSS, LINK people only LINK.
  // Before we know who you are and where you came from: both logos.
  const APP_BRAND = { fr: 'LINK', leaders: 'LINK', hf: 'JUSS' };
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
  function header(person) {
    const first = (person.name || person.email).split(' ')[0];
    $('hello').textContent = greet();
    $('title').textContent = first;
    $('lead').textContent = 'Your apps, one tap away.';
    $('chips').innerHTML = (person.company ? '<span class="chip">' + person.company + '</span>' : '') + '<span class="chip">' + person.email.replace(/</g, '') + '</span>';
  }

  function render(d) {
    theme(d.person.company);
    header(d.person);
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
