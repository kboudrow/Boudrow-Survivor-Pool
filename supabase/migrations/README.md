# Supabase Migrations

The project now keeps forward database changes in timestamped migrations.

The first migration is a baseline marker because production already had schema
created by historical one-off SQL files. Some of those files are data repairs or
cleanup scripts, so they should not be copied into `migrations/` and replayed.

When Docker Desktop is available, refresh the baseline with:

```bash
npx supabase db dump --linked --schema public --file supabase/migrations/20260718000100_existing_remote_baseline.sql
```

After that, create new forward-only schema changes as additional timestamped
files and apply them with `supabase db query --linked --file <migration.sql>`.

