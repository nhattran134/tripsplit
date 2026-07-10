import { get, set, del } from 'idb-keyval'
import type { OfflineMutation } from '@/types'

const MUTATIONS_KEY = 'tripsplit-offline-mutations'

export async function getQueuedMutations(): Promise<OfflineMutation[]> {
  return (await get(MUTATIONS_KEY)) || []
}

export async function queueMutation(mutation: OfflineMutation): Promise<void> {
  const existing = await getQueuedMutations()
  await set(MUTATIONS_KEY, [...existing, mutation])
}

export async function removeMutation(id: string): Promise<void> {
  const existing = await getQueuedMutations()
  await set(MUTATIONS_KEY, existing.filter((m) => m.id !== id))
}

export async function clearMutations(): Promise<void> {
  await del(MUTATIONS_KEY)
}
