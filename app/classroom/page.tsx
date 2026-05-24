'use client'

import { useEffect, useState } from 'react'
import { Header } from '@/components/header'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { RaxamFlow } from '@/components/classroom/raxam-flow'
import { RaxrsFlow } from '@/components/classroom/raxrs-flow'
import { createClient } from '@/lib/supabase/client'

export default function ClassroomPage() {
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then((r: { data: { user: { id: string } | null } }) => setUserId(r.data.user?.id ?? null))
  }, [])

  return (
    <div className="min-h-svh flex flex-col bg-background">
      <Header />
      <main className="flex-1 overflow-y-auto container max-w-screen-md mx-auto px-4 py-6 pb-safe">
        <div className="mb-4">
          <h1 className="text-2xl font-bold tracking-wider" style={{ color: 'var(--bronze-light)' }}>
            Classroom
          </h1>
          <p className="text-sm text-muted-foreground">
            A lab for testing and calibrating the scorer. Toggle features, tune calibration, and
            teach the model from rescores.
          </p>
        </div>

        <Tabs defaultValue="raxam">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="raxam">RAXam · Exam lab</TabsTrigger>
            <TabsTrigger value="raxrs">RAXrs · Rescore</TabsTrigger>
          </TabsList>
          <TabsContent value="raxam" className="mt-4">
            <RaxamFlow userId={userId} />
          </TabsContent>
          <TabsContent value="raxrs" className="mt-4">
            <RaxrsFlow userId={userId} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
