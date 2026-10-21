-- Applied to project vhvlhuimelqsnglhayxs on 2026-10-21.
-- Optional game score per match, and per-club pair rules ("always partners" / "never on the same court").

alter table public.matches add column if not exists score_a smallint check (score_a between 0 and 99);
alter table public.matches add column if not exists score_b smallint check (score_b between 0 and 99);

create table if not exists public.pair_rules (
  id bigint generated always as identity primary key,
  club_id bigint not null references public.clubs(id) on delete cascade,
  a bigint not null references public.players(id) on delete cascade,
  b bigint not null references public.players(id) on delete cascade,
  kind text not null check (kind in ('with', 'apart')),
  created_at timestamptz not null default now(),
  check (a <> b)
);
create unique index if not exists pair_rules_pair_key on public.pair_rules (club_id, least(a, b), greatest(a, b));
alter table public.pair_rules enable row level security;
create policy "club rules" on public.pair_rules for all to authenticated
  using (club_id in (select private.my_clubs()))
  with check (club_id in (select private.my_clubs()) and private.player_club(a) = club_id and private.player_club(b) = club_id);
grant select, insert, update, delete on public.pair_rules to authenticated;

-- sync_session now also stores the optional score (m.sc = [a, b]); everything else is unchanged.
create or replace function public.sync_session(
  p_session_id bigint,
  p_state jsonb,
  p_court_modes text[],
  p_flex integer,
  p_players jsonb,
  p_matches jsonb,
  p_adjustments jsonb
) returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  m jsonb;
  mid bigint;
begin
  if not exists (select 1 from public.sessions s where s.id = p_session_id and s.status = 'open') then
    raise exception 'session % is not open', p_session_id using errcode = 'P0002';
  end if;

  update public.sessions
     set state = p_state,
         court_count = cardinality(p_court_modes),
         court_modes = p_court_modes,
         flex = p_flex
   where id = p_session_id;

  update public.players p
     set level = r->>'level',
         start_mmr = (r->>'start_mmr')::integer,
         career_games = (r->>'career_games')::integer
    from jsonb_array_elements(p_players) r
   where p.id = (r->>'id')::bigint
     and (p.level, p.start_mmr, p.career_games)
         is distinct from (r->>'level', (r->>'start_mmr')::integer, (r->>'career_games')::integer);

  delete from public.session_players where session_id = p_session_id;
  insert into public.session_players (session_id, player_id, base, active)
  select p_session_id, (r->>'id')::bigint, coalesce((r->>'base')::integer, 0), coalesce((r->>'active')::boolean, false)
    from jsonb_array_elements(p_players) r
   where coalesce((r->>'in_session')::boolean, false);

  delete from public.matches where session_id = p_session_id;
  for m in select * from jsonb_array_elements(p_matches) loop
    insert into public.matches (session_id, seq, court, mode, team_a, team_b, winner, started_at, ended_at, score_a, score_b)
    values (
      p_session_id,
      (m->>'seq')::integer,
      (m->>'court')::integer,
      coalesce(m->>'mode', 'normal'),
      array[(m->'a'->>0)::bigint, (m->'a'->>1)::bigint],
      array[(m->'b'->>0)::bigint, (m->'b'->>1)::bigint],
      (m->>'w')::smallint,
      (m->>'started_at')::timestamptz,
      coalesce((m->>'ended_at')::timestamptz, now()),
      (m->'sc'->>0)::smallint,
      (m->'sc'->>1)::smallint
    )
    returning id into mid;

    insert into public.match_players (match_id, player_id, team, won, rating_before, rating_after)
    select mid, (x->>'id')::bigint, (x->>'team')::smallint, (x->>'won')::boolean,
           (x->>'before')::numeric, (x->>'after')::numeric
      from jsonb_array_elements(m->'players') x;
  end loop;

  delete from public.rating_adjustments where session_id = p_session_id;
  insert into public.rating_adjustments (session_id, player_id, at_seq, to_mmr)
  select p_session_id, (a->>'id')::bigint, (a->>'at')::integer, (a->>'to')::integer
    from jsonb_array_elements(p_adjustments) a;

  return now();
end;
$$;
