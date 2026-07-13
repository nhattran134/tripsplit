import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import './i18n'
import { router } from './router'
import { queryClient } from './lib/query'
import { supabase, initAuth } from './lib/supabase'
import './index.css'

// Apply theme from localStorage on load
;(() => {
  const pref = localStorage.getItem('theme-preference') || 'system'
  if (pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
})()

// Initialize auth session (retries on failure)
initAuth()

// When auth state changes (session restored after token refresh), invalidate session queries
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
    queryClient.invalidateQueries({ queryKey: ['session'] })
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
