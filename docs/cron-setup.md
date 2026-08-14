# Cron Setup

The cron routes are protected by `CRON_SECRET` and are safe to call repeatedly.

## Routes

- Score sync: `GET https://www.survivesunday.com/api/cron/sync-scores`
- Pick locking: `GET https://www.survivesunday.com/api/cron/lock-picks`

Each request must include:

```text
Authorization: Bearer <CRON_SECRET>
```

Never paste the real secret into docs, git, screenshots, or chat.

## Automation Layers

Supabase Cron is the primary production scheduler:

- `survive-sunday-sync-scores`: every 10 minutes.
- `survive-sunday-lock-picks`: every 5 minutes, offset by two minutes so it does not start with score sync.

Migration `20260814000400_supabase_cron_scheduler.sql` creates both jobs. It stores the public production URL in Supabase Vault automatically. Before the jobs can call the app, add one encrypted Vault secret:

- Name: `survive_sunday_cron_secret`
- Value: exactly the same value as Vercel's `SUPABASE_CRON_SECRET`

The secret is read only when a job runs. It is not stored in source control or in the visible cron command.

`SUPABASE_CRON_SECRET` is deliberately separate from `CRON_SECRET`. Supabase Cron uses the first; GitHub Actions and the Vercel daily fallback use the second. Either bearer secret authorizes only the two allow-listed maintenance routes.

Use **Supabase Dashboard → Integrations → Cron → Jobs** to inspect job history. Successful HTTP responses are also recorded by the application in `app_event_logs` and displayed under superadmin Automation Health.

## Fallback Automation

`vercel.json` keeps one daily fallback run for each route because the current Vercel Hobby plan rejects more frequent schedules.

GitHub Actions can provide a temporary backup cadence:

- `.github/workflows/sync-nfl-scores.yml`: every 10 minutes.
- `.github/workflows/lock-picks.yml`: every 5 minutes.

Both workflows fail visibly when the repository `CRON_SECRET` is missing. The same secret must be configured in GitHub Actions and the production Vercel project. GitHub scheduled workflows can be delayed during busy periods, so they should not be the primary deadline scheduler.

Daily fallback is useful, but it is not enough for live NFL Sundays.

## Recommended Game-Day Cadence

The required NFL-season cadence is:

- `/api/cron/sync-scores`: every 10 minutes.
- `/api/cron/lock-picks`: every 5 minutes.

Both routes are idempotent:

- Running score sync repeatedly updates game statuses and scores as ESPN changes.
- Running pick locking repeatedly finalizes only newly locked picks and adjudicates completed weeks.

## What To Watch

The superadmin page has an Automation Health section. It should show:

- Last successful run.
- Last error.
- Next expected run.
- Whether the job is healthy, late, warning, or missing.

If a job is late during the season, check:

- External scheduler history.
- Vercel function logs.
- Supabase `app_event_logs`.
- `CRON_SECRET` mismatch.
- ESPN score feed availability.
