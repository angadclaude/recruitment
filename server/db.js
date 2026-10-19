// Database connections for server/runtime.js: Supabase Postgres when live, PGlite (Postgres in this process) for tests.
// Everything lives in its own schema `jl` in the shared Supabase project, next to the playbooks' schemas.
'use strict';

const SCHEMA = `
create schema if not exists jl;
create table if not exists jl.tabs (
  name text primary key,
  headers jsonb not null default '[]'::jsonb,
  max_rows integer not null default 1000,
  max_cols integer not null default 26,
  created_at timestamptz not null default now()
);
create sequence if not exists jl.row_pos;
create table if not exists jl.rows (
  rid bigserial primary key,
  tab text not null references jl.tabs (name) on delete cascade on update cascade,
  pos bigint not null default nextval('jl.row_pos'),
  vals jsonb not null default '[]'::jsonb
);
create index if not exists rows_tab_pos on jl.rows (tab, pos);
create table if not exists jl.props (key text primary key, val text not null);
create table if not exists jl.cache (key text primary key, val text not null, expires_at timestamptz not null);
create table if not exists jl.outbox (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  payload jsonb not null,
  sent_at timestamptz,
  tries integer not null default 0,
  error text
);
`;

/** Every job's transaction has limits, so one slow or stuck job can't freeze the others (they get "Trying again…" instead
 *  of a 60 s timeout): wait at most 8 s for a lock, 20 s for a query, and a transaction left idle (a server copy that
 *  was stopped mid-job) is ended by Postgres after 30 s, releasing its locks. */
const BEGIN = "begin; set local lock_timeout = '8s'; set local statement_timeout = '20s'; set local idle_in_transaction_session_timeout = '30s'";

/** A database step that gets no answer in time fails (and the app says "Trying again…") instead of waiting forever. */
function timed(p, ms, what) {
  let t;
  const late = new Promise((_, reject) => { t = setTimeout(() => reject(Object.assign(new Error('Service error: the database ' + what + ' took over ' + ms / 1000 + ' s'), { retry: true, stuck: true })), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(t));
}

/** Live: Supabase through its transaction pooler (so no prepared statements, and each job pins one connection).
 *  Vercel pauses a server copy between requests. A connection left open across a pause can be dead without either end
 *  knowing (the network drops it silently), and a query sent on it waits forever: pages hung for 25–60 s after a quiet
 *  spell, several at once (19 Oct). So connections unused for 20 s are replaced before use, and every step has a limit. */
function postgresAdapter({ url, password, limits }) {
  const postgres = require('postgres');
  const L = Object.assign({ idle: 20000, connect: 6000, query: 25000 }, limits);
  const make = () => postgres(url, { password, max: 4, prepare: false, idle_timeout: 20, connect_timeout: 15, onnotice: () => {} });
  let sql = make(), used = Date.now();
  // After a quiet spell the old connections are closed 5 minutes later (something still holding the old `sql`, like
  // the Sheet copy, keeps working); after a stuck step they're closed now (anything still running on them gets 5 s)
  const renew = stuck => {
    const old = sql, close = () => old.end({ timeout: 5 }).catch(() => {});
    sql = make();
    if (stuck) close(); else setTimeout(close, 300000).unref();
  };
  const pool = () => { if (Date.now() - used > L.idle) renew(false); used = Date.now(); return sql; };
  const step = (p, ms, what) => timed(p, ms, what).then(r => { used = Date.now(); return r; }, e => { if (e.stuck) renew(true); throw e; });
  return {
    get sql() { return pool(); },
    async begin() {
      let c;
      for (let attempt = 1; ; attempt++) {
        c = null;
        try {
          const reserving = pool().reserve();
          c = await step(reserving, L.connect, 'connection');
          await step(c.unsafe(BEGIN), L.connect, 'start');
          break;
        } catch (e) {
          if (c) c.release();
          if (attempt >= 2 || !e.stuck) throw e;  // a stuck connection: once more on a fresh one
        }
      }
      // After a stuck step this connection is written off: no rollback to wait for (closing it ends the transaction)
      let dead = false;
      const on = (p, ms, what) => step(p, ms, what).catch(e => { if (e.stuck) dead = true; throw e; });
      return {
        q: (text, params) => on(c.unsafe(text, params || []), L.query, 'query'),
        commit: () => on(c.unsafe('commit'), L.query, 'commit'),
        rollback: () => (dead ? Promise.resolve() : on(c.unsafe('rollback'), L.connect, 'rollback')),
        cycle: async () => { await on(c.unsafe('commit'), L.query, 'commit'); await on(c.unsafe(BEGIN), L.connect, 'start'); },
        release: () => c.release(),
      };
    },
    // Only when the tables aren't there yet. "create index if not exists" still locks jl.rows, and on a busy lunchtime
    // every new server copy queued that lock behind live saves, so everyone else queued behind it (19 Oct: requests
    // timing out at 60 s in waves). With a short lock limit too, so it can never hold others up.
    async migrate() {
      if ((await sql`select to_regclass('jl.outbox') as t`)[0].t) return;
      await sql.begin(async t => { await t.unsafe("set local lock_timeout = '5s'"); await t.unsafe(SCHEMA); });
    },
    end: () => sql.end({ timeout: 5 }),
  };
}

/** Tests / local: PGlite (one connection, so jobs already run one at a time). */
async function pgliteAdapter(dataDir) {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite(dataDir);
  await db.waitReady;
  return {
    db,
    async begin() {
      await db.exec('begin');
      return {
        q: async (text, params) => (await db.query(text, params || [])).rows,
        commit: () => db.exec('commit'),
        rollback: () => db.exec('rollback'),
        cycle: async () => { await db.exec('commit'); await db.exec('begin'); },
        release: () => {},
      };
    },
    async migrate() { await db.exec(SCHEMA); },
    end: () => db.close(),
  };
}

module.exports = { SCHEMA, postgresAdapter, pgliteAdapter };
