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

/** Live: Supabase through its transaction pooler (so no prepared statements, and each job pins one connection). */
function postgresAdapter({ url, password }) {
  const postgres = require('postgres');
  const sql = postgres(url, { password, max: 4, prepare: false, idle_timeout: 20, connect_timeout: 15, onnotice: () => {} });
  return {
    sql,
    async begin() {
      const c = await sql.reserve();
      await c.unsafe('begin');
      return {
        q: (text, params) => c.unsafe(text, params || []),
        commit: () => c.unsafe('commit'),
        rollback: () => c.unsafe('rollback'),
        cycle: async () => { await c.unsafe('commit'); await c.unsafe('begin'); },
        release: () => c.release(),
      };
    },
    async migrate() { await sql.unsafe(SCHEMA); },
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
