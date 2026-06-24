import { supabase } from '../lib/supabaseClient'

type ProfileSeed = {
  User_name?: string | null
  username?: string | null
  display_name?: string | null
  first_name?: string | null
  last_name?: string | null
  avatar_url?: string | null
}

function firstNonEmpty(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function normalizeUsername(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : null
}

function isDuplicateUsernameError(error: { message?: string } | null | undefined) {
  const message = (error?.message || '').toLowerCase()
  return message.includes('profiles_username_lower_unique') || message.includes('profiles_username_normalized_unique') || message.includes('duplicate key') || message.includes('unique constraint')
}

export async function ensureProfile() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { ok: false, error: userError?.message || 'No user is signed in' }
  }

  const metadata = user.user_metadata || {}
  const emailName = user.email?.split('@')[0] || 'Player'
  const displayName = firstNonEmpty(metadata.username, metadata.name, metadata.full_name, `${metadata.first_name || ''} ${metadata.last_name || ''}`, emailName) || 'Player'
  const username = normalizeUsername(firstNonEmpty(metadata.username, displayName)) || displayName
  const fallbackUsername = normalizeUsername(`${username} ${user.id.slice(0, 4)}`) || `Player ${user.id.slice(0, 8)}`
  const firstName = firstNonEmpty(metadata.first_name, metadata.given_name)
  const lastName = firstNonEmpty(metadata.last_name, metadata.family_name)
  const avatarUrl = firstNonEmpty(metadata.avatar_url, metadata.picture)

  const { data: existing, error: existingError } = await supabase
    .from('profiles')
    .select('User_name, username, display_name, first_name, last_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle<ProfileSeed>()

  if (existingError) return { ok: false, error: existingError.message }

  if (!existing) {
    const insertPayload = {
      id: user.id,
      User_name: displayName,
      username,
      display_name: username,
      first_name: firstName,
      last_name: lastName,
      avatar_url: avatarUrl,
    }
    const { error } = await supabase.from('profiles').insert(insertPayload)
    if (error && isDuplicateUsernameError(error)) {
      const retry = await supabase.from('profiles').insert({ ...insertPayload, username: fallbackUsername, display_name: fallbackUsername })
      if (retry.error) return { ok: false, error: retry.error.message }
      return { ok: true }
    }
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }

  const updates: ProfileSeed = {}
  if (!existing.User_name) updates.User_name = displayName
  if (!existing.username) updates.username = username
  if (!existing.display_name) updates.display_name = username
  if (!existing.first_name && firstName) updates.first_name = firstName
  if (!existing.last_name && lastName) updates.last_name = lastName
  if (!existing.avatar_url && avatarUrl) updates.avatar_url = avatarUrl

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase.from('profiles').update(updates).eq('id', user.id)
    if (error && isDuplicateUsernameError(error) && updates.username) {
      const retryUpdates = { ...updates, username: fallbackUsername, display_name: fallbackUsername }
      const retry = await supabase.from('profiles').update(retryUpdates).eq('id', user.id)
      if (retry.error) return { ok: false, error: retry.error.message }
      return { ok: true }
    }
    if (error) return { ok: false, error: error.message }
  }

  return { ok: true }
}
