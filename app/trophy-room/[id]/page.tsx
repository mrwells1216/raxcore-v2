export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getTrophyEntryWithMeasurements } from '@/lib/trophy-room/service'
import { TrophyDetailClient } from '@/components/trophy-room/trophy-detail-client'

export default async function TrophyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) redirect('/auth/login')

  const { entry, measurements } = await getTrophyEntryWithMeasurements(id, user.id)
  if (!entry) redirect('/trophy-room')

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-4xl mx-auto">
      <Link href="/trophy-room" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition">
        <ArrowLeft className="h-4 w-4" />
        Back to Trophy Room
      </Link>
      <TrophyDetailClient entry={entry} measurements={measurements} />
    </div>
  )
}
