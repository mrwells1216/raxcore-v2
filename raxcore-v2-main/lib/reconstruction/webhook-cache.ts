import type { ReconstructionAsset, ReconstructionJobStatus } from './types'

interface WebhookEntry {
  status: ReconstructionJobStatus
  progress: number
  assets: ReconstructionAsset[]
  message: string | null
  updatedAt: number
}

const cache = new Map<string, WebhookEntry>()
const TTL_MS = 30_000

export function storeWebhookResult(
  externalJobId: string,
  entry: Omit<WebhookEntry, 'updatedAt'>,
): void {
  cache.set(externalJobId, { ...entry, updatedAt: Date.now() })
}

export function getWebhookResult(externalJobId: string): WebhookEntry | null {
  const entry = cache.get(externalJobId)
  if (!entry || Date.now() - entry.updatedAt > TTL_MS) return null
  return entry
}
