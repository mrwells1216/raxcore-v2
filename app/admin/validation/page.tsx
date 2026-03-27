import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ValidationRunsTable } from '@/components/admin/validation-runs-table'
import { CreateValidationRun } from '@/components/admin/create-validation-run'
import { listValidationRuns } from '@/lib/validation/service'

export default async function ValidationPage({ 
  searchParams 
}: { 
  searchParams: Promise<{ [key: string]: string | string[] | undefined }> 
}) {
  const params = await searchParams
  const page = Number(params.page) || 1
  const limit = 20

  const { data: runs, count: total } = await listValidationRuns({
    limit,
    offset: (page - 1) * limit
  })

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Validation Harness</h1>
        <p className="text-muted-foreground">
          Run bulk validation tests against training data to measure model accuracy.
        </p>
      </div>
      
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <CreateValidationRun />
        </div>
        
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Validation Runs ({total})</CardTitle>
              <CardDescription>
                View past validation runs and their results.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ValidationRunsTable 
                runs={runs} 
                total={total} 
                page={page} 
                limit={limit} 
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
