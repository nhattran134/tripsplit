import { lazy, Suspense } from 'react'
import { createBrowserRouter } from 'react-router-dom'
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
  { path: '/t/:inviteCode', element: <SuspenseWrapper><JoinTripPage /></SuspenseWrapper> },
  { path: '/play/new', element: <SuspenseWrapper><CreateGameRoomPage /></SuspenseWrapper> },
  { path: '/play/:roomCode', element: <SuspenseWrapper><GameRoomPage /></SuspenseWrapper> },
])
