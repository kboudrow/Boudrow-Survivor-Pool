import { supabase } from '@/lib/supabaseClient'

export async function currentUserHasPoolMembership(poolId: string) {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) return false

  const { data, error } = await supabase
    .from('pool_members')
    .select('id')
    .eq('pool_id', poolId)
    .eq('profile_id', user.id)
    .limit(1)
  if (error) throw error
  return (data || []).length > 0
}

