import { createClient } from '@supabase/supabase-js'

const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing ${name}. See docs/staging.md.`)
  return value
}

const stagingUrl = required('STAGING_SUPABASE_URL')
const stagingAnonKey = required('STAGING_SUPABASE_ANON_KEY')
const stagingServiceKey = required('STAGING_SUPABASE_SERVICE_ROLE_KEY')
const testPassword = required('STAGING_TEST_PASSWORD')
const productionUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()

if (productionUrl && new URL(productionUrl).host === new URL(stagingUrl).host) {
  throw new Error('Refusing to seed: STAGING_SUPABASE_URL points at the production project.')
}
if (process.env.ALLOW_STAGING_SEED !== 'true') {
  throw new Error('Set ALLOW_STAGING_SEED=true after confirming the staging project URL.')
}

const admin = createClient(stagingUrl, stagingServiceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const identities = [
  ['commissioner@staging.survivesunday.test', 'Commissioner QA'],
  ['taylor@staging.survivesunday.test', 'Taylor Test'],
  ['lebron@staging.survivesunday.test', 'LeBron Test'],
  ['serena@staging.survivesunday.test', 'Serena Test'],
  ['tom@staging.survivesunday.test', 'Tom Test'],
  ['beyonce@staging.survivesunday.test', 'Beyonce Test'],
]

const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (listError) throw listError
const existingByEmail = new Map(listed.users.map((user) => [user.email?.toLowerCase(), user]))
const users = []

for (const [email, username] of identities) {
  let user = existingByEmail.get(email)
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ email, password: testPassword, email_confirm: true, user_metadata: { username } })
    if (error) throw error
    user = data.user
  }
  const { error: profileError } = await admin.from('profiles').upsert({
    id: user.id,
    username,
    display_name: username,
    "User_name": username,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' })
  if (profileError) throw profileError
  users.push({ user, email, username })
}

const commissioner = createClient(stagingUrl, stagingAnonKey, { auth: { persistSession: false, autoRefreshToken: false } })
const { error: signInError } = await commissioner.auth.signInWithPassword({ email: identities[0][0], password: testPassword })
if (signInError) throw signInError

let { data: existingPool, error: existingPoolError } = await admin.from('pools').select('id').eq('name', 'Automated Staging Pool').eq('created_by', users[0].user.id).maybeSingle()
if (existingPoolError) throw existingPoolError

if (!existingPool) {
  const { data: poolId, error: createError } = await commissioner.rpc('create_pool_with_owner', {
    p_name: 'Automated Staging Pool',
    p_is_public: true,
    p_password: null,
    p_start_week: 1,
    p_include_playoffs: true,
    p_strikes_allowed: '1',
    p_tie_rule: 'loss',
    p_deadline_mode: 'rolling',
    p_deadline_fixed: null,
    p_notes: 'Disposable deterministic staging pool.',
    p_image_url: null,
    p_season: 2026,
    p_double_pick_weeks: [4, 8],
    p_max_members: 25,
    p_allow_multiple_entries: true,
    p_max_entries_per_user: 2,
  })
  if (createError) throw createError
  existingPool = { id: poolId }
}

const { error: testModeError } = await admin.from('pools').update({ test_mode: true, test_current_week: 1, test_now_at: null }).eq('id', existingPool.id)
if (testModeError) throw testModeError

for (const identity of users.slice(1)) {
  const client = createClient(stagingUrl, stagingAnonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error: playerSignInError } = await client.auth.signInWithPassword({ email: identity.email, password: testPassword })
  if (playerSignInError) throw playerSignInError
  const { error: joinError } = await client.rpc('join_pool', { p_pool_id: existingPool.id, p_password: null })
  if (joinError && !/already|member/i.test(joinError.message)) throw joinError
}

console.log(`Staging seed ready: ${existingPool.id}`)
console.log(`Accounts: ${identities.map(([email]) => email).join(', ')}`)
