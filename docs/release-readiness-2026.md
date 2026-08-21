# 2026 Release Readiness

## August 21 launch checkpoint

### Completed

- [x] Full Checkers season simulation completed through a declared Week 17 winner.
- [x] Picks, locks, double-pick weeks, mulligans, eliminations, wipeout survival, standings history, and winner presentation were exercised end to end in test mode.
- [x] Production readiness audit passed on August 21 at 3:33 PM ET: 272 database games matched 272 provider games, with zero schedule mismatches.
- [x] Score-sync and pick-lock automation were current, with no recent cron errors in the readiness audit.
- [x] Earlier ESPN `403 Forbidden` events stopped without intervention; subsequent score-sync runs repeatedly completed successfully with zero errors.
- [x] A fresh SQL recovery bundle was completed at `backups/supabase-recovery-2026-08-21T19-33-19-583Z/`. It contains the public schema, public data, managed/Auth data, and restore notes. Backups remain ignored by git and must be handled as sensitive production data.
- [x] The circular-foreign-key warning for `blog_comments` was recorded. A restore must follow `docs/backup-recovery.md`, begin in a temporary project, and may require disabled triggers while loading data.

### Still required before broad launch

- [ ] Wait for Amazon SES DKIM status for `auth.survivesunday.com` to change from Pending to Successful.
- [ ] Connect verified SES SMTP credentials to hosted Supabase and test confirmation, password-reset, email-change, invitation, and security-notification messages.
- [ ] Complete one signed-in rehearsal on a physical phone using a normal player account.
- [ ] During Week 1, allow at least one real NFL result to travel through ESPN, the scheduled score-sync job, adjudication, standings, and the player dashboard without manual outcomes.
- [ ] After that live result, confirm Superadmin automation health, score-feed health, and production logs remain clean.
- [ ] Export Supabase Storage objects before any major recovery exercise or infrastructure move; SQL backups do not contain the stored image files.

## Scoring-code freeze

The scoring system is frozen for launch. Do not refactor or enhance scoring, locking, standings, elimination, mulligan, wipeout, winner, schedule, or score-feed behavior merely for cleanup.

A change in those areas is allowed only when all of the following are true:

1. A reproducible production or test-season defect demonstrates that current behavior is wrong.
2. The expected survivor rule is written down before implementation.
3. The change is narrowly scoped to the demonstrated defect.
4. A targeted regression test fails before the correction and passes afterward.
5. Related survivor integrity tests and migration checks pass.
6. A fresh production backup is taken before any database migration or broad repair.

Operational documentation, monitoring reviews, backups, email delivery configuration, and read-only audits remain allowed during the freeze. Product enhancements and speculative edge-case changes wait until after the first successful live NFL scoring cycle.

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
