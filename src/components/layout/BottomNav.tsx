import { useNavigate, useLocation, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LayoutDashboard, Plus, Wallet, Users, Handshake } from 'lucide-react'

export function BottomNav() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { tripId } = useParams()

  const basePath = `/trip/${tripId}`
  const isActive = (path: string) => location.pathname === `${basePath}${path}`

  const navBtn = (path: string, labelKey: string, Icon: any) => (
    <button
      key={path}
      onClick={() => navigate(`${basePath}${path}`, { replace: true })}
      className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-colors active:scale-95 ${
        isActive(path)
          ? 'text-indigo-600 dark:text-indigo-400'
          : 'text-slate-500 dark:text-slate-400'
      }`}
    >
      <Icon size={20} strokeWidth={isActive(path) ? 2.5 : 2} />
      <span className="text-[10px] font-medium">{t(labelKey)}</span>
    </button>
  )

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm border-t border-slate-200 dark:border-slate-700"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="max-w-lg mx-auto flex justify-around items-end py-2">
        {navBtn('', 'nav.dashboard', LayoutDashboard)}
        {navBtn('/deposit/new', 'nav.deposit', Wallet)}

        {/* Hero center button - Add Expense */}
        <button
          onClick={() => navigate(`${basePath}/expense/new`, { replace: true })}
          className="flex flex-col items-center gap-0.5 -mt-5"
        >
          <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-90 ${
            isActive('/expense/new')
              ? 'bg-indigo-600 ring-2 ring-indigo-300'
              : 'bg-indigo-500 hover:bg-indigo-600'
          }`}>
            <Plus size={24} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="text-[10px] font-medium text-indigo-600 dark:text-indigo-400">{t('nav.expense')}</span>
        </button>

        {navBtn('/members', 'nav.members', Users)}
        {navBtn('/settle', 'nav.settle', Handshake)}
      </div>
    </nav>
  )
}
