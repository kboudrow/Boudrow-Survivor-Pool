import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { safeReturnTo } from '../lib/authRedirect.ts'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('authentication return paths reject external and malformed redirects', () => {
  assert.equal(safeReturnTo('/join/invite-123', '/pools'), '/join/invite-123')
  assert.equal(safeReturnTo('https://attacker.example', '/pools'), '/pools')
  assert.equal(safeReturnTo('//attacker.example', '/pools'), '/pools')
  assert.equal(safeReturnTo('/%2f%2fattacker.example', '/pools'), '/pools')
  assert.equal(safeReturnTo('/join\\evil', '/pools'), '/pools')
  assert.equal(safeReturnTo(`/${'a'.repeat(501)}`, '/pools'), '/pools')
})

test('every new auth user receives a profile and old gaps are backfilled', async () => {
  const migration = await read('supabase/migrations/20260815000200_auth_profile_reliability.sql')
  const metadataMigration = await read('supabase/migrations/20260815000300_auth_profile_metadata_names.sql')
  assert.match(migration, /after insert on auth\.users/i)
  assert.match(migration, /insert into public\.profiles/i)
  assert.match(migration, /left join public\.profiles p on p\.id = u\.id[\s\S]*where p\.id is null/i)
  assert.match(migration, /when others[\s\S]*return new/i)
  assert.match(migration, /revoke all on function public\.ensure_auth_user_profile\(\) from public, anon, authenticated/i)
  assert.match(metadataMigration, /v_candidate[\s\S]*raw_user_meta_data[\s\S]*when unique_violation/i)
  assert.match(metadataMigration, /p\.username = 'Player ' \|\| left\(p\.id::text, 8\)/i)
})

test('client auth writes are single-flight and profile failures remain retryable', async () => {
  const home = await read('app/page.tsx')
  assert.match(home, /type AuthSubmission =/)
  assert.match(home, /if \(authSubmitting\) return/g)
  assert.match(home, /if \(res\.ok\) ensuredUserIdRef\.current = userId/)
  assert.match(home, /resendConfirmation/)
  assert.match(home, /Continue with Google/)
  assert.match(home, /autoComplete="current-password"/)
  assert.match(home, /autoComplete="new-password"/)
  assert.match(home, /role="alert"/)
  const ensureProfile = await read('lib/ensureProfile.ts')
  assert.match(ensureProfile, /isShellUsername/)
  assert.match(ensureProfile, /validUsernameOrFallback/)
})

test('auth navigation has a neutral loading state instead of showing signed-out UI', async () => {
  const nav = await read('components/AuthNav.tsx')
  const loadingBranch = nav.indexOf('if (!loaded)')
  const signedOutBranch = nav.indexOf('if (!isAuthed)')
  assert.ok(loadingBranch >= 0)
  assert.ok(signedOutBranch > loadingBranch)
  assert.match(nav, /aria-label="Checking account"/)
  assert.match(nav, /setEmail\(user\?\.email \?\? null\)[\s\S]*setLoaded\(true\)[\s\S]*void Promise\.all/)
})

test('callback verifies profile readiness and password policy matches the UI', async () => {
  const callback = await read('app/auth/callback/page.tsx')
  const config = await read('supabase/config.toml')
  assert.match(callback, /if \(!profileResult\.ok\)/)
  assert.match(callback, /error_description/)
  assert.match(config, /minimum_password_length = 8/)
  assert.match(config, /password_requirements = "lower_upper_letters_digits_symbols"/)
  assert.match(config, /secure_password_change = true/)
  assert.match(config, /\[auth\.email\.notification\.password_changed\][\s\S]*enabled = true/)
})

test('password recovery preserves the original safe destination', async () => {
  const forgot = await read('app/forgot/page.tsx')
  const reset = await read('app/reset/page.tsx')
  assert.match(forgot, /safeReturnTo/)
  assert.match(forgot, /reset\?returnTo=/)
  assert.match(reset, /safeReturnTo/)
  assert.match(reset, /Continue to Survive Sunday/)
  assert.doesNotMatch(reset, /same device & browser/i)
})
