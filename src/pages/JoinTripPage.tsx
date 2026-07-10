import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, ensureAnonymousAuth } from '@/lib/supabase'
import { useAppStore } from '@/lib/store'

export function JoinTripPage() {
  const { inviteCode } = useParams<{ inviteCode: string }>()
  const navigate = useNavigate()
  const { addTrip } = useAppStore()
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [needsPin, setNeedsPin] = useState(false)

  const handleJoin = async () => {
    if (!name.trim()) {
      setError('Please enter your name')
      return
    }

    setLoading(true)
    setError('')

    try {
      await ensureAnonymousAuth()

      const response = await supabase.functions.invoke('join-trip', {
        body: { invite_code: inviteCode, name: name.trim(), pin: pin || undefined },
      })

      if (response.error) {
        throw new Error(response.error.message)
      }

      const result = response.data

      if (result.error === 'Invalid PIN') {
        setNeedsPin(true)
        setError('This trip requires a PIN')
        setLoading(false)
        return
      }

      if (result.error) {
        throw new Error(result.error)
      }

      // Fetch trip name for local store
      const { data: trip } = await supabase
        .from('trips')
        .select('name, invite_code')
        .eq('id', result.trip_id)
        .single()

      if (trip) {
        addTrip({
          id: result.trip_id,
          name: trip.name,
          invite_code: trip.invite_code,
          joined_at: new Date().toISOString(),
        })
      }

      navigate(`/trip/${result.trip_id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to join trip')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-lg">
        <div className="text-center">
          <p className="text-4xl mb-2">🎒</p>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Join Trip</h1>
          <p className="text-sm text-slate-500">Enter your name to join this group</p>
        </div>

        <div>
          <label className="text-sm font-medium text-slate-600 dark:text-slate-300">Your Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What should the group call you?"
            className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
            autoFocus
          />
        </div>

        {needsPin && (
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-slate-300">Trip PIN</label>
            <input
              type="text"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Enter PIN"
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
        )}

        {error && <p className="text-red-500 text-sm text-center">{error}</p>}

        <button
          onClick={handleJoin}
          disabled={loading}
          className="w-full px-4 py-3 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Joining...' : 'Join Trip'}
        </button>
      </div>
    </div>
  )
}
