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
    storageKey: 'tripsplit-auth', // Explicit key to avoid conflicts
    detectSessionInUrl: false, // No OAuth redirects
  },
})

/**
 * Initialize auth session on app load.
 * Creates anonymous session if none exists.
 * Retries with exponential backoff on failure.
 */
let authInitialized = false
export async function initAuth(): Promise<void> {
  if (authInitialized) return
  
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        authInitialized = true
        return
      }

      // No session — create anonymous one
      const { data, error } = await supabase.auth.signInAnonymously()
      if (error) throw error
      if (data.user) {
        authInitialized = true
        return
      }
    } catch (e) {
      // Retry with backoff
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
      }
    }
  }
  
  // Last resort: still set flag to prevent infinite init loops
  authInitialized = true
}

/**
 * Get current auth UID, ensuring session exists first.
 */
export async function getAuthUid(): Promise<string | undefined> {
  await initAuth()
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user?.id
}

/**
 * Ensure anonymous session exists. Creates one if not.
 * Returns the user ID (auth.uid).
 */
export async function ensureAnonymousAuth(): Promise<string> {
  await initAuth()
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
