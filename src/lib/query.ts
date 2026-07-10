import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30, // Keep cache 30 min for offline access
      retry: 1, // Faster failure on mobile (was 2)
      refetchOnWindowFocus: false, // Avoid unnecessary refetches on mobile tab switch
      networkMode: 'offlineFirst', // Serve stale cache immediately when offline
    },
    mutations: {
      retry: 1,
      networkMode: 'offlineFirst',
    },
  },
})
