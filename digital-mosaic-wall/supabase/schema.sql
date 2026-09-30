create extension if not exists pgcrypto;
create table if not exists public.events(
 id uuid primary key default gen_random_uuid(), name text not null, description text default '', target_image_url text, rows integer not null default 25 check(rows between 2 and 100), columns integer not null default 30 check(columns between 2 and 100), total_slots integer generated always as (rows*columns) stored, approved_count integer not null default 0, status text not null default 'draft' check(status in ('draft','live','ended')), auto_approve boolean not null default false, final_message text not null default 'WE DID IT TOGETHER', animation_speed numeric not null default 1, background text not null default '#08090b', accent_color text not null default '#d8ff3e', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.submissions(
 id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id) on delete cascade, image_url text not null, thumbnail_url text not null, name text, message text, status text not null default 'pending' check(status in ('pending','approved','rejected')), tile_index integer, created_at timestamptz not null default now(), approved_at timestamptz
);
create index if not exists submissions_event_status_idx on public.submissions(event_id,status,created_at desc);
create index if not exists submissions_event_tile_idx on public.submissions(event_id,tile_index);
alter table public.events enable row level security; alter table public.submissions enable row level security;
create policy "public can read live events" on public.events for select using(status='live' or id::text='demo');
create policy "public can read approved submissions" on public.submissions for select using(status='approved');
insert into storage.buckets(id,name,public) values ('event-targets','event-targets',true) on conflict(id) do nothing;
insert into storage.buckets(id,name,public) values ('submissions','submissions',true) on conflict(id) do nothing;
insert into storage.buckets(id,name,public) values ('thumbnails','thumbnails',true) on conflict(id) do nothing;
