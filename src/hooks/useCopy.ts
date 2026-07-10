import { useState, useCallback } from 'react'

export function useCopy() {
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copy = useCallback(async (text: string, id: string = 'default') => {
    await navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }, [])

  // Just trigger the visual feedback (when clipboard was already written elsewhere)
  const markCopied = useCallback((id: string) => {
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }, [])

  return { copy, copiedId, markCopied }
}
