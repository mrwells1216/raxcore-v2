import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { TrainingTable } from '@/components/admin/training-table'
import { listTrainingExamples } from '@/lib/storage/service'

export default async function TrainingPage({ 
  searchParams 
}: { 
  searchParams: Promise<{ [key: string]: string | string[] | undefined }> 
}) {
  const params = await searchParams
  const page = Number(params.page) || 1
  const limit = 20
  const verifiedFilter = typeof params.verified === 'string' ? params.verified : undefined

  const { data: examples, count: total } = await listTrainingExamples({
    verifiedOnly: verifiedFilter === 'true',
    limit,
    offset: (page - 1) * limit
  })

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Training Queue</h1>
        <p className="text-muted-foreground">
          Review and verify examples before they count toward training.
        </p>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Training Examples ({total})</CardTitle>
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
    </div>
  )
}
