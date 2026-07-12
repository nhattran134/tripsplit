import { useState, useEffect, useCallback } from 'react'

interface ToastMessage {
  id: string
  text: string
}

let addToastFn: ((text: string) => void) | null = null

export function showToast(text: string) {
  if (addToastFn) addToastFn(text)
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const addToast = useCallback((text: string) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((prev) => [...prev, { id, text }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 3000)
  }, [])

  useEffect(() => {
    addToastFn = addToast
    return () => { addToastFn = null }
  }, [addToast])

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 space-y-2 pointer-events-none w-[90vw] max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-800 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium animate-[slideDown_0.3s_ease-out] text-center"
        >
          {toast.text}
        </div>
      ))}
    </div>
  )
}
