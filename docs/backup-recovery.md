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

## Recovery Rules

1. Do not restore directly over production while users are active.
2. First restore to a temporary Supabase project when possible.
3. Verify auth users, profiles, pools, members, picks, stats, blog posts, comments, and storage references.
4. If only one pool is affected, prefer pool-scoped repair RPCs over a full database restore.
5. After any restore, run the superadmin health checks and the load smoke test.

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
