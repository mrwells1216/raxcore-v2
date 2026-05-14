export const dynamic = 'force-dynamic'

import { Trophy } from 'lucide-react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { listTrophyEntries } from '@/lib/trophy-room/service'
import { TrophyRoomClient } from '@/components/trophy-room/trophy-room-client'

export default async function TrophyRoomPage() {
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) redirect('/auth/login')

  const { entries, nextCursor } = await listTrophyEntries(user.id, { limit: 20 })

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-amber-500/15 text-amber-500">
          <Trophy className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Trophy Room</h1>
          <p className="text-sm text-muted-foreground">Your curated gallery of high-confidence scores.</p>
        </div>
      </div>

      <TrophyRoomClient initialEntries={entries} initialCursor={nextCursor} />
    </div>
  )
}
