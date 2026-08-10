alter function public.save_entry_draft_pick(uuid, uuid, integer, integer, text)
  rename to save_entry_draft_pick_unserialized;

create function public.save_entry_draft_pick(
  p_pool_id uuid,
  p_entry_id uuid,
  p_week integer,
  p_slot integer,
  p_team_abbr text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_pool_id::text || ':' || p_entry_id::text, 0));
  perform public.save_entry_draft_pick_unserialized(p_pool_id, p_entry_id, p_week, p_slot, p_team_abbr);
end;
$function$;

revoke execute on function public.save_entry_draft_pick_unserialized(uuid, uuid, integer, integer, text) from public, anon, authenticated;
revoke execute on function public.save_entry_draft_pick(uuid, uuid, integer, integer, text) from public, anon;
grant execute on function public.save_entry_draft_pick(uuid, uuid, integer, integer, text) to authenticated, service_role;

alter function public.clear_entry_draft_pick(uuid, uuid, integer, integer)
  rename to clear_entry_draft_pick_unserialized;

create function public.clear_entry_draft_pick(
  p_pool_id uuid,
  p_entry_id uuid,
  p_week integer,
  p_slot integer
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_pool_id::text || ':' || p_entry_id::text, 0));
  perform public.clear_entry_draft_pick_unserialized(p_pool_id, p_entry_id, p_week, p_slot);
end;
$function$;

revoke execute on function public.clear_entry_draft_pick_unserialized(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.clear_entry_draft_pick(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.clear_entry_draft_pick(uuid, uuid, integer, integer) to authenticated, service_role;
