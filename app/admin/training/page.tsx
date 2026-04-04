export const dynamic = 'force-dynamic'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { TrainingTable } from '@/components/admin/training-table'
import { TrainingSamplesTable } from '@/components/admin/training-samples-table'
import { TrainingStatsCards } from '@/components/admin/training-stats-cards'
import { listTrainingExamples } from '@/lib/storage/service'
import { createClient } from '@/lib/supabase/server'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default async function TrainingPage({ 
  searchParams 
}: { 
  searchParams: Promise<{ [key: string]: string | string[] | undefined }> 
}) {
  const params = await searchParams
  const page = Number(params.page) || 1
  const limit = 20
  const verifiedFilter = typeof params.verified === 'string' ? params.verified : undefined
  const tab = typeof params.tab === 'string' ? params.tab : 'samples'

  const { data: examples, count: total } = await listTrainingExamples({
    verifiedOnly: verifiedFilter === 'true',
    limit,
    offset: (page - 1) * limit
  })

  // Fetch training samples with stats
  const supabase = await createClient()
  const { data: trainingSamples, count: samplesCount } = await supabase
    .from('training_samples')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)

  // Aggregate stats
  const { data: statsData } = await supabase
    .from('training_samples')
    .select('is_official, review_completeness, ground_truth, ai_output')

  const officialCount = statsData?.filter(s => s.is_official).length ?? 0
  const partialCount = (statsData?.length ?? 0) - officialCount

  // Calculate score deltas and find largest errors
  const sampleErrors = (statsData ?? [])
    .map(s => {
      const aiGross = s.ai_output?.gross_score ?? null
      const truthGross = s.ground_truth?.gross_score ?? null
      if (aiGross === null || truthGross === null) return null
      return {
        delta: truthGross - aiGross,
        absDelta: Math.abs(truthGross - aiGross),
      }
    })
    .filter(Boolean) as { delta: number; absDelta: number }[]

  const avgDelta = sampleErrors.length > 0
    ? sampleErrors.reduce((acc, e) => acc + e.delta, 0) / sampleErrors.length
    : 0

  const avgAbsError = sampleErrors.length > 0
    ? sampleErrors.reduce((acc, e) => acc + e.absDelta, 0) / sampleErrors.length
    : 0

  const largestError = sampleErrors.length > 0
    ? Math.max(...sampleErrors.map(e => e.absDelta))
    : 0

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Training Data</h1>
        <p className="text-muted-foreground">
          Review training samples and verify examples for model improvement.
        </p>
      </div>

      <TrainingStatsCards
        totalSamples={samplesCount ?? 0}
        officialCount={officialCount}
        partialCount={partialCount}
        avgDelta={avgDelta}
        avgAbsError={avgAbsError}
        largestError={largestError}
      />
      
      <Tabs defaultValue={tab} className="w-full">
        <TabsList>
          <TabsTrigger value="samples">Training Samples ({samplesCount ?? 0})</TabsTrigger>
          <TabsTrigger value="examples">Legacy Examples ({total})</TabsTrigger>
        </TabsList>

        <TabsContent value="samples" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Training Samples</CardTitle>
              <CardDescription>
                Human-reviewed score sheets used for calibration and model improvement.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TrainingSamplesTable 
                samples={trainingSamples ?? []} 
                total={samplesCount ?? 0} 
                page={page} 
                limit={limit} 
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="examples" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Training Examples</CardTitle>
              <CardDescription>Verify strong examples and reject weak ones.</CardDescription>
            </CardHeader>
            <CardContent>
              <TrainingTable 
                examples={examples} 
                total={total} 
                page={page} 
                limit={limit} 
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
