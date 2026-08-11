begin;

-- Public pools do not authenticate with a pool password, so retaining a prior
-- private password hash serves no purpose. A future switch back to private
-- already requires the commissioner to provide a new password.
update public.pools
set join_password_hash=null,password_hash=null,private_password_hash=null
where coalesce(is_public,false)
  and (join_password_hash is not null or password_hash is not null or private_password_hash is not null);

alter table public.pools drop constraint if exists pools_private_password_required_check;
alter table public.pools add constraint pools_private_password_required_check check(
  is_public
  or archived
  or coalesce(join_password_hash,password_hash,private_password_hash) is not null
);

alter table public.pools drop constraint if exists pools_password_hash_format_check;
alter table public.pools add constraint pools_password_hash_format_check check(
  (join_password_hash is null or (octet_length(join_password_hash)=60 and left(join_password_hash,2)='$2'))
  and (password_hash is null or (octet_length(password_hash)=60 and left(password_hash,2)='$2'))
  and (private_password_hash is null or (octet_length(private_password_hash)=60 and left(private_password_hash,2)='$2'))
);

create or replace function public.clear_public_pool_password_hashes()
returns trigger language plpgsql security definer set search_path='public' as $function$
begin
  if coalesce(new.is_public,false) then
    new.join_password_hash:=null;
    new.password_hash:=null;
    new.private_password_hash:=null;
  end if;
  return new;
end;
$function$;
drop trigger if exists aay_clear_public_pool_password_hashes on public.pools;
create trigger aay_clear_public_pool_password_hashes
before insert or update of is_public,join_password_hash,password_hash,private_password_hash
on public.pools for each row execute function public.clear_public_pool_password_hashes();
revoke all on function public.clear_public_pool_password_hashes() from public,anon,authenticated;
grant execute on function public.clear_public_pool_password_hashes() to service_role;

commit;
