alter table public.pools
add column if not exists image_url text;

create or replace function public.admin_update_pool_image(
  p_pool_id uuid,
  p_image_url text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  update public.pools
  set image_url = nullif(trim(p_image_url), '')
  where id = p_pool_id;
end;
$function$;
