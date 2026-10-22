// The relay's "Send mail as" list when Google is slow (22 Oct fix). A fake Google relay answers relayInfo after 5 s;
// a fake jl.props in memory. node app/dev/relay-slow.js
const http = require('http'), path = require('path');
const live = require(path.join(__dirname, '..', '..', 'server', 'live.js'));
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const props = {};
const db = { sql: (strings, ...vals) => {
  const q = strings.join('?');
  if (/insert into jl\.props/.test(q)) { props[vals[0]] = vals[1]; return Promise.resolve([]); }
  if (/select val from jl\.props/.test(q)) return Promise.resolve(props[vals[0]] !== undefined ? [{ val: props[vals[0]] }] : []);
  return Promise.resolve([]);
} };
let delay = 5000, aliases = ['jess@linkmarketing.org.uk', 'rubal@jussmarketing.co.uk'];
const srv = http.createServer((req, res) => setTimeout(() => res.end(JSON.stringify({ ok: true, data: { quota: 1400, aliases } })), delay));
srv.listen(0, async () => {
  process.env.RELAY_URL = 'http://127.0.0.1:' + srv.address().port + '/'; process.env.RELAY_SECRET = 'x';
  const t0 = Date.now(), r1 = live._test.relay(db);
  const a1 = await r1.aliases();
  ok(Date.now() - t0 < 4500 && a1.length === 0, 'first ever ask, Google slow, nothing kept yet: waits ≤3 s, no list (as before)');
  await r1.pending();
  ok(JSON.parse(props.SEND_AS_LAST).length === 2, 'the late answer (after 5 s) is kept');
  const r2 = live._test.relay(db), t1 = Date.now(), a2 = await r2.aliases();
  ok(Date.now() - t1 < 4500 && a2.join() === 'jess@linkmarketing.org.uk,rubal@jussmarketing.co.uk', 'a fresh server, Google slow again: the kept list is used (Jess can send)');
  await r2.pending();
  delay = 10; aliases = ['jess@linkmarketing.org.uk'];
  const r3 = live._test.relay(db), a3 = await r3.aliases();
  ok(a3.join() === 'jess@linkmarketing.org.uk' && JSON.parse(props.SEND_AS_LAST).join() === 'jess@linkmarketing.org.uk', 'Google answers in time: its answer wins and replaces the kept one (an address removed is removed)');
  await r3.remember({ quota: 1, aliases: ['a@x', 'b@y'] });
  ok(JSON.parse(props.SEND_AS_LAST).join() === 'a@x,b@y' && (await r3.aliases()).join() === 'a@x,b@y', 'the 5-minute timer\'s answer is used and kept');
  srv.close(); console.log(fails ? fails + ' FAILED' : 'ALL RELAY CHECKS PASSED'); process.exit(fails ? 1 : 0);
});
