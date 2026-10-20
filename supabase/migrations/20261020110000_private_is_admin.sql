-- Moves the admin check out of the public API schema (fixes Supabase security advisor lint 0029).
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['players','sessions','session_players','matches','match_players','rating_adjustments'] loop
    execute format('drop policy "admin all" on public.%I', t);
    execute format('create policy "admin all" on public.%I for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))', t);
  end loop;
end $$;

drop function public.is_admin();
