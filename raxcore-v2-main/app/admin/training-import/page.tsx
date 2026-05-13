export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { TrainingImportForm } from '@/components/admin/training-import-form'

export default async function AdminTrainingImportPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) redirect('/')

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">Import Training Data</h1>
          <p className="text-muted-foreground text-sm">
            Upload official score sheets and images to improve model accuracy through human-in-the-loop training.
          </p>
        </div>
        <Link
          href="/admin/supervision"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-1"
        >
          ← Supervision
        </Link>
      </div>

      <p className="text-xs text-muted-foreground border rounded px-3 py-2 bg-muted/30">
        RAX CORE measurements are AI-assisted and user-verified. Official acceptance depends on governing organization rules.
        Benchmark promotion affects model evaluation thresholds — use with verified official score sheets only.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Official Score Import</CardTitle>
          <CardDescription>
            Import Boone &amp; Crockett or Pope &amp; Young official score sheets with associated images.
            All 19 required B&amp;C fields must be filled for submission.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TrainingImportForm />
        </CardContent>
      </Card>
    </div>
  )
}
