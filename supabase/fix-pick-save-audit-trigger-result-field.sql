-- Fix draft pick saves failing with:
-- "record new has no field result"
--
-- The audit trigger runs on both pool_pick_drafts and pool_picks. Only
-- pool_picks has a result column, so the trigger must not read new.result or
-- old.result while handling pool_pick_drafts rows.

create or replace function public.log_pick_save_event()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  event_action text;
  event_pool_id uuid;
  event_user_id uuid;
  event_week integer;
  event_slot integer;
  event_old_team text;
  event_new_team text;
  event_result text;
begin
  if tg_table_name = 'pool_pick_drafts' then
    if tg_op = 'INSERT' then
      event_action := 'draft_saved';
    elsif tg_op = 'UPDATE' then
      if old.team_abbr is distinct from new.team_abbr then
        event_action := 'draft_saved';
      else
        return new;
      end if;
    elsif tg_op = 'DELETE' then
      event_action := 'draft_cleared';
    end if;
  elsif tg_table_name = 'pool_picks' then
    if tg_op = 'INSERT' then
      event_action := 'pick_locked';
    elsif tg_op = 'UPDATE' then
      if old.team_abbr is distinct from new.team_abbr or old.result is distinct from new.result then
        event_action := 'pick_changed';
      else
        return new;
      end if;
    elsif tg_op = 'DELETE' then
      event_action := 'pick_deleted';
    end if;
  end if;

  if tg_op = 'DELETE' then
    event_pool_id := old.pool_id;
    event_user_id := old.user_id;
    event_week := old.week;
    event_slot := old.slot;
    event_old_team := old.team_abbr;
    event_new_team := null;
  elsif tg_op = 'INSERT' then
    event_pool_id := new.pool_id;
    event_user_id := new.user_id;
    event_week := new.week;
    event_slot := new.slot;
    event_old_team := null;
    event_new_team := new.team_abbr;
  else
    event_pool_id := new.pool_id;
    event_user_id := new.user_id;
    event_week := new.week;
    event_slot := new.slot;
    event_old_team := old.team_abbr;
    event_new_team := new.team_abbr;
  end if;

  if tg_table_name = 'pool_picks' then
    if tg_op = 'DELETE' then
      event_result := old.result;
    else
      event_result := new.result;
    end if;
  else
    event_result := null;
  end if;

  insert into public.pick_save_events (
    pool_id,
    user_id,
    actor_user_id,
    source_table,
    action,
    week,
    slot,
    old_team_abbr,
    new_team_abbr,
    result
  )
  values (
    event_pool_id,
    event_user_id,
    auth.uid(),
    tg_table_name,
    event_action,
    event_week,
    coalesce(event_slot, 1),
    event_old_team,
    event_new_team,
    event_result
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;
