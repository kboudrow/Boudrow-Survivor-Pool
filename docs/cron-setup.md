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

## Current Vercel Fallback

`vercel.json` keeps one daily run for each route because the current Vercel Hobby plan rejects more frequent schedules.

Daily fallback is useful, but it is not enough for live NFL Sundays.

## Recommended Game-Day Cadence

Use Vercel Pro crons or an external scheduler during the NFL season:

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
