import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { getQueuedMutations, removeMutation } from '@/lib/offline'

export function useOfflineSync() {
  useEffect(() => {
    const replayMutations = async () => {
      const mutations = await getQueuedMutations()
      if (mutations.length === 0) return

      for (const mutation of mutations) {
        try {
          if (mutation.type === 'insert') {
            const { error } = await supabase.from(mutation.table).insert(mutation.data)
            if (!error || error.code === '23505') { // success or duplicate (already synced)
              await removeMutation(mutation.id)
            }
          } else if (mutation.type === 'soft_delete') {
            const { error } = await supabase
              .from(mutation.table)
              .update({ deleted_at: new Date().toISOString() })
              .eq('id', mutation.data.id as string)
              .is('deleted_at', null)
            if (!error) await removeMutation(mutation.id)
          }
        } catch {
          // Network still down, stop retrying
          break
        }
      }
    }

    // Replay on mount and when coming back online
    replayMutations()
    window.addEventListener('online', replayMutations)
    return () => window.removeEventListener('online', replayMutations)
  }, [])
}
