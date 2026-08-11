# Supabase Migrations

The project now keeps forward database changes in timestamped migrations.

The first migration is an immutable marker because production already had a
schema created by historical one-off SQL files. Do **not** replace or edit that
file: it is already recorded in production and changing it would make the local
history disagree with the applied history.

This means `supabase db reset` cannot currently build a brand-new database from
the migration directory alone. It fails at migration `20260718000200` because
the marker does not create `public.pools`. Existing linked environments can be
advanced safely with `supabase db push`; disaster recovery or a new project must
instead restore a current schema/data backup and then reconcile the migration
ledger. See `docs/backup-recovery.md`.

Always create a new timestamped, forward-only migration. Before production
deployment:

1. Run `npm run backup:db`.
2. Run `npm run supabase -- migration list` and confirm local/remote alignment.
3. Review pending SQL for locks, backfills, constraints, and privilege changes.
4. Apply with `npm run supabase -- db push`.
5. Regenerate types with `npm run supabase:types` and verify no unexpected diff.
