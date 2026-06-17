create or replace function public.prevent_active_pool_regression()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if old.activation_status = 'active' and new.activation_status = 'draft' then
    raise exception 'active leagues cannot be moved back to draft';
  end if;

  if old.payment_status = 'paid' and new.payment_status = 'unpaid' then
    raise exception 'paid leagues cannot be moved back to unpaid';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_prevent_active_pool_regression on public.pools;
create trigger trg_prevent_active_pool_regression
before update of activation_status, payment_status on public.pools
for each row
execute function public.prevent_active_pool_regression();
