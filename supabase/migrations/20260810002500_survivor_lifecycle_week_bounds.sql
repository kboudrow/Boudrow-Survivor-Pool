begin;

alter table public.pool_member_stats
  drop constraint if exists pool_member_stats_nonnegative_check,
  add constraint pool_member_stats_nonnegative_check check (
    wins >= 0 and losses >= 0 and pushes >= 0 and strikes_used >= 0
    and strikes_used = losses
  );

create or replace function public.guard_entry_elimination_week()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_start_week integer;
  v_max_week integer;
begin
  if new.eliminated_week is null then return new; end if;
  select p.start_week, case when p.include_playoffs then 22 else 18 end
  into v_start_week, v_max_week
  from public.pools p where p.id = new.pool_id;
  if not found then raise exception 'Pool not found.'; end if;
  if new.eliminated_week < v_start_week or new.eliminated_week > v_max_week then
    raise exception 'Elimination week is outside this pool''s playable season.';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_entry_elimination_week on public.pool_members;
create trigger trg_guard_entry_elimination_week
before insert or update on public.pool_members
for each row execute function public.guard_entry_elimination_week();

drop trigger if exists trg_guard_stats_elimination_week on public.pool_member_stats;
create trigger trg_guard_stats_elimination_week
before insert or update on public.pool_member_stats
for each row execute function public.guard_entry_elimination_week();

create or replace function public.guard_survival_grace_week()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_start_week integer;
  v_max_week integer;
begin
  select p.start_week, case when p.include_playoffs then 22 else 18 end
  into v_start_week, v_max_week
  from public.pools p where p.id = new.pool_id;
  if not found then raise exception 'Pool not found.'; end if;
  if new.week < v_start_week or new.week > v_max_week then
    raise exception 'Survival grace week is outside this pool''s playable season.';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_survival_grace_week on public.pool_entry_survival_graces;
create trigger trg_guard_survival_grace_week
before insert or update on public.pool_entry_survival_graces
for each row execute function public.guard_survival_grace_week();

revoke execute on function public.guard_entry_elimination_week() from public, anon, authenticated;
revoke execute on function public.guard_survival_grace_week() from public, anon, authenticated;
grant execute on function public.guard_entry_elimination_week() to service_role;
grant execute on function public.guard_survival_grace_week() to service_role;

commit;
