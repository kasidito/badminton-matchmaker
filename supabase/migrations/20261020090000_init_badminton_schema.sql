-- Applied to project vhvlhuimelqsnglhayxs on 2026-10-20.
-- Admin allow-list: only users listed here can read or write anything.
create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create table public.players (
  id bigint generated always as identity primary key,
  name text not null,
  level text not null default 'I' check (level in ('N','I','A')),
  start_mmr integer not null default 1500,
  career_games integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index players_name_key on public.players (lower(name));

create table public.sessions (
  id bigint generated always as identity primary key,
  title text not null,
  played_on date not null default (now() at time zone 'Asia/Bangkok')::date,
  court_count integer not null default 3 check (court_count between 1 and 10),
  court_modes text[] not null default array['normal','normal','normal'],
  flex integer not null default 4,
  status text not null default 'open' check (status in ('open','closed')),
  state jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  sheet_exported_at timestamptz,
  updated_at timestamptz not null default now()
);
create index sessions_played_on_idx on public.sessions (played_on desc);

create table public.session_players (
  session_id bigint not null references public.sessions(id) on delete cascade,
  player_id bigint not null references public.players(id) on delete restrict,
  base integer not null default 0,
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (session_id, player_id)
);
create index session_players_player_idx on public.session_players (player_id);

create table public.matches (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.sessions(id) on delete cascade,
  seq integer not null,
  court integer not null,
  mode text not null default 'normal' check (mode in ('normal','competitive','social')),
  team_a bigint[] not null check (cardinality(team_a) = 2),
  team_b bigint[] not null check (cardinality(team_b) = 2),
  winner smallint not null check (winner in (0,1)),
  started_at timestamptz,
  ended_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (session_id, seq)
);

create table public.match_players (
  match_id bigint not null references public.matches(id) on delete cascade,
  player_id bigint not null references public.players(id) on delete restrict,
  team smallint not null check (team in (0,1)),
  won boolean not null,
  rating_before numeric(7,2),
  rating_after numeric(7,2),
  primary key (match_id, player_id)
);
create index match_players_player_idx on public.match_players (player_id);

create table public.rating_adjustments (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.sessions(id) on delete cascade,
  player_id bigint not null references public.players(id) on delete cascade,
  at_seq integer not null,
  to_mmr integer not null,
  created_at timestamptz not null default now()
);
create index rating_adjustments_session_idx on public.rating_adjustments (session_id);
create index rating_adjustments_player_idx on public.rating_adjustments (player_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
create trigger players_touch before update on public.players for each row execute function public.touch_updated_at();
create trigger sessions_touch before update on public.sessions for each row execute function public.touch_updated_at();

alter table public.admins enable row level security;
alter table public.players enable row level security;
alter table public.sessions enable row level security;
alter table public.session_players enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.rating_adjustments enable row level security;

create policy "admins read own row" on public.admins for select to authenticated using (user_id = (select auth.uid()));
create policy "admin all" on public.players for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin all" on public.sessions for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin all" on public.session_players for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin all" on public.matches for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin all" on public.match_players for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin all" on public.rating_adjustments for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create view public.player_totals with (security_invoker = true) as
select p.id, p.name, p.level, p.start_mmr,
       count(mp.match_id) as matches,
       count(*) filter (where mp.won) as wins,
       count(distinct m.session_id) as sessions
from public.players p
left join public.match_players mp on mp.player_id = p.id
left join public.matches m on m.id = mp.match_id
group by p.id;

insert into public.players (name) values
 ('ชิน'),('โฟล์ค'),('เดือน'),('นัทซ้าย'),('เปตอง'),('ป๊อป'),('Ard'),('ภู'),('กร'),('ตรัย'),('บีม'),('Yiip'),('ตั้ง');
