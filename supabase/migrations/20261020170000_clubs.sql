-- Applied to project vhvlhuimelqsnglhayxs on 2026-10-20.
-- Clubs (ก๊วน): every player and night belongs to one club, and admins are per club.
-- Replaces the global public.admins allow-list (its rows become admins of the first club) and the
-- never-applied 20261020110000_private_is_admin.sql (helper functions now live in schema private).

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.clubs (
  id bigint generated always as identity primary key,
  name text not null check (length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create table public.club_admins (
  club_id bigint not null references public.clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create index club_admins_user_idx on public.club_admins (user_id);

-- existing data becomes the first club, run by the existing admins
insert into public.clubs (name, created_by)
select 'ก๊วนแบด', (select user_id from public.admins order by created_at limit 1);
insert into public.club_admins (club_id, user_id)
select (select min(id) from public.clubs), user_id from public.admins;

alter table public.players add column club_id bigint references public.clubs(id) on delete cascade;
alter table public.sessions add column club_id bigint references public.clubs(id) on delete cascade;
update public.players set club_id = (select min(id) from public.clubs);
update public.sessions set club_id = (select min(id) from public.clubs);
alter table public.players alter column club_id set not null;
alter table public.sessions alter column club_id set not null;
create index players_club_idx on public.players (club_id);
create index sessions_club_idx on public.sessions (club_id);

drop index public.players_name_key;
create unique index players_club_name_key on public.players (club_id, lower(name));
drop index public.sessions_one_open;
create unique index sessions_one_open on public.sessions (club_id) where status = 'open';

-- helpers (security definer so policies can look across tables without recursion)
create or replace function private.my_clubs() returns setof bigint
language sql stable security definer set search_path = '' as $$
  select club_id from public.club_admins where user_id = (select auth.uid());
$$;
create or replace function private.session_club(sid bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  select club_id from public.sessions where id = sid;
$$;
create or replace function private.player_club(pid bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  select club_id from public.players where id = pid;
$$;
create or replace function private.match_club(mid bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  select s.club_id from public.matches m join public.sessions s on s.id = m.session_id where m.id = mid;
$$;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- policies: replace the global admin check with club membership
drop policy "admin all" on public.players;
drop policy "admin all" on public.sessions;
drop policy "admin all" on public.session_players;
drop policy "admin all" on public.matches;
drop policy "admin all" on public.match_players;
drop policy "admin all" on public.rating_adjustments;

alter table public.clubs enable row level security;
alter table public.club_admins enable row level security;

create policy "club admins read" on public.clubs for select to authenticated
  using (id in (select private.my_clubs()));
create policy "club admins rename" on public.clubs for update to authenticated
  using (id in (select private.my_clubs())) with check (id in (select private.my_clubs()));
create policy "co-admins read" on public.club_admins for select to authenticated
  using (club_id in (select private.my_clubs()));

create policy "club members" on public.players for all to authenticated
  using (club_id in (select private.my_clubs())) with check (club_id in (select private.my_clubs()));
create policy "club nights" on public.sessions for all to authenticated
  using (club_id in (select private.my_clubs())) with check (club_id in (select private.my_clubs()));
create policy "club nights" on public.session_players for all to authenticated
  using (private.session_club(session_id) in (select private.my_clubs()))
  with check (private.session_club(session_id) in (select private.my_clubs()) and private.player_club(player_id) = private.session_club(session_id));
create policy "club nights" on public.matches for all to authenticated
  using (private.session_club(session_id) in (select private.my_clubs()))
  with check (private.session_club(session_id) in (select private.my_clubs()));
create policy "club nights" on public.match_players for all to authenticated
  using (private.match_club(match_id) in (select private.my_clubs()))
  with check (private.match_club(match_id) in (select private.my_clubs()) and private.player_club(player_id) = private.match_club(match_id));
create policy "club nights" on public.rating_adjustments for all to authenticated
  using (private.session_club(session_id) in (select private.my_clubs()))
  with check (private.session_club(session_id) in (select private.my_clubs()) and private.player_club(player_id) = private.session_club(session_id));

grant select, update on public.clubs to authenticated;
grant select on public.club_admins to authenticated;

-- any club admin can start another club and becomes its first admin
create or replace function public.create_club(p_name text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare cid bigint;
begin
  if (select auth.uid()) is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from public.club_admins where user_id = (select auth.uid())) then
    raise exception 'only club admins can create clubs' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'name required' using errcode = '22023'; end if;
  insert into public.clubs (name, created_by) values (btrim(p_name), (select auth.uid())) returning id into cid;
  insert into public.club_admins (club_id, user_id) values (cid, (select auth.uid()));
  return cid;
end $$;
revoke all on function public.create_club(text) from public, anon;
grant execute on function public.create_club(text) to authenticated;

-- the old global allow-list is no longer used
drop policy "admins read own row" on public.admins;
drop function public.is_admin();
drop table public.admins;
