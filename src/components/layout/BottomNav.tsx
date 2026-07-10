import { useNavigate, useLocation, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LayoutDashboard, Receipt, Wallet, Users, Handshake } from 'lucide-react'

const navItems = [
  { path: '', labelKey: 'nav.dashboard', Icon: LayoutDashboard },
  { path: '/expense/new', labelKey: 'nav.expense', Icon: Receipt },
  { path: '/deposit/new', labelKey: 'nav.deposit', Icon: Wallet },
  { path: '/members', labelKey: 'nav.members', Icon: Users },
  { path: '/settle', labelKey: 'nav.settle', Icon: Handshake },
]

export function BottomNav() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { tripId } = useParams()

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm border-t border-slate-200 dark:border-slate-700"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="max-w-lg mx-auto flex justify-around py-2">
        {navItems.map((item) => {
          const fullPath = `/trip/${tripId}${item.path}`
          const isActive = location.pathname === fullPath

          return (
            <button
              key={item.path}
              onClick={() => navigate(fullPath, { replace: true })}
              className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-colors active:scale-95 ${
                isActive
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <item.Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[10px] font-medium">{t(item.labelKey)}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
