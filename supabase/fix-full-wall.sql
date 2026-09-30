-- Run this once in the Supabase SQL Editor (safe to re-run).
-- Fixes: when the wall is full, approved photos had no tile and never appeared,
-- and removing a photo left a permanent hole instead of letting a waiting photo in.

-- Two photos can never hold the same tile.
create unique index if not exists submissions_event_tile_unique
  on public.submissions(event_id, tile_index) where tile_index is not null;

-- Approving: take a free tile if there is one, otherwise stay approved and wait (tile_index null).
create or replace function public.approve_submission(p_id uuid) returns public.submissions language plpgsql security definer set search_path=public as $$
declare s public.submissions; e public.events; idx integer;
begin
 select * into s from public.submissions where id=p_id for update;
 if not found then raise exception 'Submission not found'; end if;
 if s.status='approved' and s.tile_index is not null then return s; end if;
 select * into e from public.events where id=s.event_id for update;
 select g into idx from generate_series(0,e.total_slots-1) g
  where not exists(select 1 from public.submissions x where x.event_id=e.id and x.tile_index=g)
  order by random() limit 1;
 update public.submissions set status='approved',approved_at=coalesce(approved_at,now()),tile_index=idx where id=p_id returning * into s;
 update public.events set approved_count=(select count(*) from public.submissions where event_id=e.id and status='approved' and tile_index is not null),updated_at=now() where id=e.id;
 return s;
end $$;

-- Rejecting/removing: free the tile and hand it to the photo that has waited longest.
create or replace function public.reject_submission(p_id uuid) returns public.submissions language plpgsql security definer set search_path=public as $$
declare s public.submissions; freed integer; nxt uuid;
begin
 select * into s from public.submissions where id=p_id for update;
 if not found then raise exception 'Submission not found'; end if;
 perform 1 from public.events where id=s.event_id for update;
 freed := s.tile_index;
 update public.submissions set status='rejected',tile_index=null where id=p_id returning * into s;
 if freed is not null then
  select id into nxt from public.submissions
   where event_id=s.event_id and status='approved' and tile_index is null
   order by approved_at nulls last, created_at limit 1 for update skip locked;
  if nxt is not null then update public.submissions set tile_index=freed where id=nxt; end if;
 end if;
 update public.events set approved_count=(select count(*) from public.submissions where event_id=s.event_id and status='approved' and tile_index is not null),updated_at=now() where id=s.event_id;
 return s;
end $$;

revoke execute on function public.approve_submission(uuid) from public, anon, authenticated;
revoke execute on function public.reject_submission(uuid) from public, anon, authenticated;
grant execute on function public.approve_submission(uuid) to service_role;
grant execute on function public.reject_submission(uuid) to service_role;
