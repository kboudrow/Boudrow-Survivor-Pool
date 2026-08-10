# 2026 Release Readiness

Verified on August 10, 2026:

- Lint, 57 automated tests, authenticated database adversarial tests, and the production build pass.
- A full 18-week authenticated Troll simulation passes with integrity checks after every week.
- Missing picks, tie-as-loss, unscore/re-score, commissioner correction, reset, and winner recalculation pass.
- The 2026 schedule has 18 valid weeks and zero production integrity issues.
- Database RLS and policy audits pass, including direct attempts to alter another user's picks and entries.
- The score-sync duplicate-matchup blocker was repaired in production; manual score-sync and pick-lock runs completed successfully afterward.
- Supabase email-link expiration was reduced from 24 hours to 1 hour.
- Supabase performance warnings were reduced from 33 to 0 by optimizing RLS auth lookups, consolidating overlapping policies, and removing duplicate indexes.
- Broken user-scoped commissioner functions were removed after the entry-based replacements were verified; unnecessary anonymous privileged-function access and public avatar listing were revoked.
- Repeated blog requests now use Vercel's shared data cache; local warm response time fell from 1.74 seconds to about 0.04 seconds.
- A fresh API fallback backup captured 28 Auth users and 34 public relations.

## Required operator checks

- Keep the same `CRON_SECRET` in Vercel production and GitHub Actions; this is configured and verified as of August 10.
- Watch GitHub Actions during game windows. Scheduled workflow timing is not exact, even though failed endpoint calls now fail visibly and retry.
- Complete one signed-in rehearsal using a normal player account on a physical phone before opening the beta.
- Prefer a full SQL backup after starting Docker Desktop; the API backup is the current fallback.
- Supabase managed backups are not available on the current Free plan, so take an API backup before material commissioner or database operations.
