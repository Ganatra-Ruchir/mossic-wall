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
drop policy if exists "public can read live events" on public.events;
create policy "public can read live events" on public.events for select using(status='live' or id::text='demo');
drop policy if exists "public can read approved submissions" on public.submissions;
create policy "public can read approved submissions" on public.submissions for select using(status='approved');
insert into storage.buckets(id,name,public) values ('event-targets','event-targets',true) on conflict(id) do nothing;
insert into storage.buckets(id,name,public) values ('submissions','submissions',true) on conflict(id) do nothing;
insert into storage.buckets(id,name,public) values ('thumbnails','thumbnails',true) on conflict(id) do nothing;

-- Tile allocation: serialised per event so concurrent approvals never share a tile.
create or replace function public.approve_submission(p_id uuid) returns public.submissions language plpgsql security definer set search_path=public as $$
declare s public.submissions; e public.events; idx integer;
begin
 select * into s from public.submissions where id=p_id for update;
 if not found then raise exception 'Submission not found'; end if;
 if s.status='approved' and s.tile_index is not null then return s; end if;
 select * into e from public.events where id=s.event_id for update;
 select g into idx from generate_series(0,e.total_slots-1) g where not exists(select 1 from public.submissions x where x.event_id=e.id and x.tile_index=g) order by random() limit 1;
 update public.submissions set status='approved',approved_at=coalesce(approved_at,now()),tile_index=idx where id=p_id returning * into s;
 update public.events set approved_count=(select count(*) from public.submissions where event_id=e.id and status='approved' and tile_index is not null),updated_at=now() where id=e.id;
 return s;
end $$;
create or replace function public.reject_submission(p_id uuid) returns public.submissions language plpgsql security definer set search_path=public as $$
declare s public.submissions;
begin
 update public.submissions set status='rejected',tile_index=null where id=p_id returning * into s;
 if not found then raise exception 'Submission not found'; end if;
 update public.events set approved_count=(select count(*) from public.submissions where event_id=s.event_id and status='approved' and tile_index is not null),updated_at=now() where id=s.event_id;
 return s;
end $$;
revoke execute on function public.approve_submission(uuid) from public, anon, authenticated;
revoke execute on function public.reject_submission(uuid) from public, anon, authenticated;
grant execute on function public.approve_submission(uuid) to service_role;
grant execute on function public.reject_submission(uuid) to service_role;

-- Live wall updates.
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='submissions') then
  alter publication supabase_realtime add table public.submissions;
 end if;
end $$;
