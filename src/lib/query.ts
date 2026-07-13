import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30, // Keep cache 30 min for offline access
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // 1s, 2s, 4s... max 30s
      refetchOnWindowFocus: false, // Avoid unnecessary refetches on mobile tab switch
      networkMode: 'offlineFirst', // Serve stale cache immediately when offline
      throwOnError: false, // Don't throw — let components handle gracefully
    },
    mutations: {
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000), // 1s, 2s, 4s... max 10s
      networkMode: 'offlineFirst',
    },
  },
})
