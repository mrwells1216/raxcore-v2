export const dynamic = 'force-dynamic'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BulkRunsTable } from '@/components/admin/bulk-runs-table'
import { CreateBulkRun } from '@/components/admin/create-bulk-run'
import { listBulkValidationRuns } from '@/lib/validation/bulk-service'
import { listModelVersions } from '@/lib/storage/service'
import { FlaskConical, GitCompare } from 'lucide-react'

export default async function BulkValidationPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const page = Number(params.page) || 1
  const runType = (params.runType as string) || undefined
  const limit = 20

  const { data: runs, count: total } = await listBulkValidationRuns({
    runType,
    limit,
    offset: (page - 1) * limit,
  })

  const modelVersions = await listModelVersions()

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Bulk Validation & Model Comparison</h1>
        <p className="text-muted-foreground">
          Run bulk tests with known-score examples and compare performance across model versions.
        </p>
      </div>

      <Tabs defaultValue="runs" className="space-y-4">
        <TabsList>
          <TabsTrigger value="runs" className="gap-1.5">
            <FlaskConical className="h-4 w-4" />
            Validation Runs
          </TabsTrigger>
          <TabsTrigger value="create" className="gap-1.5">
            <GitCompare className="h-4 w-4" />
            New Run
          </TabsTrigger>
        </TabsList>

        <TabsContent value="runs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FlaskConical className="h-5 w-5" />
                Bulk Validation Runs ({total})
              </CardTitle>
              <CardDescription>
                View past runs, their results, and model comparisons.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BulkRunsTable 
                runs={runs} 
                total={total} 
                page={page} 
                limit={limit}
                modelVersions={modelVersions}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="create" className="space-y-4">
          <CreateBulkRun modelVersions={modelVersions} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
