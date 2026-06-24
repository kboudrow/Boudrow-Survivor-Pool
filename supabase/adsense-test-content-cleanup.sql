-- Remove obvious beta/test clutter from public-facing discovery.
-- These exact pools were created while smoke-testing flows and should not
-- appear as live public league examples for crawlers or new visitors.

begin;

update public.pools
set archived = true,
    archived_at = coalesce(archived_at, now()),
    allow_discovery = false,
    is_public = false
where lower(name) in (
  'beta picker',
  'slytherin',
  'kerfuffle',
  'hehehaha',
  'strizzy',
  'thisone',
  'payment'
);

delete from public.blog_posts
where slug = 'testing-again'
  and status = 'archived';

commit;
