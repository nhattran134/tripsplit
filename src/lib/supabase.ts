import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Copy .env.example to .env.local and fill in values.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})

/**
 * Ensure anonymous session exists. Creates one if not.
 * Returns the user ID (auth.uid).
 */
export async function ensureAnonymousAuth(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()

  if (session?.user) {
    return session.user.id
  }

  const { data, error } = await supabase.auth.signInAnonymously()
  if (error || !data.user) {
    throw new Error('Failed to create anonymous session')
  }

  return data.user.id
}
