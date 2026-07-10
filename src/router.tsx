import { createBrowserRouter } from 'react-router-dom'
import { Shell } from '@/components/layout/Shell'
import { HomePage } from '@/pages/HomePage'
import { JoinTripPage } from '@/pages/JoinTripPage'
import { TripDashboardPage } from '@/pages/TripDashboardPage'
import { AddExpensePage } from '@/pages/AddExpensePage'
import { AddDepositPage } from '@/pages/AddDepositPage'
import { MembersPage } from '@/pages/MembersPage'
import { SettleUpPage } from '@/pages/SettleUpPage'
import { HistoryPage } from '@/pages/HistoryPage'
import { SettingsPage } from '@/pages/SettingsPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'trip/:tripId', element: <TripDashboardPage /> },
      { path: 'trip/:tripId/expense/new', element: <AddExpensePage /> },
      { path: 'trip/:tripId/deposit/new', element: <AddDepositPage /> },
      { path: 'trip/:tripId/members', element: <MembersPage /> },
      { path: 'trip/:tripId/settle', element: <SettleUpPage /> },
      { path: 'trip/:tripId/history', element: <HistoryPage /> },
      { path: 'trip/:tripId/settings', element: <SettingsPage /> },
    ],
  },
  { path: '/t/:inviteCode', element: <JoinTripPage /> },
])
