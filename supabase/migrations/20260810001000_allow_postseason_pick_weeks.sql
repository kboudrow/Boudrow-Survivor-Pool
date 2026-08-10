alter table public.pool_pick_drafts
  drop constraint if exists pool_pick_drafts_week_check;
alter table public.pool_pick_drafts
  add constraint pool_pick_drafts_week_check check (week between 1 and 22);

alter table public.pool_picks
  drop constraint if exists pool_picks_week_check;
alter table public.pool_picks
  add constraint pool_picks_week_check check (week between 1 and 22);
