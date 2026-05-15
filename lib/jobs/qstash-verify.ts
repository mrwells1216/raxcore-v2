import 'server-only'
import { Receiver } from '@upstash/qstash'

let receiver: Receiver | null = null

function getReceiver(): Receiver | null {
  const currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY
  const nextKey = process.env.QSTASH_NEXT_SIGNING_KEY
  if (!currentKey) return null
  if (!receiver) {
    receiver = new Receiver({
      currentSigningKey: currentKey,
      nextSigningKey: nextKey ?? currentKey,
    })
  }
  return receiver
}

/**
 * Verify that an incoming request is from QStash.
 * Falls back to CRON_SECRET bearer auth for local dev / manual testing.
 * Returns true if authorized, false otherwise.
 *
 * Call this at the top of any cron route before doing any work.
 */
export async function verifyQStashRequest(request: Request): Promise<boolean> {
  // CRON_SECRET bearer — local dev + manual curl testing
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return true
  }

  // QStash signature verification — production path
  const rec = getReceiver()
  if (!rec) {
    // QStash not configured — allow only if CRON_SECRET also absent (open dev mode)
    return !cronSecret
  }

  try {
    const signature = request.headers.get('upstash-signature')
    if (!signature) return false
    const body = await request.text()
    return await rec.verify({ signature, body, url: request.url })
  } catch {
    return false
  }
}
