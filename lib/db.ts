// Postgres (Neon via Vercel) data layer. The connection string is added to the
// project automatically when the Neon database is connected in Vercel → Storage.
// Tables and functions are created on first use, so there is no SQL to run by hand.
import {Pool, type QueryResultRow} from 'pg';

export function databaseUrl(): string | null {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_URL || null;
}

declare global {
  // Reuse one pool per server instance (and across hot reloads in dev).
  var __mosaicPool: Pool | undefined;
  var __mosaicSchema: Promise<void> | undefined;
}

function pool(): Pool {
  const url = databaseUrl();
  if (!url) throw new Error('DATABASE_URL is not set. In Vercel, connect a Neon database to this project (Storage → Connect).');
  if (!globalThis.__mosaicPool) {
    const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);
    globalThis.__mosaicPool = new Pool({
      connectionString: url,
      ssl: local ? undefined : {rejectUnauthorized: false},
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return globalThis.__mosaicPool;
}

const SCHEMA = `
create extension if not exists pgcrypto;

create table if not exists events(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  target_image_url text,
  rows integer not null default 25 check(rows between 2 and 100),
  columns integer not null default 30 check(columns between 2 and 100),
  total_slots integer generated always as (rows*columns) stored,
  approved_count integer not null default 0,
  status text not null default 'draft' check(status in ('draft','live','ended')),
  auto_approve boolean not null default false,
  final_message text not null default 'WE DID IT TOGETHER',
  animation_speed numeric not null default 1,
  background text not null default '#08090b',
  accent_color text not null default '#d8ff3e',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists submissions(
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  image_url text not null,
  thumbnail_url text not null,
  name text,
  message text,
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  tile_index integer,
  created_at timestamptz not null default now(),
  approved_at timestamptz
);
create index if not exists submissions_event_status_idx on submissions(event_id,status,created_at desc);
create unique index if not exists submissions_event_tile_unique on submissions(event_id,tile_index) where tile_index is not null;

-- Photos live in the database too (JPEG bytes), served by /api/img/<id>.
create table if not exists images(
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  content_type text not null default 'image/jpeg',
  data bytea not null,
  created_at timestamptz not null default now()
);

create table if not exists app_settings(key text primary key, value text not null);

-- Photos needed before the wall turns into the big picture.
alter table events add column if not exists goal integer not null default 150;
-- Screen edge new photos fly in from on the wall: random | left | right | top | bottom.
alter table events add column if not exists fly_from text not null default 'random';

-- Approving: take a random free tile if there is one, otherwise stay approved and wait (tile_index null).
create or replace function approve_submission(p_id uuid) returns submissions language plpgsql as $$
declare s submissions; e events; idx integer;
begin
 select * into s from submissions where id=p_id for update;
 if not found then raise exception 'Submission not found'; end if;
 if s.status='approved' and s.tile_index is not null then return s; end if;
 select * into e from events where id=s.event_id for update;
 select g into idx from generate_series(0,e.total_slots-1) g
  where not exists(select 1 from submissions x where x.event_id=e.id and x.tile_index=g)
  order by random() limit 1;
 update submissions set status='approved',approved_at=coalesce(approved_at,now()),tile_index=idx where id=p_id returning * into s;
 update events set approved_count=(select count(*) from submissions where event_id=e.id and status='approved' and tile_index is not null),updated_at=now() where id=e.id;
 return s;
end $$;

-- Rejecting/removing: free the tile and hand it to the photo that has waited longest.
create or replace function reject_submission(p_id uuid) returns submissions language plpgsql as $$
declare s submissions; freed integer; nxt uuid;
begin
 select * into s from submissions where id=p_id for update;
 if not found then raise exception 'Submission not found'; end if;
 perform 1 from events where id=s.event_id for update;
 freed := s.tile_index;
 update submissions set status='rejected',tile_index=null where id=p_id returning * into s;
 if freed is not null then
  select id into nxt from submissions
   where event_id=s.event_id and status='approved' and tile_index is null
   order by approved_at nulls last, created_at limit 1 for update skip locked;
  if nxt is not null then update submissions set tile_index=freed where id=nxt; end if;
 end if;
 update events set approved_count=(select count(*) from submissions where event_id=s.event_id and status='approved' and tile_index is not null),updated_at=now() where id=s.event_id;
 return s;
end $$;

-- Delete forever: free the tile (a waiting photo takes it), remove the image files, then the record.
create or replace function delete_submission(p_id uuid) returns void language plpgsql as $$
declare s submissions;
begin
 select * into s from submissions where id=p_id;
 if not found then return; end if;
 if s.status='approved' then perform reject_submission(p_id); end if;
 delete from images where id in (
   (substring(s.image_url from '/api/img/([0-9a-f-]{36})'))::uuid,
   (substring(s.thumbnail_url from '/api/img/([0-9a-f-]{36})'))::uuid);
 delete from submissions where id=p_id;
end $$;

-- Delete every guest photo of an event (keeps the target image and settings).
create or replace function clear_event_photos(p_event uuid) returns integer language plpgsql as $$
declare n integer;
begin
 perform 1 from events where id=p_event for update;
 delete from images where id in (
   select (substring(image_url from '/api/img/([0-9a-f-]{36})'))::uuid from submissions where event_id=p_event
   union all
   select (substring(thumbnail_url from '/api/img/([0-9a-f-]{36})'))::uuid from submissions where event_id=p_event);
 delete from submissions where event_id=p_event;
 get diagnostics n = row_count;
 update events set approved_count=0,updated_at=now() where id=p_event;
 return n;
end $$;
`;

async function migrate() {
  const c = await pool().connect();
  try {
    // One migrator at a time across concurrent cold starts.
    await c.query('select pg_advisory_lock(7212025)');
    await c.query(SCHEMA);
    // First run: a ready-to-use live event, so /wall and /upload work immediately.
    await c.query(`insert into events(name,status,auto_approve)
      select 'Digital Mosaic Wall','live',true where not exists(select 1 from events)`);
    await c.query(`insert into app_settings(key,value) values('session_secret',encode(gen_random_bytes(32),'hex'))
      on conflict(key) do nothing`);
  } finally {
    await c.query('select pg_advisory_unlock(7212025)').catch(() => {});
    c.release();
  }
}

export function ensureSchema(): Promise<void> {
  if (!globalThis.__mosaicSchema) {
    globalThis.__mosaicSchema = migrate().catch((e) => {
      globalThis.__mosaicSchema = undefined; // retry on the next request
      throw e;
    });
  }
  return globalThis.__mosaicSchema;
}

/** Parameterised query; the schema is created first if needed. */
export async function q<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  await ensureSchema();
  const r = await pool().query<T>(text, params);
  return r.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
  return (await q<T>(text, params))[0] ?? null;
}

export async function getSetting(key: string): Promise<string | null> {
  return (await one<{value: string}>('select value from app_settings where key=$1', [key]))?.value ?? null;
}

export async function saveImage(eventId: string, data: Buffer): Promise<string> {
  const row = await one<{id: string}>('insert into images(event_id,data) values($1,$2) returning id', [eventId, data]);
  return `/api/img/${row!.id}`;
}
