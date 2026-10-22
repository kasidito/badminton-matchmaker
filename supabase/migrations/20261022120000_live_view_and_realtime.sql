-- 22 Oct 2026: (1) a read-only "live" view of tonight for players, opened by a per-night secret link (QR),
-- and (2) realtime updates of the night between admin devices.

-- (1) players' view. The admin app writes a small, already-trimmed picture of tonight into sessions.live
-- (courts, next four, queue: first names, games, bird; no MMR, no history) and a random share_token.
alter table public.sessions add column if not exists live jsonb;
alter table public.sessions add column if not exists share_token text;
create unique index if not exists sessions_share_token_key on public.sessions (share_token) where share_token is not null;

-- Anyone holding the token may read that one open night's live picture, nothing else.
create or replace function public.live_night(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('club', c.name, 'title', s.title, 'live', s.live, 'updated_at', s.updated_at)
  from public.sessions s
  join public.clubs c on c.id = s.club_id
  where p_token is not null
    and length(p_token) >= 16
    and s.share_token = p_token
    and s.status = 'open'
  limit 1
$$;
revoke all on function public.live_night(text) from public;
grant execute on function public.live_night(text) to anon, authenticated;

-- (2) admin devices of the same club follow each other's changes. Realtime applies the sessions RLS policy
-- ("club nights"), so a device only hears about its own clubs' nights. Skipped where the publication is missing
-- (local test databases).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sessions') then
    alter publication supabase_realtime add table public.sessions;
  end if;
end $$;
