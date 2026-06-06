import { createClient } from '@supabase/supabase-js'
import { cleanEnvValue } from '@/lib/env'

const supabaseUrl = cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL)
const supabaseAnonKey = cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
