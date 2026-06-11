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
  const displayName = firstNonEmpty(metadata.name, metadata.full_name, `${metadata.first_name || ''} ${metadata.last_name || ''}`, emailName) || 'Player'
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
    const { error } = await supabase.from('profiles').insert({
      id: user.id,
      User_name: displayName,
      username: displayName,
      display_name: displayName,
      first_name: firstName,
      last_name: lastName,
      avatar_url: avatarUrl,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }

  const updates: ProfileSeed = {}
  if (!existing.User_name) updates.User_name = displayName
  if (!existing.username) updates.username = displayName
  if (!existing.display_name) updates.display_name = displayName
  if (!existing.first_name && firstName) updates.first_name = firstName
  if (!existing.last_name && lastName) updates.last_name = lastName
  if (!existing.avatar_url && avatarUrl) updates.avatar_url = avatarUrl

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase.from('profiles').update(updates).eq('id', user.id)
    if (error) return { ok: false, error: error.message }
  }

  return { ok: true }
}
