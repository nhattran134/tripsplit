import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { nanoid } from 'nanoid'
import { useAppStore } from '@/lib/store'
import { supabase, ensureAnonymousAuth } from '@/lib/supabase'

export function HomePage() {
  const { myTrips, addTrip } = useAppStore()
  const navigate = useNavigate()
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('VND')
  const [memberName, setMemberName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async () => {
    if (!name.trim() || !memberName.trim()) {
      setError('Trip name and your name are required')
      return
    }

    setLoading(true)
    setError('')

    try {
      const authUid = await ensureAnonymousAuth()
      const inviteCode = nanoid(21)

      // Create trip
      const { data: trip, error: tripError } = await supabase
        .from('trips')
        .insert({ name: name.trim(), base_currency: currency, invite_code: inviteCode })
        .select()
        .single()

      if (tripError || !trip) throw new Error(tripError?.message || 'Failed to create trip')

      // Create first member (becomes admin via trigger)
      const { error: memberError } = await supabase
        .from('members')
        .insert({ trip_id: trip.id, auth_uid: authUid, name: memberName.trim() })

      if (memberError) throw new Error(memberError.message)

      // Save to local store
      addTrip({ id: trip.id, name: trip.name, invite_code: inviteCode, joined_at: new Date().toISOString() })

      // Navigate to dashboard
      navigate(`/trip/${trip.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">TripSplit</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors"
        >
          + New Trip
        </button>
      </div>

      {/* Trip List */}
      {myTrips.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <p className="text-4xl mb-4">✈️</p>
          <p className="font-medium">No trips yet</p>
          <p className="text-sm">Create a trip or join one with a link</p>
        </div>
      ) : (
        <div className="space-y-3">
          {myTrips.map((trip) => (
            <button
              key={trip.id}
              onClick={() => navigate(`/trip/${trip.id}`)}
              className="w-full text-left p-4 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-indigo-300 transition-colors"
            >
              <p className="font-semibold">{trip.name}</p>
              <p className="text-sm text-slate-500">Joined {new Date(trip.joined_at).toLocaleDateString()}</p>
            </button>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold">New Trip</h2>

            <div>
              <label className="text-sm font-medium text-slate-600 dark:text-slate-300">Trip Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Bali 2026"
                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-600 dark:text-slate-300">Your Name</label>
              <input
                type="text"
                value={memberName}
                onChange={(e) => setMemberName(e.target.value)}
                placeholder="Nhat"
                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-600 dark:text-slate-300">Base Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                <option value="VND">VND - Vietnamese Dong</option>
                <option value="USD">USD - US Dollar</option>
                <option value="EUR">EUR - Euro</option>
                <option value="JPY">JPY - Japanese Yen</option>
                <option value="THB">THB - Thai Baht</option>
                <option value="SGD">SGD - Singapore Dollar</option>
                <option value="KRW">KRW - Korean Won</option>
              </select>
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <div className="flex gap-3">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={loading}
                className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
