import { useTranslation } from 'react-i18next'

export function LanguageToggle() {
  const { i18n } = useTranslation()

  const toggle = () => {
    const newLang = i18n.language === 'en' ? 'vi' : 'en'
    i18n.changeLanguage(newLang)
    localStorage.setItem('tripsplit-lang', newLang)
  }

  return (
    <button
      onClick={toggle}
      className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
    >
      {i18n.language === 'en' ? '🇻🇳 Tiếng Việt' : '🇬🇧 English'}
    </button>
  )
}
