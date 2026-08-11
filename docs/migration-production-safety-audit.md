# Supabase Migration Production-Safety Audit

Audit date: 2026-08-10  
Scope: all 72 migrations from `20260718000100` through `20260810004000`, the
current linked production schema, application RPC/table usage, generated
database types, and the configured NFL seed.

## Chronological review

- `20260718`: the migration ledger begins with a marker for a pre-existing
  schema, followed by additive event logging. The marker is the principal
  recovery problem: it cannot bootstrap an empty database.
- `20260719`–`20260721`: test-mode controls repeatedly replace privileged
  functions. Their destructive operations are scoped to asserted test pools.
- `20260722`: score health, weekly completion, standings, profile updates, and
  avatar policies are additive. Supporting indexes are present for the primary
  standings paths.
- `20260723`: roster/pick guards and the main RLS/security rewrite consolidate
  policies and RPC authorization. Later migrations supersede several function
  definitions; final grants and policies were audited rather than judging an
  obsolete intermediate definition in isolation.
- `20260724`–`20260727`: performance indexes, cron/archive/invite controls,
  playoff test tooling, and future-pick pruning are forward changes. Test data
  deletion remains restricted to test-mode functions.
- `20260803`: quality RPC backfills and follow-ups are additive and use guarded
  object creation. The normalized username unique index could have rejected
  duplicate legacy usernames, but it is already applied successfully and the
  final schema contains the intended index.
- `20260807`–`20260809`: storage, pick replacement, deadline, winner, and pool
  discovery changes replace functions/policies without dropping competition
  tables. Final private-pool visibility is restrictive.
- `20260810000100`–`20260810001200`: test fixes, pick invariants, serialization,
  clarified rules, postseason bounds, and input/rate hardening are additive or
  replace RPCs. Unique pick constraints are entry-scoped.
- `20260810001300`–`20260810001700`: secret-column access is revoked and pool
  capacity changes use a sentinel for unlimited. Existing finite limits remain
  valid.
- `20260810001800`–`20260810002300`: kickoff integrity, standings consistency,
  commissioner editing, score-sync hardening, and database-advisor cleanup are
  forward changes. The matchup unique index could have failed on duplicates,
  but it is already applied and current production satisfies it.
- `20260810002400`–`20260810002800`: state-machine and lifecycle migrations
  backfill pool rule fields before making them non-null. They add immediately
  validated constraints and therefore took table locks when originally
  applied, but they completed successfully against the populated production
  database. No applied file was rewritten.
- `20260810002900`–`20260810003200`: transaction locks, idempotent creation, and
  untrusted-feed handling are function/trigger changes with fixed search paths
  and explicit execution grants.
- `20260810003300`–`20260810003800`: historical snapshots, correction/removal
  audit records, privacy hardening, password invariants, and dispute evidence
  preserve competition evidence and minimize exposed identity data.
- `20260810003900`–`20260810004000`: this audit's forward fixes remove direct
  browser mutation privileges/default exposure, revoke trigger-function RPC
  access, add 22 foreign-key supporting indexes, and remove one exact duplicate
  NFL schedule index.

## Confirmed findings and disposition

1. **Empty-database replay is broken.** Migration `20260718000100` is only a
   marker, so migration `20260718000200` fails because `public.pools` does not
   exist. The applied marker was not edited. Recovery now explicitly requires a
   current backup restore and careful migration-ledger reconciliation.
2. **Browser roles had excessive table and sequence privileges.** Production
   granted `TRUNCATE`, `TRIGGER`, `REFERENCES`, `MAINTAIN`, and in some cases all
   table privileges to `anon`/`authenticated`. Migration `039` removes all
   browser table writes and sequence access while preserving SELECT and RPC
   grants. Post-migration schema verification found none remaining.
3. **Future objects inherited unsafe grants.** PostgreSQL default privileges
   automatically exposed new tables, sequences, and functions to browser roles.
   Migration `039` revokes those defaults, and local Supabase config now sets
   `auto_expose_new_tables = false`.
4. **Trigger functions were exposed as RPC candidates.** Migration `039`
   revokes trigger-function execution from `public`, `anon`, and
   `authenticated`; user-facing RPC grants remain intact.
5. **Foreign keys lacked supporting indexes.** Migration `040` adds 22
   rerunnable indexes for account/profile deletion, `SET NULL`, and cascade
   paths that otherwise risk long scans and broad locks as tables grow.
6. **One exact duplicate index existed.** `nfl_games_season_week_idx` duplicated
   `idx_nfl_games_season_week`; migration `040` removes the redundant copy.
7. **The configured NFL seed was destructive.** It deleted every 2026 game and
   could roll a final game back to scheduled. The seed and its generator now
   upsert by matchup, preserve live/final status, and mark unknown flex kickoffs
   unconfirmed.
8. **Applied migration drift had no guardrail.** SHA-256 checksums are now
   recorded for every applied migration and `npm run quality:migrations` fails
   if an applied file changes, disappears, or reuses a timestamp.

## Final-schema checks

- Local and remote migration ledgers match through `20260810004000`.
- Generated TypeScript database types match the linked schema with no diff.
- All 76 application-called RPCs are represented in migrations.
- Final policy names are unique per table; superseded names are dropped before
  replacement.
- Current SECURITY DEFINER functions use fixed search paths, implicit PUBLIC
  execution is revoked, and trigger helpers are service-only.
- Competition writes are RPC/service-role based; application source contains no
  browser table insert/update/delete path that depends on the revoked grants.

## Remaining production risk

The repository alone is not a self-contained disaster-recovery source because
of the immutable legacy baseline marker. A current encrypted SQL backup and a
separate Storage export remain required until the project is deliberately
rebased into a new migration history in a new environment. That rebase must not
be performed by modifying production's applied migration files.
