// Draws the WhatsApp link-preview cards for the welcome pages (app/assets/og-link.jpg, og-juss.jpg, 1200×630): the Week 1
// game plan as the welcome page shows it, taken from WEEK1 in JS.html, so the preview and the page always match.
// They used to show the old poster (Angad, 20 Oct: no poster, and 👣 belongs to the Practical Learning Day, not Tuesday).
// And the booking link's card (og-booked-juss.jpg, og-booked-link.jpg; Angad approved the mock-up on 12 Nov): the logo, "You're booked
// in" in the app's heading font (Anton) and a "Tap to confirm" pill. The same picture for every booking: nothing about anyone on it.
// node app/dev/og-cards.js [booked]   (then node app/build.js copies them into join/img; "booked" draws only the booking cards)
const fs = require('fs'), path = require('path'), { chromium } = require('playwright');
const SRC = path.join(__dirname, '..', 'src', 'JS.html'), ASSETS = path.join(__dirname, '..', 'assets');
const WEEK1 = eval('(' + /const WEEK1 = (\{[\s\S]*?\n\});/.exec(fs.readFileSync(SRC, 'utf8'))[1] + ')');
const h = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const LOOK = {
  LINK: { stage: 'radial-gradient(60% 110% at 100% 0%,rgba(241,90,36,.75) 0%,rgba(241,90,36,0) 70%),radial-gradient(130% 160% at 85% 0%,#2C2C38 0%,#17171D 55%,#0F0F14 100%)',
    grad: 'linear-gradient(120deg,#FF8A3D 0%,#F15A24 48%,#CF3A10 100%)', accent: '#FF8A3D', tint: '#FFEBE1', ink: '#C2410C', dark: '#17171D', logoW: 92 },
  JUSS: { stage: 'radial-gradient(55% 110% at 100% 0%,rgba(237,160,58,.6) 0%,rgba(237,160,58,0) 70%),radial-gradient(60% 130% at 70% 0%,rgba(52,177,192,.5) 0%,rgba(52,177,192,0) 70%),radial-gradient(130% 160% at 85% 0%,#1D5566 0%,#0D2833 55%,#071820 100%)',
    grad: 'linear-gradient(120deg,#E4613F 0%,#EDA03A 48%,#34B1C0 100%)', accent: '#F4C26B', tint: '#DDF2F3', ink: '#0E7C8A', dark: '#0D2833', logoW: 162 },
};
const card = co => {
  const L = LOOK[co], logo = 'data:image/png;base64,' + fs.readFileSync(path.join(ASSETS, 'logo-' + co.toLowerCase() + '.png')).toString('base64');
  const days = WEEK1[co].map((r, i, a) => '<div class="d"><div class="ic' + (i === a.length - 1 ? ' last' : '') + '">' + r[0] + '</div><div><span class="dn">' + h(r[1]) + '</span>' +
    '<div class="n">' + h(r[2]) + '</div><div class="t">⏰ ' + h(r[3]) + '</div></div></div>').join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0} body{width:1200px;height:630px;overflow:hidden;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:${L.dark};background-image:${L.stage};color:#fff;display:flex;gap:44px;padding:52px 56px}
    .l{flex:1;display:flex;flex-direction:column;justify-content:center} .logo{display:inline-block;background:#fff;border-radius:22px;padding:12px 16px;margin-bottom:30px;align-self:flex-start}
    .logo img{display:block;height:80px;width:auto} .bar{height:7px;width:90px;border-radius:9px;background:${L.grad};margin-bottom:22px}
    h1{font-size:92px;line-height:1;font-weight:900;letter-spacing:-2px} .sub{font-size:40px;font-weight:800;color:${L.accent};margin-top:14px}
    .p{font-size:28px;opacity:.88;margin-top:10px} .go{align-self:flex-start;margin-top:30px;background:#fff;color:#17171D;font-size:30px;font-weight:800;border-radius:99px;padding:16px 34px}
    .r{width:470px;background:#fff;color:#22222B;border-radius:30px;padding:26px 28px;display:flex;flex-direction:column;justify-content:space-between;position:relative}
    .hd{font-size:15px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#22222B;margin-bottom:6px}
    .steps{position:relative;flex:1;display:flex;flex-direction:column;justify-content:space-between}
    .steps:before{content:'';position:absolute;left:27px;top:30px;bottom:40px;width:4px;border-radius:4px;background:linear-gradient(${L.tint},${L.accent})}
    .d{display:flex;gap:16px;align-items:center;position:relative} .ic{flex:none;width:58px;height:58px;border-radius:18px;background:${L.tint};display:grid;place-items:center;font-size:30px;box-shadow:0 0 0 5px #fff}
    .ic.last{background:${L.grad}} .dn{display:inline-block;font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#fff;background:${L.dark};border-radius:99px;padding:4px 11px}
    .n{font-size:23px;font-weight:900;letter-spacing:-.3px;margin-top:3px;line-height:1.15} .t{font-size:16px;font-weight:800;color:${L.ink};margin-top:2px}
  </style></head><body><div class="l"><div class="logo"><img src="${logo}" alt=""></div><div class="bar"></div><h1>YOU'RE IN.</h1>
    <div class="sub">BA Academy · Week 1</div><div class="p">Your game plan + confirm your spot</div><div class="go">Tap to open →</div></div>
    <div class="r"><div class="hd">🗓️ Your Week 1 game plan</div><div class="steps">${days}</div></div></body></html>`;
};
const BOOKED = {
  JUSS: { bg: '#0F2833', bands: ['#E8743B', '#E9A23B', '#3CA6A6'], logoH: 104 },
  LINK: { bg: '#17171D', bands: ['#FF8A3D', '#F15A24', '#CF3A10'], logoH: 104 },
};
const booked = co => {
  const L = BOOKED[co], logo = 'data:image/png;base64,' + fs.readFileSync(path.join(ASSETS, 'logo-' + co.toLowerCase() + '.png')).toString('base64');
  const anton = 'data:font/woff2;base64,' + fs.readFileSync(path.join(ASSETS, 'fonts', 'anton-latin-400-normal.woff2')).toString('base64');
  const oswald = 'data:font/woff2;base64,' + fs.readFileSync(path.join(ASSETS, 'fonts', 'oswald-latin-700-normal.woff2')).toString('base64');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face{font-family:Anton;src:url(${anton}) format('woff2')} @font-face{font-family:Oswald;font-weight:700;src:url(${oswald}) format('woff2')}
    *{box-sizing:border-box;margin:0} body{width:1200px;height:630px;overflow:hidden;position:relative;background:${L.bg};color:#fff}
    .band{position:absolute;width:760px;height:200px;border-radius:100px;transform:rotate(-27deg);transform-origin:left center}
    .b1{left:690px;top:60px;background:${L.bands[0]}} .b2{left:745px;top:232px;background:${L.bands[1]}} .b3{left:800px;top:404px;background:${L.bands[2]}}
    .logo{position:absolute;left:64px;top:56px;background:#fff;border-radius:30px;padding:22px 26px;box-shadow:0 10px 30px rgba(0,0,0,.25)}
    .logo img{display:block;height:${L.logoH}px;width:auto}
    h1{position:absolute;left:64px;bottom:66px;font-family:Anton,Impact,sans-serif;font-weight:400;font-size:102px;line-height:1;letter-spacing:.005em;white-space:nowrap}
    .go{position:absolute;right:56px;bottom:64px;background:#fff;color:#0F2833;font-family:Oswald,'Segoe UI',sans-serif;font-weight:700;font-size:40px;line-height:1;border-radius:99px;padding:24px 38px;box-shadow:0 10px 30px rgba(0,0,0,.25);white-space:nowrap}
  </style></head><body><i class="band b1"></i><i class="band b2"></i><i class="band b3"></i>
    <div class="logo"><img src="${logo}" alt=""></div><h1>You're booked in</h1><div class="go">Tap to confirm</div></body></html>`;
};
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  const only = process.argv[2] || '';
  for (const co of only === 'booked' ? [] : ['LINK', 'JUSS']) {
    await p.setContent(card(co), { waitUntil: 'load' });
    const out = path.join(ASSETS, 'og-' + co.toLowerCase() + '.jpg');
    await p.screenshot({ path: out, type: 'jpeg', quality: 88 });
    console.log('wrote ' + out);
  }
  for (const co of ['JUSS', 'LINK']) {
    await p.setContent(booked(co), { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    const out = path.join(ASSETS, 'og-booked-' + co.toLowerCase() + '.jpg');
    await p.screenshot({ path: out, type: 'jpeg', quality: 88 });
    console.log('wrote ' + out + ' (' + Math.round(fs.statSync(out).size / 1024) + ' KB)');
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
