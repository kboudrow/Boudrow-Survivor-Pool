-- A changed result invalidates survival credits at and after that week. The
-- authoritative rebuild then deterministically recreates any still warranted.
create or replace function public.clear_survival_grace_with_result()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_pool_id uuid;
  v_week integer;
begin
  if tg_op = 'INSERT' then
    if new.result is null then return new; end if;
    v_pool_id := new.pool_id; v_week := new.week;
  elsif tg_op = 'UPDATE' then
    if old.result is not distinct from new.result then return new; end if;
    v_pool_id := new.pool_id; v_week := least(old.week, new.week);
  else
    v_pool_id := old.pool_id; v_week := old.week;
  end if;

  delete from public.pool_entry_survival_graces g
  where g.pool_id = v_pool_id and g.week >= v_week;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

drop trigger if exists trg_clear_survival_grace_with_result on public.pool_picks;
create trigger trg_clear_survival_grace_with_result
after insert or update of result or delete on public.pool_picks
for each row execute function public.clear_survival_grace_with_result();

revoke execute on function public.clear_survival_grace_with_result() from public, anon, authenticated;
grant execute on function public.clear_survival_grace_with_result() to service_role;

-- Embed the per-week credit ledger in each stat JSON object without changing
-- the RPC return signature.
create or replace function public.pool_standings_snapshot(p_pool_id uuid, p_week integer)
returns table (games jsonb, stats jsonb, visible_picks jsonb, history_picks jsonb, completion jsonb)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_pool public.pools%rowtype;
  v_can_manage boolean := false;
begin
  if auth.uid() is null then raise exception 'Please sign in to view standings.'; end if;
  select * into v_pool from public.pools p where p.id = p_pool_id;
  if not found then raise exception 'Pool not found.'; end if;
  select public.admin_can_manage(p_pool_id) into v_can_manage;
  if not v_can_manage and not exists (
    select 1 from public.pool_members pm where pm.pool_id = p_pool_id and pm.profile_id = auth.uid()
  ) then raise exception 'not authorized'; end if;

  perform public.restore_unlocked_picks_for_pool(p_pool_id);

  return query
  with game_rows as (
    select * from public.pool_week_games(p_pool_id, p_week)
  ), stat_rows as (
    select s.pool_id, s.user_id, s.entry_id, s.wins, s.losses, s.pushes,
      s.strikes_used, s.eliminated, s.eliminated_week,
      coalesce((
        select jsonb_agg(jsonb_build_object('week', g.week, 'strike_credits', g.strike_credits) order by g.week)
        from public.pool_entry_survival_graces g
        where g.pool_id = s.pool_id and g.entry_id = s.entry_id
      ), '[]'::jsonb) as survival_graces
    from public.pool_member_stats s where s.pool_id = p_pool_id
  ), visible_rows as (
    select * from public.pool_visible_picks(p_pool_id, p_week, false)
  ), history_rows as (
    select * from public.pool_visible_picks(p_pool_id, p_week, true)
  ), completion_row as (
    select * from public.pool_week_pick_completion(p_pool_id, p_week) limit 1
  )
  select
    (select coalesce(jsonb_agg(to_jsonb(gr) order by coalesce(gr.kickoff_at_utc, gr.game_time), gr.away_team, gr.home_team), '[]'::jsonb) from game_rows gr),
    (select coalesce(jsonb_agg(to_jsonb(sr) order by sr.entry_id), '[]'::jsonb) from stat_rows sr),
    (select coalesce(jsonb_agg(to_jsonb(vr) order by vr.entry_id, vr.week, vr.slot), '[]'::jsonb) from visible_rows vr),
    (select coalesce(jsonb_agg(to_jsonb(hr) order by hr.entry_id, hr.week, hr.slot), '[]'::jsonb) from history_rows hr),
    (select to_jsonb(cr) from completion_row cr);
end;
$function$;

revoke execute on function public.pool_standings_snapshot(uuid, integer) from public, anon;
grant execute on function public.pool_standings_snapshot(uuid, integer) to authenticated, service_role;
