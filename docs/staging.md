# Staging Environment

Use a separate Supabase project for destructive commissioner and player lifecycle testing. Never point the staging variables at the production project.

## One-time project setup

1. Create a new Supabase project for Survive Sunday staging.
2. Link the CLI to that project and apply all migrations.
3. Import the 2026 schedule through the existing seed/migration workflow.
4. Create `.env.staging.local` with:

```env
STAGING_SUPABASE_URL=https://your-staging-project.supabase.co
STAGING_SUPABASE_ANON_KEY=your-staging-anon-key
STAGING_SUPABASE_SERVICE_ROLE_KEY=your-staging-service-role-key
STAGING_TEST_PASSWORD=a-strong-disposable-test-password
ALLOW_STAGING_SEED=true
```

The file is ignored by git. Do not paste its values into chat or commit them.

## Seed deterministic accounts and a pool

```bash
npm run staging:seed
```

The script refuses to run when the staging URL matches production. It creates one commissioner, five players, and an idempotent test-mode pool named `Automated Staging Pool` with rolling locks, one allowed strike, multiple entries, and double-pick weeks.

## Browser lifecycle

Test create/join, picks, changes, locks, scoring, elimination, winner declaration, archive/run-back, member removal, and admin corrections here. Reset or reseed whenever destructive tests leave the pool in an inconvenient state.
