import { useNavigate, useLocation, useParams } from 'react-router-dom'

const navItems = [
  { path: '', label: 'Dashboard', icon: '📊' },
  { path: '/expense/new', label: 'Expense', icon: '💸' },
  { path: '/deposit/new', label: 'Deposit', icon: '💰' },
  { path: '/members', label: 'Members', icon: '👥' },
  { path: '/settle', label: 'Settle', icon: '🤝' },
]

export function BottomNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const { tripId } = useParams()

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 safe-area-bottom">
      <div className="max-w-lg mx-auto flex justify-around py-2">
        {navItems.map((item) => {
          const fullPath = `/trip/${tripId}${item.path}`
          const isActive = location.pathname === fullPath

          return (
            <button
              key={item.path}
              onClick={() => navigate(fullPath)}
              className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-colors ${
                isActive
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
