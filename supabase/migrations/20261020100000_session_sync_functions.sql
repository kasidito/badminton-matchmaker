-- Saves the whole state of one open session in a single transaction.
-- security invoker: runs as the signed-in user, so row level security (admins only) still applies.
-- p_players: every club player [{id, level, start_mmr, career_games, in_session, active, base}]
-- p_matches: [{seq, court, mode, a:[id,id], b:[id,id], w, started_at, ended_at, players:[{id,team,won,before,after}]}]
-- p_adjustments: [{id, at, to}]
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
    insert into public.matches (session_id, seq, court, mode, team_a, team_b, winner, started_at, ended_at)
    values (
      p_session_id,
      (m->>'seq')::integer,
      (m->>'court')::integer,
      coalesce(m->>'mode', 'normal'),
      array[(m->'a'->>0)::bigint, (m->'a'->>1)::bigint],
      array[(m->'b'->>0)::bigint, (m->'b'->>1)::bigint],
      (m->>'w')::smallint,
      (m->>'started_at')::timestamptz,
      coalesce((m->>'ended_at')::timestamptz, now())
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

-- Closes a session after its final sync, dates it today (Bangkok) and stores the MMR each player carries forward.
-- p_players: [{id, start_mmr, career_games}]
create or replace function public.close_session(p_session_id bigint, p_players jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.players p
     set start_mmr = (r->>'start_mmr')::integer,
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

revoke all on function public.sync_session(bigint, jsonb, text[], integer, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.close_session(bigint, jsonb) from public, anon;
grant execute on function public.sync_session(bigint, jsonb, text[], integer, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.close_session(bigint, jsonb) to authenticated;

-- Only one open session at a time.
create unique index sessions_one_open on public.sessions ((status)) where status = 'open';
