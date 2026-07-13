import { Outlet, useLocation } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { OfflineBadge } from '@/components/common/OfflineBadge'
import { ToastContainer } from '@/components/common/Toast'
import { useOfflineSync } from '@/hooks/useOfflineSync'

export function Shell() {
  const location = useLocation()
  const isTripRoute = location.pathname.startsWith('/trip/')

  useOfflineSync()

  return (
    <div className="min-h-screen app-bg text-slate-900 dark:text-slate-100">
      <OfflineBadge />
      <ToastContainer />
      <main className={`relative z-[1] px-4 max-w-lg mx-auto ${isTripRoute ? 'pb-safe' : 'pb-8'}`} style={{ paddingTop: 'calc(env(safe-area-inset-top, 24px) + 12px)' }}>
        <Outlet />
      </main>
      {isTripRoute && <BottomNav />}
    </div>
  )
}
