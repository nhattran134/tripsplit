import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface TripReference {
  id: string
  name: string
  invite_code: string
  joined_at: string
}

interface AppState {
  // Trips the user has joined (persisted in localStorage)
  myTrips: TripReference[]
  addTrip: (trip: TripReference) => void
  removeTrip: (id: string) => void

  // Current member ID for the active trip
  currentMemberId: string | null
  setCurrentMemberId: (id: string | null) => void

  // Language preference
  language: 'en' | 'vi'
  setLanguage: (lang: 'en' | 'vi') => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      myTrips: [],
      addTrip: (trip) =>
        set((state) => ({
          myTrips: state.myTrips.some((t) => t.id === trip.id)
            ? state.myTrips
            : [...state.myTrips, trip],
        })),
      removeTrip: (id) =>
        set((state) => ({
          myTrips: state.myTrips.filter((t) => t.id !== id),
        })),

      currentMemberId: null,
      setCurrentMemberId: (id) => set({ currentMemberId: id }),

      language: 'en',
      setLanguage: (lang) => set({ language: lang }),
    }),
    { name: 'tripsplit-store' }
  )
)
