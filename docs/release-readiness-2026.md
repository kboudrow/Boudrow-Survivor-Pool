# 2026 Release Readiness

Verified on August 9, 2026:

- Lint, 13 automated tests, RPC coverage, and the production build pass.
- Three full 18-week authenticated Troll simulations pass with integrity checks after every week.
- Missing picks, tie-as-loss, unscore/re-score, commissioner correction, reset, and winner recalculation pass.
- The 2026 schedule has 18 valid weeks and zero production integrity issues.
- Database RLS and policy audits pass.
- A 200-request production smoke test completed with zero failures and a 1.715-second p95.
- Desktop and 390px mobile browser checks have no horizontal overflow or console warnings.
- A fresh API fallback backup captured 28 Auth users and 32 public relations.

## Required operator checks

- Configure the same `CRON_SECRET` in Vercel production and GitHub Actions.
- Manually run both GitHub workflows and confirm successful protected endpoint responses.
- Complete one signed-in browser rehearsal using a normal player account on desktop and mobile.
- Prefer a full SQL backup after starting Docker Desktop; the API backup is the current fallback.
