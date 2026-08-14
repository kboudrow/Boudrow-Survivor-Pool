# NFL Survivor Pool

A Next.js and Supabase app for running NFL survivor pools. Users can sign in, create pools, join public or private pools, make weekly picks, view standings, manage profile settings, and archive or clone pools for future seasons.

## Current Features

- Email/password and Google sign-in through Supabase Auth
- Pool creation with public/private visibility
- Optional private pool password flow
- Join/search page for discoverable pools
- My Pools dashboard with picks, standings, and member views
- Weekly draft picks with duplicate-team checks
- NFL game schedule support through the `nfl_games` table
- Profile page with account settings and pool history
- Admin page for owner actions like double-pick weeks and archive/unarchive
- Archive page with "run it back" cloning for a new season
- Privacy and Terms pages

## Tech Stack

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS 4
- Supabase Auth and Postgres
- Vercel deployment

## Project Structure

```text
app/                    Next.js app routes and pages
app/pools/              Pool dashboard, pool detail, create pool, admin
app/join/               Pool search and join routes
app/profile/            User account and history page
lib/                    Shared Supabase client and helpers
public/                 Static images and logos
supabase/               Local Supabase config and generated database types
```

## Getting Started

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.local.example .env.local
```

If `.env.local.example` does not exist yet, create `.env.local` manually:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Run the development server:

```bash
npm run dev
```

Open the local URL shown in the terminal, usually:

```text
http://localhost:3000
```

## Useful Commands

```bash
npm run dev
npm run lint
npm run build
npm run start
npm run load:test
npm run backup:db
```

Use `npm run lint` and `npm run build` before deploying or pushing major changes.

## Supabase

The app expects a Supabase project with tables, views, functions, and RLS policies for pools, members, picks, profiles, NFL games, admin actions, and history.

Generated database types are stored at:

```text
supabase/database.types.ts
```

To regenerate types after database changes:

```bash
npx supabase login
npx supabase link --project-ref your_project_ref
npx supabase gen types typescript --linked --schema public > supabase/database.types.ts
```

Do not commit service role keys. Public anon keys should live in `.env.local` locally and in Vercel environment variables for deployment.

## Deployment

This project is intended to deploy on Vercel.

Set these environment variables in Vercel:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SITE_URL
SUPABASE_SERVICE_ROLE_KEY
CRON_SECRET
SUPABASE_CRON_SECRET
NEXT_PUBLIC_SENTRY_DSN
SENTRY_DSN
SENTRY_ORG
SENTRY_PROJECT
SENTRY_AUTH_TOKEN
```

Then deploy from the GitHub repository connected to Vercel.

`CRON_SECRET` is required for scheduled pick locking and scoring. The cron route rejects requests without `Authorization: Bearer <CRON_SECRET>`.

Supabase Cron provides the NFL-season schedule: score sync every 10 minutes and pick locking every 5 minutes. `vercel.json` retains a once-daily Vercel Hobby fallback, and the routes are safe to run repeatedly. Supabase Vault must contain `survive_sunday_cron_secret` with the same value as Vercel's dedicated `SUPABASE_CRON_SECRET`. See `docs/cron-setup.md`.

The superadmin page shows cron health, score-feed health, and recent production event logs.

Sentry error reporting and performance tracing are opt-in and remain disabled until a DSN is configured. Production traces are sampled at 10%. The configuration intentionally excludes default personal information, form-input breadcrumbs, request bodies, cookies, authorization headers, and URL query strings from both errors and traces. Session Replay is disabled. `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` are required in the production build for readable source-mapped browser stack traces and release association.

AdSense is opt-in. Set `NEXT_PUBLIC_ENABLE_ADSENSE=true`, `NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT`, and the relevant `NEXT_PUBLIC_AD_SLOT_*` values only when ads should render.

## Development Notes

- Sensitive write workflows are implemented as Supabase RPC functions, including pool creation, joining, picks, entries, profile updates, blog writes, archive/clone behavior, and admin actions.
- Row Level Security policies in Supabase are essential. The browser anon key is not a substitute for RLS.
- Keep the README free of real keys or private credentials.
- Pools are currently free. Stripe environment variables may remain unset unless payment functionality is intentionally re-enabled later.

## Backups And Recovery

Use `npm run backup:db` before migrations, broad repairs, schedule imports, or public test events. Dumps are written to `/backups`, which is intentionally gitignored. See `docs/backup-recovery.md` for the full operator runbook.

## Load Testing

Use `npm run load:test` against local or production targets to check read-heavy pages before game-day traffic. Example:

```bash
LOAD_TEST_TARGET=https://www.survivesunday.com LOAD_TEST_CONCURRENCY=40 LOAD_TEST_ROUNDS=5 npm run load:test
```
