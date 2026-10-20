do $$
declare
  owner uuid := 'f47ae5db-c3e3-41e3-a70a-5db90453da8c';
  b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  cid bigint; pid bigint; sid bigint; s1 bigint; n int; r text := '';
begin
  insert into auth.users (id, email) values (b, 'b@x'), (c, 'c@x');
  insert into public.sessions (club_id, title) values (1, 'club1 night') returning id into s1;

  perform set_config('request.jwt.claims', json_build_object('sub', owner)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.players; r := r || 'owner players=' || n;
  select count(*) into n from public.clubs; r := r || ', owner clubs=' || n;
  cid := public.create_club('RLS test club'); r := r || ', create_club ok';
  execute 'reset role';
  insert into public.club_admins (club_id, user_id) values (cid, b);
  delete from public.club_admins where club_id = cid and user_id = owner;

  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.players; r := r || E'\nB players=' || n;
  select count(*) into n from public.sessions; r := r || ', B sessions=' || n;
  select count(*) into n from public.clubs; r := r || ', B clubs=' || n;
  select count(*) into n from public.club_admins; r := r || ', B club_admins rows=' || n;
  begin insert into public.players (club_id, name) values (1, 'intruder'); r := r || ', B insert into club1=ALLOWED(BAD)';
  exception when others then r := r || ', B insert into club1=blocked'; end;
  insert into public.players (club_id, name) values (cid, 'ชิน') returning id into pid; r := r || ', B adds own ชิน=ok';
  insert into public.sessions (club_id, title) values (cid, 't') returning id into sid; r := r || ', B opens night=ok';
  insert into public.session_players (session_id, player_id) values (sid, pid); r := r || ', own player into night=ok';
  begin insert into public.session_players (session_id, player_id) values (sid, 1); r := r || ', B adds club1 player to own night=ALLOWED(BAD)';
  exception when others then r := r || ', B adds club1 player to own night=blocked'; end;
  begin insert into public.session_players (session_id, player_id) values (s1, pid); r := r || ', B writes into club1 night=ALLOWED(BAD)';
  exception when others then r := r || ', B writes into club1 night=blocked'; end;
  update public.players set name = 'hacked' where club_id = 1; get diagnostics n = row_count; r := r || ', B updates club1 players rows=' || n;
  update public.clubs set name = 'hacked' where id = 1; get diagnostics n = row_count; r := r || ', B renames club1 rows=' || n;
  delete from public.sessions where club_id = 1; get diagnostics n = row_count; r := r || ', B deletes club1 nights rows=' || n;
  begin perform public.sync_session(s1, '{}'::jsonb, array['normal'], 0, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb); r := r || ', B sync club1 night=ALLOWED(BAD)';
  exception when others then r := r || ', B sync club1 night=blocked(' || sqlstate || ')'; end;
  perform public.sync_session(sid, '{"v":4}'::jsonb, array['normal','social'], 2,
    jsonb_build_array(jsonb_build_object('id', pid, 'level','I','start_mmr',1500,'career_games',0,'in_session',true,'active',true,'base',0)), '[]'::jsonb, '[]'::jsonb);
  r := r || ', B sync own night=ok';
  begin insert into public.club_admins (club_id, user_id) values (cid, c); r := r || ', B self-manages club_admins=ALLOWED(BAD)';
  exception when others then r := r || ', B inserts club_admins directly=blocked'; end;
  perform public.create_club('B second club'); r := r || ', B create_club=ok';
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', c)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.players; r := r || E'\nC(no club) players=' || n;
  select count(*) into n from public.clubs; r := r || ', C clubs=' || n;
  begin perform public.create_club('nope'); r := r || ', C create_club=ALLOWED(BAD)';
  exception when others then r := r || ', C create_club=blocked'; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  begin select count(*) into n from public.players; r := r || E'\nanon players=' || n;
  exception when others then r := r || E'\nanon players=denied'; end;
  begin perform public.create_club('x'); r := r || ', anon create_club=ALLOWED(BAD)';
  exception when others then r := r || ', anon create_club=denied'; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', owner)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.players; r := r || E'\nowner after: players=' || n;
  select count(*) into n from public.clubs; r := r || ', clubs=' || n || ' (owner left the test club)';
  begin insert into public.sessions (club_id, title) values (1, 'second open'); r := r || ', second open night in club1=ALLOWED(BAD)';
  exception when unique_violation then r := r || ', second open night in club1=blocked'; end;
  begin insert into public.players (club_id, name) values (1, 'ชิน'); r := r || ', duplicate name in club1=ALLOWED(BAD)';
  exception when unique_violation then r := r || ', duplicate name in club1=blocked'; end;
  execute 'reset role';
  select count(*) into n from public.players where name = 'hacked'; r := r || E'\nrenamed by B=' || n;
  select count(*) into n from public.sessions where club_id = 1; r := r || ', club1 nights left=' || n;
  raise exception 'RESULT %', r;
end $$;
