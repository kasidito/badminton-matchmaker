-- 22 Oct 2026: errors from admins' devices, so problems can be found without screenshots.
-- No player names or personal data: the app sends only a short message, a stack trace, the tab, the app version
-- and the device type. Admins can add rows for their own clubs and read their clubs' rows; nobody can change or
-- delete them from the app (the owner reads them in the dashboard or SQL editor).
create table if not exists public.client_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  club_id bigint references public.clubs (id) on delete cascade,
  user_id uuid default auth.uid(),
  kind text not null check (kind in ('error', 'rejection', 'sync', 'report')),
  message text not null check (length(message) <= 500),
  detail text check (length(detail) <= 4000),
  tab text check (length(tab) <= 20),
  app_version text check (length(app_version) <= 20),
  device text check (length(device) <= 300)
);
create index if not exists client_logs_created_idx on public.client_logs (created_at desc);
create index if not exists client_logs_club_idx on public.client_logs (club_id);

alter table public.client_logs enable row level security;
drop policy if exists "admins add logs" on public.client_logs;
create policy "admins add logs" on public.client_logs for insert to authenticated
  with check (user_id = (select auth.uid()) and (club_id is null or club_id in (select private.my_clubs())));
drop policy if exists "admins read club logs" on public.client_logs;
create policy "admins read club logs" on public.client_logs for select to authenticated
  using (club_id in (select private.my_clubs()));
grant select, insert on public.client_logs to authenticated;
