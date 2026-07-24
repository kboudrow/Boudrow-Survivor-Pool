# Traffic Readiness

Use this checklist before public testing, NFL Sundays, and any social push that may spike traffic.

## Load Test

Local:

```bash
LOAD_TEST_TARGET=http://localhost:3000 npm run load:test
```

Production smoke:

```bash
LOAD_TEST_TARGET=https://www.survivesunday.com LOAD_TEST_CONCURRENCY=40 LOAD_TEST_ROUNDS=5 npm run load:test
```

Production heavier read test:

```bash
LOAD_TEST_TARGET=https://www.survivesunday.com LOAD_TEST_CONCURRENCY=80 LOAD_TEST_ROUNDS=6 LOAD_TEST_P95_BUDGET_MS=3000 npm run load:test
```

Useful path mix:

```bash
LOAD_TEST_PATHS="/,/pools,/join/search,/blog,/faq,/survivor-pool-rules,/demo-league"
```

Authenticated pages need `LOAD_TEST_AUTH_HEADER`, but do not put real user tokens in chat or git.

## What Passing Means

- No 5xx responses.
- No auth/session errors on public pages.
- p95 under the configured budget.
- `/blog`, `/join/search`, and `/demo-league` stay responsive.

## What To Check During Spikes

- Vercel Analytics and Speed Insights.
- Superadmin cron health.
- Superadmin score feed health.
- Recent production event logs.
- Supabase database CPU, connection count, and slow queries.

## Database Prep

The migration `20260724000100_cron_backup_performance_hardening.sql` adds indexes for the read-heavy paths:

- My Pools dashboard.
- Pool picks and standings.
- Pool members and stats.
- NFL schedule lookups.
- Blog feed/comments.
- Production event logs.

If p95 climbs during beta, capture the slow path from `npm run load:test` first, then optimize that exact query or RPC.
