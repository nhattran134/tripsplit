import { Outlet, useLocation } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { OfflineBadge } from '@/components/common/OfflineBadge'
import { LanguageToggle } from '@/components/common/LanguageToggle'
import { useOfflineSync } from '@/hooks/useOfflineSync'

export function Shell() {
  const location = useLocation()
  const isTripRoute = location.pathname.startsWith('/trip/')
  const isHome = location.pathname === '/'

  useOfflineSync()

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 pwa-top-padding">
      <OfflineBadge />
      <main className={`px-4 pt-6 max-w-lg mx-auto ${isTripRoute ? 'pb-safe' : 'pb-8'}`}>
        <Outlet />
      </main>
      {isTripRoute && <BottomNav />}
      {isHome && (
        <div className="fixed bottom-6 right-4 safe-area-bottom z-10">
          <LanguageToggle />
        </div>
      )}
    </div>
  )
}
