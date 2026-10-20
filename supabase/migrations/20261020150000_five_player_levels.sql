-- Applied to project vhvlhuimelqsnglhayxs on 2026-10-20.
-- Five starting levels: B เพิ่งเริ่ม 1200, N มือใหม่ 1350, I กลาง 1500, A เก่ง 1650, P โหด 1800.
alter table public.players drop constraint if exists players_level_check;
alter table public.players add constraint players_level_check check (level in ('B','N','I','A','P'));
