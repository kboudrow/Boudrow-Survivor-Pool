# Backup And Recovery

Survive Sunday uses Supabase for production data. This file is the operator runbook for manual backups and emergency recovery.

## Backup Rhythm

Run a manual backup before:

- Applying Supabase migrations.
- Bulk importing NFL schedule or score data.
- Running broad repair scripts.
- Making destructive admin changes during beta.

During the NFL season, take a manual backup at least weekly and before every Sunday kickoff window.

## Manual Backup

From the project root:

```bash
npm run backup:db
```

The script writes a timestamped SQL dump into `/backups`. That folder is ignored by git on purpose.

Optional narrower dumps:

```bash
npm run backup:db -- --schema-only
npm run backup:db -- --data-only
```

If Docker is unavailable and the CLI dump cannot run, capture a service-role API fallback before proceeding:

```bash
npm run backup:api
```

This fallback captures Auth users and every readable public table as JSON. Prefer the SQL dump whenever Docker is available because it also preserves complete schema-level recovery information.

## Recovery Rules

1. Do not restore directly over production while users are active.
2. First restore to a temporary Supabase project when possible.
3. Verify auth users, profiles, pools, members, picks, stats, blog posts, comments, and storage references.
4. If only one pool is affected, prefer pool-scoped repair RPCs over a full database restore.
5. After any restore, run the superadmin health checks and the load smoke test.

## New Project Or Disaster-Recovery Bootstrap

The tracked migration history begins with an immutable marker for a database
that already existed. Therefore, do not use `supabase db reset` as the source of
truth for an empty project and do not edit the applied baseline marker.

For a new Supabase project or a complete disaster recovery:

1. Put the application in maintenance mode and take a fresh full SQL backup.
2. Restore that backup into a temporary project, never directly over the active
   production project.
3. Confirm the restored schema and data before reconciling migration history.
4. Use `supabase migration list` and `supabase migration repair --status applied`
   only for versions whose schema is present in the restored backup. Never mark
   an unapplied schema change as applied.
5. Run `npm run supabase:types`, `npm run quality:rpc`, the application test
   suite, and the checks below against the temporary project.
6. Cut over only after auth, database, storage, cron secrets, and URLs have all
   been verified.

The SQL backup contains sensitive production information. Keep it encrypted and
out of git. Supabase Storage objects require a separate export and restore.

## What To Check After Recovery

- Superadmin page: cron health has recent successful runs.
- Superadmin page: score feed health has no stale final games.
- Superadmin page: schedule audit has no future result issues.
- My Pools page loads for a real member.
- A pool standings page loads and shows the expected member/entry count.
- Blog home and at least one blog post load.

## Storage

Database dumps do not automatically copy Supabase Storage objects. Profile images, pool images, and blog images live in Supabase Storage buckets. For a full disaster recovery plan, export storage bucket objects from Supabase before major public launches.

## Notes

- Keep backup files off git and out of chat.
- Treat every backup as sensitive user data.
- Supabase automated backups are still valuable, but manual backups give us a known restore point before risky operations.
