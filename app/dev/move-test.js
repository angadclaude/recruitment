// Proves the address move (app/move.js) before it goes live: two pretend addresses in one browser.
// Usage: node app/dev/move-test.js   (prints ✓ lines; exits non-zero on a failure)
'use strict';
const { chromium } = require('playwright');
const moveScript = require('../move.js');
const OLD = 'https://old.example/recruitment/join/', NEW = 'https://new.example/';
const snippet = moveScript(NEW, [OLD]);
const pageHtml = who => '<!DOCTYPE html><html><head><meta charset="utf-8">' + snippet + '</head><body><p id="who">' + who + '</p>' +
  '<script>document.getElementById("who").dataset.tok = localStorage.getItem("lr_tok") || ""; document.getElementById("who").dataset.cand = localStorage.getItem("lr_cand") || "";</script></body></html>';
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

(async () => {
  ok(moveScript(NEW, []) === '', 'nothing added to the pages until there is an old address to move from');
  const browser = await chromium.launch();
  const run = async (seedOld, seedNew, path) => {
    const ctx = await browser.newContext();
    await ctx.route('https://old.example/**', r => r.fulfill({ contentType: 'text/html', body: pageHtml('OLD') }));
    await ctx.route('https://new.example/**', r => r.fulfill({ contentType: 'text/html', body: pageHtml('NEW') }));
    await ctx.addInitScript(([o, n]) => {
      const s = location.host === 'old.example' ? o : location.host === 'new.example' ? n : null;
      if (s && !sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); Object.keys(s).forEach(k => localStorage.setItem(k, s[k])); }
    }, [seedOld || {}, seedNew || {}]);
    const p = await ctx.newPage();
    await p.goto(OLD + path);
    await p.waitForLoadState('load'); await p.waitForTimeout(300);
    const r = { url: p.url(), who: await p.textContent('#who'), tok: await p.getAttribute('#who', 'data-tok'), cand: await p.getAttribute('#who', 'data-cand') };
    await ctx.close();
    return r;
  };
  const tok = JSON.stringify('t0ken-abc'), cand = JSON.stringify({ id: 'c1', resume: 'r1', first_name: 'Keira' });
  let r = await run({ lr_tok: tok }, null, 'index.html?c=abc123');
  ok(r.who === 'NEW' && r.url === NEW + 'index.html?c=abc123', 'staff app: old address → same page at the new one (' + r.url + ')');
  ok(r.tok === tok && !/#/.test(r.url), 'still logged in there, and the login is cleared from the address bar');
  r = await run({ lr_cand: cand }, null, 'eval.html');
  ok(r.who === 'NEW' && r.cand === cand && r.url === NEW + 'eval.html', 'candidate on the evaluation QR: lands on the new page, still known (no need to find themselves again)');
  r = await run({}, null, 'welcome-juss.html?t=tk1&n=Keira&d=2026-11-02');
  ok(r.who === 'NEW' && r.url === NEW + 'welcome-juss.html?t=tk1&n=Keira&d=2026-11-02', 'a welcome link sent last week: same page at the new address, link intact');
  r = await run({ lr_tok: tok, lr_outbox: JSON.stringify([{ action: 'saveNotes' }]) }, null, 'index.html');
  ok(r.who === 'OLD', 'a save still waiting to reach Google: stays put to send it (moves on the next open)');
  r = await run({ lr_sendq: JSON.stringify({ confirm_tk1: { t: 1 } }) }, null, 'welcome-link.html?t=tk1');
  ok(r.who === 'OLD', 'a Confirm still waiting to send (no signal): stays put to send it');
  r = await run({ lr_tok: tok }, { lr_tok: JSON.stringify('newer-login') }, 'index.html');
  ok(r.who === 'NEW' && r.tok === JSON.stringify('newer-login'), 'already logged in at the new address: that login is kept');
  await browser.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nALL MOVE CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
