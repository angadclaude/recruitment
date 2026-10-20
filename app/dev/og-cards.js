// Draws the WhatsApp link-preview cards for the welcome pages (app/assets/og-link.jpg, og-juss.jpg, 1200×630): the Week 1
// game plan as the welcome page shows it, taken from WEEK1 in JS.html, so the preview and the page always match.
// They used to show the old poster (Angad, 20 Oct: no poster, and 👣 belongs to the Practical Learning Day, not Tuesday).
// node app/dev/og-cards.js   (then node app/build.js copies them into join/img)
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
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  for (const co of ['LINK', 'JUSS']) {
    await p.setContent(card(co), { waitUntil: 'load' });
    const out = path.join(ASSETS, 'og-' + co.toLowerCase() + '.jpg');
    await p.screenshot({ path: out, type: 'jpeg', quality: 88 });
    console.log('wrote ' + out);
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
