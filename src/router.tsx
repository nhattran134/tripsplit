import { lazy, Suspense } from 'react'
import { createBrowserRouter, useRouteError } from 'react-router-dom'
import { Shell } from '@/components/layout/Shell'

const HomePage = lazy(() => import('@/pages/HomePage').then(m => ({ default: m.HomePage })))
const JoinTripPage = lazy(() => import('@/pages/JoinTripPage').then(m => ({ default: m.JoinTripPage })))
const TripDashboardPage = lazy(() => import('@/pages/TripDashboardPage').then(m => ({ default: m.TripDashboardPage })))
const AddExpensePage = lazy(() => import('@/pages/AddExpensePage').then(m => ({ default: m.AddExpensePage })))
const AddDepositPage = lazy(() => import('@/pages/AddDepositPage').then(m => ({ default: m.AddDepositPage })))
const MembersPage = lazy(() => import('@/pages/MembersPage').then(m => ({ default: m.MembersPage })))
const SettleUpPage = lazy(() => import('@/pages/SettleUpPage').then(m => ({ default: m.SettleUpPage })))
const HistoryPage = lazy(() => import('@/pages/HistoryPage').then(m => ({ default: m.HistoryPage })))
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })))
const GomokuPage = lazy(() => import('@/pages/GomokuPage').then(m => ({ default: m.GomokuPage })))
const GameRoomPage = lazy(() => import('@/pages/GameRoomPage').then(m => ({ default: m.GameRoomPage })))
const CreateGameRoomPage = lazy(() => import('@/pages/GameRoomPage').then(m => ({ default: m.CreateGameRoomPage })))
const EditExpensePage = lazy(() => import('@/pages/EditExpensePage').then(m => ({ default: m.EditExpensePage })))

function RouteErrorFallback() {
  const error = useRouteError() as Error | undefined
  
  const handleClearAndReload = () => {
    try {
      localStorage.removeItem('REACT_QUERY_OFFLINE_CACHE')
      // Don't remove 'tripsplit-auth' — that would log them out!
      if ('caches' in window) {
        caches.keys().then(keys => keys.forEach(key => caches.delete(key)))
      }
    } catch (e) { /* ignore */ }
    window.location.href = '/'
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-900">
      <div className="max-w-sm w-full text-center space-y-4">
        <p className="text-4xl">😵</p>
        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-200">Something went wrong</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          The app encountered an error. This is usually fixed by clearing the cache.
        </p>
        {error?.message && (
          <p className="text-xs text-slate-400 bg-slate-100 dark:bg-slate-800 rounded p-2 font-mono break-all">
            {error.message}
          </p>
        )}
        <button
          onClick={handleClearAndReload}
          className="w-full py-3 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors"
        >
          Clear Cache & Reload
        </button>
        <button
          onClick={() => window.location.href = '/'}
          className="w-full py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 text-sm"
        >
          Go Home
        </button>
      </div>
    </div>
  )
}

function SuspenseWrapper({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
        </div>
      }
    >
      {children}
    </Suspense>
  )
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    errorElement: <RouteErrorFallback />,
    children: [
      { index: true, element: <SuspenseWrapper><HomePage /></SuspenseWrapper> },
      { path: 'trip/:tripId', element: <SuspenseWrapper><TripDashboardPage /></SuspenseWrapper> },
      { path: 'trip/:tripId/expense/new', element: <SuspenseWrapper><AddExpensePage /></SuspenseWrapper> },
      { path: 'trip/:tripId/expense/:expenseId/edit', element: <SuspenseWrapper><EditExpensePage /></SuspenseWrapper> },
      { path: 'trip/:tripId/deposit/new', element: <SuspenseWrapper><AddDepositPage /></SuspenseWrapper> },
      { path: 'trip/:tripId/members', element: <SuspenseWrapper><MembersPage /></SuspenseWrapper> },
      { path: 'trip/:tripId/settle', element: <SuspenseWrapper><SettleUpPage /></SuspenseWrapper> },
      { path: 'trip/:tripId/history', element: <SuspenseWrapper><HistoryPage /></SuspenseWrapper> },
      { path: 'trip/:tripId/settings', element: <SuspenseWrapper><SettingsPage /></SuspenseWrapper> },
      { path: 'trip/:tripId/games/gomoku', element: <SuspenseWrapper><GomokuPage /></SuspenseWrapper> },
    ],
  },
  { path: '/t/:inviteCode', element: <SuspenseWrapper><JoinTripPage /></SuspenseWrapper>, errorElement: <RouteErrorFallback /> },
  { path: '/play/new', element: <SuspenseWrapper><CreateGameRoomPage /></SuspenseWrapper>, errorElement: <RouteErrorFallback /> },
  { path: '/play/:roomCode', element: <SuspenseWrapper><GameRoomPage /></SuspenseWrapper>, errorElement: <RouteErrorFallback /> },
])
