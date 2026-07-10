import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export function OfflineBadge() {
  const { t } = useTranslation()
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (isOnline) return null

  return (
    <div
      className="fixed top-0 left-0 right-0 bg-amber-500 text-white text-center py-1 text-xs font-medium z-50"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      📡 {t('common.offline')}
    </div>
  )
}
