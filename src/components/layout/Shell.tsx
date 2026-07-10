import { Outlet, useLocation } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { OfflineBadge } from '@/components/common/OfflineBadge'
import { LanguageToggle } from '@/components/common/LanguageToggle'

export function Shell() {
  const location = useLocation()
  const isTripRoute = location.pathname.startsWith('/trip/')
  const isHome = location.pathname === '/'

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
      <OfflineBadge />
      <main className="pb-20 px-4 pt-4 max-w-lg mx-auto">
        <Outlet />
      </main>
      {isTripRoute && <BottomNav />}
      {isHome && (
        <div className="fixed bottom-4 right-4">
          <LanguageToggle />
        </div>
      )}
    </div>
  )
}
