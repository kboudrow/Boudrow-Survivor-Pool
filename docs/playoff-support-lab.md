# Playoff Support Lab

This branch starts playoff support without changing production behavior.

## Isolation

- Branch: `codex-playoff-support-lab`
- Feature flag: `NEXT_PUBLIC_PLAYOFFS_LAB=1`
- Default behavior with the flag off: regular season only, Weeks 1-18
- Database SQL is in `supabase/lab/playoff-support.sql`, not `supabase/migrations/`

## Proposed Round Mapping

- Week 19: Wild Card
- Week 20: Divisional
- Week 21: Conference Championship
- Week 22: Super Bowl

## Product Rules

- Pools with `include_playoffs = false` end after Week 18.
- Pools with `include_playoffs = true` can continue through Week 22.
- Used teams carry forward into playoff rounds.
- Playoff rounds require one pick per active entry unless we explicitly add a playoff double-pick rule later.
- Rolling deadline pools keep kickoff-level locking.
- Fixed deadline pools should use the first kickoff of the playoff round.

## Still Needed

- Move lab SQL into a real migration only when ready.
- Add playoff game import/schedule handling once actual matchups exist.
- Update all test-mode scoring RPCs to use `pool_max_week` instead of Week 18.
- Decide final behavior if multiple entries survive the Super Bowl.
- Add tests for Week 18 to Wild Card rollover, Super Bowl completion, no-picks, and multiple entries.
