-- Applied to project vhvlhuimelqsnglhayxs on 2026-10-21.
-- OpenSkill uncertainty per player, remembered name spellings, and leaving / deleting a club.

alter table public.players add column if not exists start_sigma numeric;          -- null = new player (default uncertainty)
alter table public.players add column if not exists aliases text[] not null default '{}';

-- Closes a session after its final sync, dates it today (Bangkok) and stores the rating each player carries forward.
-- p_players: [{id, start_mmr, start_sigma, career_games}]
create or replace function public.close_session(p_session_id bigint, p_players jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.players p
     set start_mmr = (r->>'start_mmr')::integer,
         start_sigma = nullif(r->>'start_sigma', '')::numeric,
         career_games = (r->>'career_games')::integer
    from jsonb_array_elements(p_players) r
   where p.id = (r->>'id')::bigint;

  update public.sessions
     set status = 'closed',
         ended_at = now(),
         played_on = (now() at time zone 'Asia/Bangkok')::date,
         state = null
   where id = p_session_id and status = 'open';

  if not found then
    raise exception 'session % is not open', p_session_id using errcode = 'P0002';
  end if;
end;
$$;

-- Leave a club: not the last admin of it, and not the caller's only club (they would be locked out).
create or replace function public.leave_club(p_club_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if not exists (select 1 from public.club_admins where club_id = p_club_id and user_id = me) then
    raise exception 'not a club admin' using errcode = '42501';
  end if;
  if (select count(*) from public.club_admins where user_id = me) <= 1 then
    raise exception 'only_club' using errcode = 'P0001';
  end if;
  if (select count(*) from public.club_admins where club_id = p_club_id) <= 1 then
    raise exception 'last_admin' using errcode = 'P0001';
  end if;
  delete from public.club_admins where club_id = p_club_id and user_id = me;
end $$;

-- Delete a club with its nights and members. The caller types the club name; it cannot be their only club.
create or replace function public.delete_club(p_club_id bigint, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if not exists (select 1 from public.club_admins where club_id = p_club_id and user_id = me) then
    raise exception 'not a club admin' using errcode = '42501';
  end if;
  if (select count(*) from public.club_admins where user_id = me) <= 1 then
    raise exception 'only_club' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.clubs where id = p_club_id and name = btrim(coalesce(p_name, ''))) then
    raise exception 'name_mismatch' using errcode = 'P0001';
  end if;
  delete from public.sessions where club_id = p_club_id;      -- cascades to session_players, matches, match_players, rating_adjustments
  delete from public.players where club_id = p_club_id;
  delete from public.clubs where id = p_club_id;              -- cascades to club_admins
end $$;

revoke all on function public.leave_club(bigint) from public, anon;
revoke all on function public.delete_club(bigint, text) from public, anon;
grant execute on function public.leave_club(bigint) to authenticated;
grant execute on function public.delete_club(bigint, text) to authenticated;
