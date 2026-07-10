import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export function SettingsPage() {
  const { tripId } = useParams<{ tripId: string }>()

  const { data: trip } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: async () => {
      const { data, error } = await supabase.from('trips').select('*').eq('id', tripId).single()
      if (error) throw error
      return data
    },
  })

  const inviteLink = trip ? `${window.location.origin}/t/${trip.invite_code}` : ''

  return (
    <div className="py-4 space-y-4">
      <h1 className="text-xl font-bold">Settings</h1>
      {trip && (
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 space-y-3">
          <div>
            <p className="text-sm text-slate-500">Trip Name</p>
            <p className="font-medium">{trip.name}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">Base Currency</p>
            <p className="font-medium">{trip.base_currency}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">Invite Link</p>
            <p className="font-mono text-xs break-all">{inviteLink}</p>
          </div>
        </div>
      )}
    </div>
  )
}
