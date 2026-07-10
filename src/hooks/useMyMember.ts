import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/**
 * Returns the member IDs that belong to the current session.
 * Checks both legacy auth_uid AND member_sessions table.
 */
export function useMyMemberIds(tripId: string | undefined) {
  const { data: session } = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession()
      return data.session
    },
  })

  const authUid = session?.user?.id

  const { data: myMemberIds = [] } = useQuery({
    queryKey: ['my-members', tripId, authUid],
    enabled: !!tripId && !!authUid,
    queryFn: async () => {
      // Check member_sessions first
      const { data: sessions } = await supabase
        .from('member_sessions')
        .select('member_id')
        .eq('auth_uid', authUid!)

      const sessionMemberIds = (sessions || []).map((s) => s.member_id)

      // Also check legacy auth_uid on members table
      const { data: legacyMembers } = await supabase
        .from('members')
        .select('id')
        .eq('trip_id', tripId!)
        .eq('auth_uid', authUid!)
        .is('deleted_at', null)

      const legacyIds = (legacyMembers || []).map((m) => m.id)

      // Combine and deduplicate
      return [...new Set([...sessionMemberIds, ...legacyIds])]
    },
  })

  return { myMemberIds, authUid }
}
