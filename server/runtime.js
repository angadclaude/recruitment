// Runs Code.gs (in server/worker.js) against a Postgres database. Each request or timer is one job = one database
// transaction; jobs run one at a time per server instance. Emails go into jl.outbox inside the transaction and are
// sent after it commits (so a request that fails sends nothing).
'use strict';
const path = require('path');
const { Worker, MessageChannel } = require('worker_threads');

const LOCK_KEY = 7342001;  // the "script lock": one writer at a time across every server instance

class Runtime {
  /**
   * @param {object} o
   * @param {object} o.db       server/db.js adapter (begin() → { q, commit, rollback, cycle, release })
   * @param {function} [o.http] async (reqs) → [{ code, text }]  (live: real fetch; tests use the worker's fake)
   * @param {object} [o.mail]   { quota(): number, aliases(): string[], deliver(rows) } (live: Google relay)
   * @param {object} [o.env]    PUBLIC_URL, OWNER_EMAIL, ONESIGNAL_API_KEY, TRIGGERS
   * @param {boolean} [o.testMode]
   */
  constructor(o) {
    this.o = o;
    this.queue = Promise.resolve();
    this.seq = 0;
    this.testMail = [];
  }

  start() {
    if (this.worker) return this.ready;
    const sab = new SharedArrayBuffer(4);
    this.flag = new Int32Array(sab);
    const { port1, port2 } = new MessageChannel();
    this.io = port1;
    this.worker = new Worker(path.join(__dirname, 'worker.js'), {
      workerData: { sab, ioPort: port2, codePath: this.o.codePath || path.join(__dirname, '..', 'app', 'src', 'Code.gs'), env: this.o.env || {}, testMode: !!this.o.testMode },
      transferList: [port2],
    });
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.worker.on('message', m => {
        if (m.ready) return resolve();
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.error) p.reject(Object.assign(new Error(m.error.split('\n')[0]), { stack: m.error })); else p.resolve(m.value);
      });
      this.worker.on('error', e => { reject(e); this.pending.forEach(p => p.reject(e)); this.pending.clear(); this.worker = null; });
      this.worker.on('exit', () => { this.worker = null; });
    });
    port1.on('message', msg => this.serve(msg));
    return this.ready;
  }

  /** Answer one synchronous call from Code.gs, then wake the worker. */
  async serve({ op, args }) {
    let reply;
    try { reply = { value: await this.op(op, args) }; } catch (e) { reply = { error: String((e && e.message) || e), retry: !!(e && e.retry) }; }
    this.io.postMessage(reply);
    Atomics.store(this.flag, 0, 1);
    Atomics.notify(this.flag, 0);
  }

  async op(op, a) {
    const q = (text, params) => this.conn.q(text, params);
    switch (op) {
      case 'tab.load': {
        const t = (await q('select headers, max_rows, max_cols from jl.tabs where name = $1', [a[0]]))[0];
        if (!t) return null;
        const rows = await q('select rid::text as rid, vals from jl.rows where tab = $1 order by pos', [a[0]]);
        return { headers: t.headers, max_rows: t.max_rows, max_cols: t.max_cols, rows };
      }
      case 'tab.create': await q('insert into jl.tabs (name) values ($1) on conflict do nothing', [a[0]]); return null;
      case 'tab.list': return (await q('select name from jl.tabs order by created_at, name')).map(r => r.name);
      case 'tab.drop': await q('delete from jl.tabs where name = $1', [a[0]]); return null;
      // jsonb values go in as text then cast (::text::jsonb): with a bare ::jsonb the live driver (postgres-js) JSON-encodes
      // the string a second time, storing a JSON *string* (19 Oct 2026: a login-code email went out with no recipient)
      case 'tab.headers': await q('update jl.tabs set headers = $2::text::jsonb where name = $1', [a[0], JSON.stringify(a[1])]); return null;
      case 'tab.max': await q('update jl.tabs set max_rows = $2, max_cols = $3 where name = $1', [a[0], a[1], a[2]]); return null;
      case 'rows.write': {
        const out = [];
        for (const r of a[1]) {
          if (r.rid) { await q('update jl.rows set vals = $2::text::jsonb where rid = $1::bigint', [r.rid, JSON.stringify(r.vals)]); out.push(r.rid); }
          else out.push((await q('insert into jl.rows (tab, vals) values ($1, $2::text::jsonb) returning rid::text as rid', [a[0], JSON.stringify(r.vals)]))[0].rid);
        }
        return out;
      }
      case 'rows.delete': await q('delete from jl.rows where rid = any($1::bigint[])', [a[1]]); return null;
      case 'lock': {
        const until = Date.now() + Math.max(0, a[0] || 0);
        for (;;) {
          if ((await q('select pg_try_advisory_xact_lock($1) as ok', [LOCK_KEY]))[0].ok) return true;
          if (Date.now() >= until) return false;
          await new Promise(r => setTimeout(r, 50));
        }
      }
      case 'unlock': await this.conn.cycle(); return null;  // commit now (others see it, the lock goes) and carry on
      case 'props.get': { const r = (await q('select val from jl.props where key = $1', [a[0]]))[0]; return r ? r.val : null; }
      case 'props.set': await q('insert into jl.props (key, val) values ($1, $2) on conflict (key) do update set val = excluded.val', [a[0], a[1]]); return null;
      case 'props.delete': await q('delete from jl.props where key = $1', [a[0]]); return null;
      case 'props.all': { const o = {}; (await q('select key, val from jl.props')).forEach(r => { o[r.key] = r.val; }); return o; }
      case 'cache.get': { const r = (await q('select val from jl.cache where key = $1 and expires_at > now()', [a[0]]))[0]; return (r && r.val) || null; }
      case 'cache.put': await q("insert into jl.cache (key, val, expires_at) values ($1, $2, now() + make_interval(secs => $3::double precision)) on conflict (key) do update set val = excluded.val, expires_at = excluded.expires_at", [a[0], a[1], Math.min(21600, Number(a[2]) || 600)]); return null;
      case 'cache.remove': await q('delete from jl.cache where key = $1', [a[0]]); return null;
      case 'http': return this.o.http(a[0]);
      case 'mail.send': {
        if (this.o.testMode) { this.testMail.push(testMailRow(a[0])); return null; }
        const id = (await q('insert into jl.outbox (payload) values ($1::text::jsonb) returning id::text as id', [JSON.stringify(a[0])]))[0].id;
        this.sent.push(id);
        return null;
      }
      case 'mail.quota': return this.o.testMode ? 1500 - this.testMail.length : this.o.mail.quota();
      case 'mail.aliases': return this.o.mail.aliases();
      default: throw new Error('Unknown database call: ' + op);
    }
  }

  /** Queue a job (one transaction). type: 'call' { fn, args } · 'eval' { js } · 'pushes'. */
  run(job) {
    const p = this.queue.then(() => this.exec(job));
    this.queue = p.catch(() => {});
    return p;
  }
  call(fn, ...args) { return this.run({ type: 'call', fn, args }); }

  async exec(job) {
    await this.start();
    this.conn = await this.o.db.begin();
    this.sent = [];
    let value;
    try {
      value = await new Promise((resolve, reject) => {
        const id = ++this.seq;
        this.pending.set(id, { resolve, reject });
        this.worker.postMessage(Object.assign({ id }, job));
      });
      await this.conn.commit();
    } catch (e) {
      try { await this.conn.rollback(); } catch (e2) { /* connection gone */ }
      throw e;
    } finally {
      this.conn.release();
      this.conn = null;
    }
    if (this.sent.length && this.o.mail) await this.o.mail.deliver(this.sent).catch(e => console.error('mail delivery', e));
    return value;
  }

  /** Run something directly on the database between jobs (tests, imports). */
  withDb(fn) {
    const p = this.queue.then(async () => {
      const conn = await this.o.db.begin();
      try { const r = await fn((t, ps) => conn.q(t, ps)); await conn.commit(); return r; } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
    });
    this.queue = p.catch(() => {});
    return p;
  }

  async stop() { if (this.worker) await this.worker.terminate(); this.worker = null; }
}

/** Tests: the same shape app/dev/gas.js records, so e2e reads /dev/mail unchanged. */
function testMailRow(m) {
  const at = new Date().toISOString();
  if (m.via === 'mail') return Object.assign({ at }, m.msg);
  return Object.assign({ at, to: m.to, subject: m.subject, body: m.body, via: 'gmail' }, m.opts);
}

module.exports = { Runtime };
