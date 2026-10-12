// Local dev server: serves the Apps Script HTML and routes google.script.run to the fake GAS.
// Usage: node dev/server.js [port]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { load } = require('./gas');

const PORT = Number(process.argv[2] || 8787);
const SRC = path.join(__dirname, '..', 'src');
const gas = load({ url: `http://localhost:${PORT}/exec` });

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SHIM = `<script>
(function(){
  function mk(s,f){return{withSuccessHandler:function(fn){return mk(fn,f)},withFailureHandler:function(fn){return mk(s,fn)},
    api:function(req){fetch('/api',{method:'POST',body:JSON.stringify(req)}).then(function(r){return r.json()}).then(function(d){s&&s(d)}).catch(function(e){f&&f(e)})}}}
  window.google={script:{run:mk(null,null)}};
})();
</script>`;

function render(params) {
  const vars = { mode: params.get('app') === 'staff' ? 'staff' : 'candidate', k: params.get('k') || '', cid: params.get('c') || '' };
  let html = fs.readFileSync(path.join(SRC, 'Index.html'), 'utf8');
  html = html.replace(/<\?!= include\('(\w+)'\) \?>/g, (m, n) => (n === 'JS' ? SHIM : '') + fs.readFileSync(path.join(SRC, n + '.html'), 'utf8'));
  html = html.replace(/<\?= (\w+) \?>/g, (m, n) => esc(vars[n]));
  return html;
}

function body(req) {
  return new Promise(r => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => r(b ? JSON.parse(b) : {})); });
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (u.pathname === '/exec' || u.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(render(u.searchParams));
    }
    if (u.pathname === '/api' && req.method === 'POST') {
      const r = gas.api(await body(req));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(r));
    }
    if (u.pathname === '/dev/mail') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(gas.state.outbox)); }
    if (u.pathname === '/dev/run' && req.method === 'POST') {
      const b = await body(req);
      const out = gas.run(b.fn, ...(b.args || []));
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ out: out === undefined ? null : out }));
    }
    if (u.pathname === '/dev/eval' && req.method === 'POST') {
      const b = await body(req);
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ out: gas.eval(b.js) }));
    }
    if (u.pathname === '/dev/time' && req.method === 'POST') {
      const b = await body(req);
      gas.setOffsetMs(b.iso ? new Date(b.iso).getTime() - Date.now() : 0);
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}');
    }
    if (u.pathname === '/dev/sheet') {
      const sh = gas.state.sheets[u.searchParams.get('name')];
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(sh ? sh.data : null));
    }
    res.writeHead(404); res.end('not found');
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end(String(e.stack || e));
  }
}).listen(PORT, () => console.log('dev server on http://localhost:' + PORT));
