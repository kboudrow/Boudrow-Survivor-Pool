import { supabase } from '../lib/supabaseClient'

/**
 * Ensures the logged-in user has a row in public.profiles.
 * - Uses the user's Google name if available, otherwise their email.
 * - Works with your RLS policies because it writes as the signed-in user.
 */
export async function ensureProfile() {
  // Get the currently signed-in user from Supabase Auth
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { ok: false, error: userError?.message || 'No user is signed in' }
  }

  // Prefer Google name/full_name; fall back to email
  const displayName =
    (user.user_metadata && (user.user_metadata.name || user.user_metadata.full_name)) ||
    user.email

  // ✅ Fix: use "User_name" to match your table column name
  const { error } = await supabase
    .from('profiles')
    .upsert(
      { id: user.id, User_name: displayName }, // changed from display_name → User_name
      { onConflict: 'id' }
    )

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
