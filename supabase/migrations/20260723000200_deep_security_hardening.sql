begin;

create table if not exists public.security_rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete cascade,
  action text not null,
  subject text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_security_rate_limit_events_user_action_created
  on public.security_rate_limit_events (user_id, action, created_at desc);

alter table public.security_rate_limit_events enable row level security;

drop policy if exists security_rate_limit_events_superadmin_read on public.security_rate_limit_events;
create policy security_rate_limit_events_superadmin_read
on public.security_rate_limit_events
for select
to authenticated
using (public.is_super_admin());

create or replace function public.current_user_email_confirmed()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  );
$function$;

create or replace function public.assert_user_email_confirmed(p_action text default 'continue')
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Please sign in to %.', coalesce(nullif(p_action, ''), 'continue');
  end if;

  if not public.current_user_email_confirmed() then
    raise exception 'Please confirm your email before you %. Check your inbox for the confirmation link.', coalesce(nullif(p_action, ''), 'continue');
  end if;
end;
$function$;

create or replace function public.log_security_event(
  p_event_type text,
  p_severity text default 'warning',
  p_message text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_pool_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.app_event_logs (
    event_type,
    severity,
    source,
    pool_id,
    user_id,
    message,
    metadata
  )
  values (
    left(coalesce(nullif(p_event_type, ''), 'security_event'), 100),
    case when p_severity in ('info', 'warning', 'error') then p_severity else 'warning' end,
    'server',
    p_pool_id,
    auth.uid(),
    left(coalesce(p_message, ''), 1000),
    coalesce(p_metadata, '{}'::jsonb)
  );
exception
  when others then
    null;
end;
$function$;

create or replace function public.assert_action_rate_limit(
  p_action text,
  p_window_seconds integer,
  p_max_attempts integer,
  p_subject text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_action text := left(coalesce(nullif(btrim(p_action), ''), 'unknown'), 80);
  v_window_seconds integer := least(greatest(coalesce(p_window_seconds, 60), 10), 86400);
  v_max_attempts integer := least(greatest(coalesce(p_max_attempts, 10), 1), 1000);
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'Please sign in to continue.';
  end if;

  delete from public.security_rate_limit_events
  where created_at < now() - interval '2 days';

  select count(*)
  into v_count
  from public.security_rate_limit_events e
  where e.user_id = v_user_id
    and e.action = v_action
    and coalesce(e.subject, '') = coalesce(p_subject, '')
    and e.created_at >= now() - make_interval(secs => v_window_seconds);

  if v_count >= v_max_attempts then
    perform public.log_security_event(
      'rate_limit_blocked',
      'warning',
      'Rate limit blocked an action.',
      jsonb_build_object(
        'action', v_action,
        'subject', p_subject,
        'window_seconds', v_window_seconds,
        'max_attempts', v_max_attempts
      ) || coalesce(p_metadata, '{}'::jsonb),
      null
    );
    raise exception 'Too many attempts. Please wait a few minutes and try again.';
  end if;

  insert into public.security_rate_limit_events (user_id, action, subject, metadata)
  values (v_user_id, v_action, nullif(p_subject, ''), coalesce(p_metadata, '{}'::jsonb));
end;
$function$;

create or replace function public.is_pool_member(p uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.pool_members pm
    where pm.pool_id = p
      and pm.profile_id = auth.uid()
  );
$function$;

-- Sensitive pool data should be readable through membership/admin paths, but
-- normal users should not write these tables directly. RPCs own writes.
alter table if exists public.pools enable row level security;
alter table if exists public.pool_members enable row level security;
alter table if exists public.pool_pick_drafts enable row level security;
alter table if exists public.pool_picks enable row level security;
alter table if exists public.pool_member_stats enable row level security;

do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('pools', 'pool_members', 'pool_pick_drafts', 'pool_picks', 'pool_member_stats')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

create policy pools_select_public
on public.pools
for select
to anon, authenticated
using (
  coalesce(is_public, false)
  and coalesce(archived, false) = false
  and coalesce(activation_status, 'active') <> 'cancelled'
);

create policy pools_select_member_or_admin
on public.pools
for select
to authenticated
using (
  created_by = auth.uid()
  or public.is_pool_member(id)
  or public.admin_can_manage(id)
);

create policy pool_members_select_same_pool
on public.pool_members
for select
to authenticated
using (
  profile_id = auth.uid()
  or public.is_pool_member(pool_id)
  or public.admin_can_manage(pool_id)
);

create policy pool_pick_drafts_select_own_or_admin
on public.pool_pick_drafts
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.pool_members pm
    where pm.id = pool_pick_drafts.entry_id
      and pm.profile_id = auth.uid()
  )
  or public.admin_can_manage(pool_id)
);

create policy pool_picks_select_own_or_admin
on public.pool_picks
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.pool_members pm
    where pm.id = pool_picks.entry_id
      and pm.profile_id = auth.uid()
  )
  or public.admin_can_manage(pool_id)
);

create policy pool_member_stats_select_same_pool
on public.pool_member_stats
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_pool_member(pool_id)
  or public.admin_can_manage(pool_id)
);

-- Blog public reads stay public; writes move behind rate-limited RPCs.
alter table if exists public.blog_comments enable row level security;
alter table if exists public.blog_comment_reactions enable row level security;
alter table if exists public.blog_comment_reports enable row level security;
alter table if exists public.blog_posts enable row level security;
alter table if exists public.blog_categories enable row level security;

do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('blog_comments', 'blog_comment_reactions', 'blog_comment_reports', 'blog_posts', 'blog_categories')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

create policy blog_comments_public_read
on public.blog_comments
for select
to anon, authenticated
using (deleted_at is null);

create policy blog_comment_reactions_public_read
on public.blog_comment_reactions
for select
to anon, authenticated
using (true);

create policy blog_comment_reports_select_self_or_superadmin
on public.blog_comment_reports
for select
to authenticated
using (profile_id = auth.uid() or public.is_blog_superadmin());

create policy blog_posts_public_read_published
on public.blog_posts
for select
to anon, authenticated
using (status = 'published');

create policy blog_posts_staff_read
on public.blog_posts
for select
to authenticated
using (
  public.current_blog_role() in ('admin', 'editor')
  or author_id = auth.uid()
);

create policy blog_categories_public_read
on public.blog_categories
for select
to anon, authenticated
using (true);

create or replace function public.blog_submit_comment(
  p_post_slug text,
  p_body text,
  p_parent_comment_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_post_slug text := lower(btrim(coalesce(p_post_slug, '')));
  v_body text := btrim(coalesce(p_body, ''));
  v_comment_id uuid;
begin
  perform public.assert_user_email_confirmed('comment');
  perform public.assert_action_rate_limit('blog_comment', 600, 10, v_post_slug, jsonb_build_object('parent_comment_id', p_parent_comment_id));

  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'Comments must be between 1 and 2,000 characters.';
  end if;

  if not exists (
    select 1
    from public.blog_posts bp
    where bp.slug = v_post_slug
      and bp.status = 'published'
  ) then
    raise exception 'That post is not available for comments.';
  end if;

  if p_parent_comment_id is not null and not exists (
    select 1
    from public.blog_comments bc
    where bc.id = p_parent_comment_id
      and bc.post_slug = v_post_slug
      and bc.deleted_at is null
  ) then
    raise exception 'That comment thread is no longer available.';
  end if;

  insert into public.blog_comments (post_slug, profile_id, parent_comment_id, body)
  values (v_post_slug, v_user_id, p_parent_comment_id, v_body)
  returning id into v_comment_id;

  return v_comment_id;
end;
$function$;

create or replace function public.blog_set_comment_reaction(
  p_comment_id uuid,
  p_reaction text
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_reaction text := lower(btrim(coalesce(p_reaction, '')));
  v_existing text;
begin
  perform public.assert_user_email_confirmed('react to comments');
  perform public.assert_action_rate_limit('blog_reaction', 60, 60, p_comment_id::text);

  if v_reaction not in ('up', 'down') then
    raise exception 'Invalid reaction.';
  end if;

  if not exists (
    select 1
    from public.blog_comments bc
    where bc.id = p_comment_id
      and bc.deleted_at is null
  ) then
    raise exception 'Comment not found.';
  end if;

  select bcr.reaction
  into v_existing
  from public.blog_comment_reactions bcr
  where bcr.comment_id = p_comment_id
    and bcr.profile_id = v_user_id;

  if v_existing = v_reaction then
    delete from public.blog_comment_reactions
    where comment_id = p_comment_id
      and profile_id = v_user_id;
    return 'Reaction removed.';
  end if;

  insert into public.blog_comment_reactions (comment_id, profile_id, reaction)
  values (p_comment_id, v_user_id, v_reaction)
  on conflict (comment_id, profile_id) do update
    set reaction = excluded.reaction,
        updated_at = now();

  return 'Reaction saved.';
end;
$function$;

create or replace function public.blog_report_comment(p_comment_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  perform public.assert_user_email_confirmed('report comments');
  perform public.assert_action_rate_limit('blog_report', 3600, 10, p_comment_id::text);

  if not exists (
    select 1
    from public.blog_comments bc
    where bc.id = p_comment_id
      and bc.deleted_at is null
  ) then
    raise exception 'Comment not found.';
  end if;

  insert into public.blog_comment_reports (comment_id, profile_id, reason)
  values (p_comment_id, v_user_id, 'reader_report')
  on conflict (comment_id, profile_id) do nothing;

  return 'Comment reported.';
end;
$function$;

create or replace function public.blog_delete_own_comment(p_comment_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Please sign in to delete comments.';
  end if;

  perform public.assert_action_rate_limit('blog_delete_own_comment', 600, 20, p_comment_id::text);

  update public.blog_comments
  set deleted_at = now(),
      updated_at = now()
  where id = p_comment_id
    and profile_id = auth.uid()
    and deleted_at is null;

  if not found then
    return 'Comment was already deleted or was not found.';
  end if;

  return 'Comment deleted.';
end;
$function$;

create or replace function public.blog_save_post(
  p_id uuid default null,
  p_title text default null,
  p_slug text default null,
  p_description text default null,
  p_category text default null,
  p_status text default 'draft',
  p_author_name text default null,
  p_hero_image_url text default null,
  p_sections jsonb default '[]'::jsonb,
  p_pinned boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role text := public.current_blog_role();
  v_id uuid := p_id;
  v_title text := btrim(coalesce(p_title, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_description text := btrim(coalesce(p_description, ''));
  v_category text := btrim(coalesce(p_category, ''));
  v_status text := lower(btrim(coalesce(p_status, 'draft')));
  v_author_name text := coalesce(nullif(btrim(p_author_name), ''), 'Survive Sunday');
  v_sections jsonb := coalesce(p_sections, '[]'::jsonb);
  v_existing public.blog_posts%rowtype;
begin
  perform public.assert_user_email_confirmed('manage blog posts');
  perform public.assert_action_rate_limit('blog_save_post', 600, 30, coalesce(p_id::text, v_slug));

  if v_role not in ('admin', 'editor', 'contributor') then
    raise exception 'Blog access required.';
  end if;

  if char_length(v_title) < 3 or char_length(v_title) > 180 then
    raise exception 'Post title must be between 3 and 180 characters.';
  end if;

  if char_length(v_slug) < 3 or char_length(v_slug) > 220 or v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Post slug must use lowercase letters, numbers, and hyphens.';
  end if;

  if char_length(v_description) < 20 or char_length(v_description) > 400 then
    raise exception 'Post summary must be between 20 and 400 characters.';
  end if;

  if jsonb_typeof(v_sections) <> 'array' or jsonb_array_length(v_sections) = 0 then
    raise exception 'Post body is required.';
  end if;

  if v_status not in ('draft', 'published', 'archived') then
    v_status := 'draft';
  end if;

  if v_role = 'contributor' then
    v_status := 'draft';
    p_pinned := false;
  end if;

  if v_id is not null then
    select *
    into v_existing
    from public.blog_posts bp
    where bp.id = v_id
    for update;

    if not found then
      raise exception 'Post not found.';
    end if;

    if v_role = 'contributor' and (v_existing.author_id is distinct from v_user_id or v_existing.status <> 'draft') then
      raise exception 'Contributors can only edit their own drafts.';
    end if;

    update public.blog_posts
    set title = v_title,
        slug = v_slug,
        description = v_description,
        category = v_category,
        status = v_status,
        author_id = coalesce(v_existing.author_id, v_user_id),
        author_name = v_author_name,
        read_time = greatest(1, ceiling(length(v_sections::text) / 1200.0))::integer::text || ' min read',
        pinned = case when v_role in ('admin', 'editor') then coalesce(p_pinned, false) else false end,
        hero_image_url = public.clean_public_image_url(p_hero_image_url),
        sections = v_sections,
        published_at = case
          when v_status = 'published' and v_existing.published_at is null then now()
          when v_status = 'published' then v_existing.published_at
          else null
        end
    where id = v_id;
  else
    insert into public.blog_posts (
      title,
      slug,
      description,
      category,
      status,
      author_id,
      author_name,
      read_time,
      pinned,
      hero_image_url,
      sections,
      published_at
    )
    values (
      v_title,
      v_slug,
      v_description,
      v_category,
      v_status,
      v_user_id,
      v_author_name,
      greatest(1, ceiling(length(v_sections::text) / 1200.0))::integer::text || ' min read',
      case when v_role in ('admin', 'editor') then coalesce(p_pinned, false) else false end,
      public.clean_public_image_url(p_hero_image_url),
      v_sections,
      case when v_status = 'published' then now() else null end
    )
    returning id into v_id;
  end if;

  return jsonb_build_object('id', v_id, 'slug', v_slug, 'status', v_status);
end;
$function$;

create or replace function public.blog_delete_post(p_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if public.current_blog_role() <> 'admin' then
    raise exception 'Only the Survive Sunday superadmin can delete posts.';
  end if;

  perform public.assert_action_rate_limit('blog_delete_post', 600, 20, p_id::text);

  delete from public.blog_posts
  where id = p_id;

  if not found then
    return 'Post was already deleted or was not found.';
  end if;

  return 'Post deleted.';
end;
$function$;

create or replace function public.blog_add_category(p_name text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_sort_order integer;
begin
  if not public.is_blog_superadmin() then
    raise exception 'Only the Survive Sunday superadmin can add blog categories.';
  end if;

  perform public.assert_action_rate_limit('blog_add_category', 600, 20, lower(v_name));

  if char_length(v_name) < 2 or char_length(v_name) > 40 then
    raise exception 'Category names must be between 2 and 40 characters.';
  end if;

  if v_name !~ '^[A-Za-z0-9 &.-]+$' then
    raise exception 'Category names can use letters, numbers, spaces, ampersands, periods, and hyphens.';
  end if;

  select coalesce(max(sort_order), 90) + 10
  into v_sort_order
  from public.blog_categories;

  insert into public.blog_categories (name, sort_order, created_by)
  values (v_name, v_sort_order, auth.uid())
  on conflict (name) do nothing;

  return format('Added %s category.', v_name);
end;
$function$;

create or replace function public.clean_public_image_url(p_url text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if v_url is null then
    return null;
  end if;

  if char_length(v_url) > 2000 or v_url ~ '[[:cntrl:]]' then
    raise exception 'Image URL is invalid.';
  end if;

  if v_url ~* '^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]+)?(/[^[:space:]<>"''()]*)?$' then
    return v_url;
  end if;

  if v_url like '/%' and v_url not like '//%' and v_url !~ '[[:space:]<>"''()]' then
    return v_url;
  end if;

  raise exception 'Image URL must come from an uploaded image.';
end;
$function$;

create or replace function public.admin_update_pool_image(
  p_pool_id uuid,
  p_image_url text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_image_url text := public.clean_public_image_url(p_image_url);
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  perform public.assert_action_rate_limit('admin_update_pool_image', 600, 30, p_pool_id::text);

  update public.pools
  set image_url = v_image_url
  where id = p_pool_id;

  perform public.log_security_event('pool_image_updated', 'info', 'Pool image updated.', '{}'::jsonb, p_pool_id);
end;
$function$;

-- Verified accounts only for pool creation/joining/extra entries.
create or replace function public.create_pool_with_owner(
  p_name text,
  p_is_public boolean default true,
  p_password text default null,
  p_start_week integer default 1,
  p_include_playoffs boolean default false,
  p_strikes_allowed text default '0',
  p_tie_rule text default 'loss',
  p_deadline_mode text default 'fixed',
  p_deadline_fixed text default '13:00',
  p_notes text default null,
  p_image_url text default null,
  p_season integer default 2026,
  p_double_pick_weeks integer[] default '{}',
  p_max_members integer default 25,
  p_allow_multiple_entries boolean default false,
  p_max_entries_per_user integer default 1
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_pool_id uuid;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_hash text := null;
  v_max_entries integer := case when coalesce(p_allow_multiple_entries, false) then coalesce(p_max_entries_per_user, 1) else 1 end;
  v_double_weeks integer[];
  v_user_label text;
begin
  perform public.assert_user_email_confirmed('create a pool');
  perform public.assert_action_rate_limit('create_pool', 3600, 5, null, jsonb_build_object('pool_name', v_name));

  if v_name is null or length(v_name) < 3 then
    raise exception 'Pool name is too short. Please use at least 3 characters.';
  end if;

  if coalesce(p_start_week, 1) < 1 or coalesce(p_start_week, 1) > 12 then
    raise exception 'Start week must be between Week 1 and Week 12.';
  end if;

  if coalesce(p_max_members, 25) < 2 or coalesce(p_max_members, 25) > 500 then
    raise exception 'Member limit must be between 2 and 500.';
  end if;

  if v_max_entries < 1 or v_max_entries > 10 then
    raise exception 'Entries per user must be between 1 and 10.';
  end if;

  if lower(coalesce(p_tie_rule, 'loss')) not in ('win', 'loss') then
    raise exception 'Tie rule must be win or loss.';
  end if;

  if coalesce(p_deadline_mode, 'fixed') not in ('fixed', 'rolling') then
    raise exception 'Deadline mode must be fixed or rolling.';
  end if;

  if not coalesce(p_is_public, true) then
    if nullif(btrim(coalesce(p_password, '')), '') is null then
      raise exception 'Please enter a password for private pools.';
    end if;
    v_hash := extensions.crypt(p_password, extensions.gen_salt('bf', 8));
  end if;

  select coalesce(array_agg(distinct week order by week), '{}'::integer[])
  into v_double_weeks
  from unnest(coalesce(p_double_pick_weeks, '{}'::integer[])) as selected(week)
  where selected.week between coalesce(p_start_week, 1) and 18;

  v_user_label := 'Player ' || left(v_user_id::text, 8);

  insert into public.profiles (id, "User_name", display_name, username, created_at, updated_at)
  values (v_user_id, v_user_label, v_user_label, v_user_label, now(), now())
  on conflict (id) do nothing;

  insert into public.pools (
    name,
    is_public,
    visibility,
    allow_discovery,
    start_week,
    include_playoffs,
    strikes_allowed,
    tie_rule,
    ties,
    deadline_mode,
    deadline_fixed,
    notes,
    image_url,
    created_by,
    season,
    double_pick_weeks,
    plan,
    pick_privacy,
    activation_status,
    payment_status,
    max_members,
    allow_multiple_entries,
    max_entries_per_user,
    join_password_hash,
    password_hash,
    private_password_hash
  )
  values (
    v_name,
    coalesce(p_is_public, true),
    case when coalesce(p_is_public, true) then 'public'::public.pool_visibility else 'private'::public.pool_visibility end,
    true,
    coalesce(p_start_week, 1),
    coalesce(p_include_playoffs, false),
    coalesce(p_strikes_allowed, '0'),
    lower(coalesce(p_tie_rule, 'loss')),
    lower(coalesce(p_tie_rule, 'loss'))::public.ties_rule,
    coalesce(p_deadline_mode, 'fixed'),
    p_deadline_fixed,
    nullif(btrim(coalesce(p_notes, '')), ''),
    public.clean_public_image_url(p_image_url),
    v_user_id,
    coalesce(p_season, 2026),
    v_double_weeks,
    'free',
    'hidden',
    'active',
    'not_required',
    coalesce(p_max_members, 25),
    coalesce(p_allow_multiple_entries, false),
    v_max_entries,
    v_hash,
    v_hash,
    v_hash
  )
  returning id into v_pool_id;

  insert into public.pool_members (pool_id, profile_id, role, status, entry_number)
  values (v_pool_id, v_user_id, 'admin'::public.member_role, 'alive', 1)
  on conflict (pool_id, profile_id, entry_number) do nothing;

  perform public.log_security_event('pool_created', 'info', 'Pool created.', jsonb_build_object('pool_name', v_name), v_pool_id);

  return v_pool_id;
end;
$function$;

create or replace function public.join_pool(p_pool_id uuid, p_password text default null, p_token text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_entry_count integer;
  v_is_owner boolean;
  v_password_hash text;
  v_next_entry integer;
  v_start_at timestamptz;
begin
  perform public.assert_user_email_confirmed('join a pool');
  perform public.assert_action_rate_limit('join_pool', 600, 20, p_pool_id::text);

  select *
  into v_pool
  from public.pools
  where id = p_pool_id
  for update;

  if not found then
    raise exception 'Pool not found.';
  end if;

  v_is_owner := v_pool.created_by = auth.uid();

  if coalesce(v_pool.archived, false) then
    raise exception 'This pool is archived.';
  end if;

  if coalesce(v_pool.activation_status, 'draft') = 'cancelled' then
    raise exception 'This pool is not accepting members.';
  end if;

  if exists (
    select 1
    from public.pool_members pm
    where pm.pool_id = p_pool_id
      and pm.profile_id = auth.uid()
  ) then
    return;
  end if;

  if coalesce(v_pool.test_mode, false)
    and coalesce(v_pool.test_current_week, v_pool.start_week, 1) >= coalesce(v_pool.start_week, 1) then
    raise exception 'This pool has already started.';
  end if;

  select coalesce(
    (
      select min(coalesce(g.kickoff_at_utc, g.game_time))
      from public.nfl_games g
      where g.season = coalesce(v_pool.season, extract(year from now())::integer)
        and g.week = coalesce(v_pool.start_week, 1)
        and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(coalesce(v_pool.season, extract(year from now())::integer), 1, 1, 0, 0, 0, 'UTC')
    ),
    (
      select sw.week_sunday_date::timestamp at time zone 'America/New_York'
      from public.season_weeks sw
      where sw.season = coalesce(v_pool.season, extract(year from now())::integer)
        and sw.week = coalesce(v_pool.start_week, 1)
    )
  )
  into v_start_at;

  if v_start_at is not null and now() >= v_start_at then
    raise exception 'This pool has already started.';
  end if;

  select count(*)
  into v_entry_count
  from public.pool_members pm
  where pm.pool_id = p_pool_id;

  if not v_is_owner and v_entry_count >= coalesce(v_pool.max_members, 25) then
    raise exception 'This pool is full.';
  end if;

  if not coalesce(v_pool.is_public, false) and not v_is_owner then
    perform public.assert_action_rate_limit('private_pool_password', 600, 8, p_pool_id::text);
    v_password_hash := coalesce(v_pool.join_password_hash, v_pool.password_hash, v_pool.private_password_hash);
    if v_password_hash is null
      or p_password is null
      or extensions.crypt(p_password, v_password_hash) <> v_password_hash then
      perform public.log_security_event('private_pool_password_failed', 'warning', 'Incorrect pool password.', '{}'::jsonb, p_pool_id);
      raise exception 'Incorrect pool password.';
    end if;
  end if;

  select coalesce(max(pm.entry_number), 0) + 1
  into v_next_entry
  from public.pool_members pm
  where pm.pool_id = p_pool_id
    and pm.profile_id = auth.uid();

  insert into public.pool_members (pool_id, profile_id, role, status, entry_number)
  values (
    p_pool_id,
    auth.uid(),
    case when v_is_owner then 'admin'::public.member_role else 'member'::public.member_role end,
    'alive',
    v_next_entry
  );

  perform public.log_security_event('pool_joined', 'info', 'User joined pool.', jsonb_build_object('entry_number', v_next_entry), p_pool_id);
end;
$function$;

create or replace function public.add_pool_entry(p_pool_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_current_entries integer;
  v_pool_entries integer;
  v_next_entry integer;
  v_entry_id uuid;
  v_start_at timestamptz;
begin
  perform public.assert_user_email_confirmed('add an entry');
  perform public.assert_action_rate_limit('add_pool_entry', 600, 10, p_pool_id::text);

  select *
  into v_pool
  from public.pools
  where id = p_pool_id
  for update;

  if not found then
    raise exception 'Pool not found.';
  end if;

  if coalesce(v_pool.archived, false) then
    raise exception 'This pool is archived.';
  end if;

  if coalesce(v_pool.test_mode, false)
    and coalesce(v_pool.test_current_week, v_pool.start_week, 1) >= coalesce(v_pool.start_week, 1) then
    raise exception 'This pool has already started.';
  end if;

  select coalesce(
    (
      select min(coalesce(g.kickoff_at_utc, g.game_time))
      from public.nfl_games g
      where g.season = coalesce(v_pool.season, extract(year from now())::integer)
        and g.week = coalesce(v_pool.start_week, 1)
        and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(coalesce(v_pool.season, extract(year from now())::integer), 1, 1, 0, 0, 0, 'UTC')
    ),
    (
      select sw.week_sunday_date::timestamp at time zone 'America/New_York'
      from public.season_weeks sw
      where sw.season = coalesce(v_pool.season, extract(year from now())::integer)
        and sw.week = coalesce(v_pool.start_week, 1)
    )
  )
  into v_start_at;

  if v_start_at is not null and now() >= v_start_at then
    raise exception 'This pool has already started.';
  end if;

  if not coalesce(v_pool.allow_multiple_entries, false) then
    raise exception 'This pool only allows one entry per user.';
  end if;

  select count(*), coalesce(max(entry_number), 0) + 1
  into v_current_entries, v_next_entry
  from public.pool_members
  where pool_id = p_pool_id
    and profile_id = auth.uid();

  if v_current_entries = 0 then
    raise exception 'Join this pool before adding another entry.';
  end if;

  if v_current_entries >= coalesce(v_pool.max_entries_per_user, 1) then
    raise exception 'You have reached the entry limit for this pool.';
  end if;

  select count(*)
  into v_pool_entries
  from public.pool_members
  where pool_id = p_pool_id;

  if v_pool_entries >= coalesce(v_pool.max_members, 25) then
    raise exception 'This pool is full.';
  end if;

  insert into public.pool_members (pool_id, profile_id, role, status, entry_number)
  values (p_pool_id, auth.uid(), 'member'::public.member_role, 'alive', v_next_entry)
  returning id into v_entry_id;

  perform public.log_security_event('pool_entry_added', 'info', 'Pool entry added.', jsonb_build_object('entry_number', v_next_entry), p_pool_id);

  return v_entry_id;
end;
$function$;

-- Storage: keep public read, but scope writes to owned folders.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('pool-images', 'pool-images', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  ('blog-images', 'blog-images', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
declare
  r record;
begin
  for r in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname in (
        'pool_images_authenticated_insert',
        'pool_images_scoped_insert',
        'pool_images_owner_update',
        'pool_images_scoped_update',
        'pool_images_scoped_delete',
        'blog_images_staff_insert',
        'blog_images_staff_update',
        'blog_images_staff_delete',
        'blog_images_superadmin_delete',
        'blog_images_scoped_insert',
        'blog_images_scoped_update',
        'blog_images_scoped_delete'
      )
  loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;
end $$;

create policy pool_images_scoped_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'pool-images'
  and (
    split_part(name, '/', 1) = auth.uid()::text
    or (
      split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.admin_can_manage(split_part(name, '/', 1)::uuid)
    )
  )
);

create policy pool_images_scoped_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'pool-images'
  and (
    owner = auth.uid()
    or (
      split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.admin_can_manage(split_part(name, '/', 1)::uuid)
    )
  )
)
with check (
  bucket_id = 'pool-images'
  and (
    split_part(name, '/', 1) = auth.uid()::text
    or (
      split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.admin_can_manage(split_part(name, '/', 1)::uuid)
    )
  )
);

create policy pool_images_scoped_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'pool-images'
  and (
    owner = auth.uid()
    or (
      split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.admin_can_manage(split_part(name, '/', 1)::uuid)
    )
  )
);

create policy blog_images_scoped_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'blog-images'
  and split_part(name, '/', 1) = auth.uid()::text
  and public.can_manage_blog()
);

create policy blog_images_scoped_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'blog-images'
  and split_part(name, '/', 1) = auth.uid()::text
  and public.can_manage_blog()
)
with check (
  bucket_id = 'blog-images'
  and split_part(name, '/', 1) = auth.uid()::text
  and public.can_manage_blog()
);

create policy blog_images_scoped_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'blog-images'
  and (
    public.is_blog_superadmin()
    or (split_part(name, '/', 1) = auth.uid()::text and public.can_manage_blog())
  )
);

revoke execute on function public.current_user_email_confirmed() from public;
revoke execute on function public.assert_user_email_confirmed(text) from public;
revoke execute on function public.log_security_event(text, text, text, jsonb, uuid) from public;
revoke execute on function public.assert_action_rate_limit(text, integer, integer, text, jsonb) from public;
revoke execute on function public.clean_public_image_url(text) from public;
grant execute on function public.current_user_email_confirmed() to anon, authenticated;
grant execute on function public.assert_user_email_confirmed(text) to authenticated;
grant execute on function public.is_pool_member(uuid) to authenticated;
grant execute on function public.admin_can_manage(uuid) to authenticated;
grant execute on function public.blog_submit_comment(text, text, uuid) to authenticated;
grant execute on function public.blog_set_comment_reaction(uuid, text) to authenticated;
grant execute on function public.blog_report_comment(uuid) to authenticated;
grant execute on function public.blog_delete_own_comment(uuid) to authenticated;
grant execute on function public.blog_save_post(uuid, text, text, text, text, text, text, text, jsonb, boolean) to authenticated;
grant execute on function public.blog_delete_post(uuid) to authenticated;
grant execute on function public.blog_add_category(text) to authenticated;
grant execute on function public.admin_update_pool_image(uuid, text) to authenticated;
grant execute on function public.create_pool_with_owner(text, boolean, text, integer, boolean, text, text, text, text, text, text, integer, integer[], integer, boolean, integer) to authenticated;
grant execute on function public.join_pool(uuid, text, text) to authenticated;
grant execute on function public.add_pool_entry(uuid) to authenticated;

commit;
