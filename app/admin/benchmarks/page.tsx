import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BenchmarkPacksTable } from '@/components/admin/benchmark-packs-table'
import { BenchmarkRunsTable } from '@/components/admin/benchmark-runs-table'
import { PromotionDecisionsTable } from '@/components/admin/promotion-decisions-table'
import { CreateBenchmarkPack } from '@/components/admin/create-benchmark-pack'
import { listBenchmarkPacks, listBenchmarkRuns, listPromotionDecisions } from '@/lib/benchmark/service'
import { listModelVersions } from '@/lib/storage/service'
import { listCalibrationProfiles } from '@/lib/calibration/service'
import { Package, Play, CheckCircle, Plus } from 'lucide-react'

export default async function BenchmarksPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const tab = (params.tab as string) || 'packs'
  const page = Number(params.page) || 1
  const limit = 20

  // Fetch data in parallel
  const [packsResult, runsResult, decisionsResult, modelVersions, calibrationProfiles] = await Promise.all([
    listBenchmarkPacks({ limit, offset: (page - 1) * limit }),
    listBenchmarkRuns({ limit, offset: (page - 1) * limit }),
    listPromotionDecisions({ limit, offset: (page - 1) * limit }),
    listModelVersions(),
    listCalibrationProfiles(),
  ])

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Benchmark Packs & Promotion</h1>
        <p className="text-muted-foreground">
          Create reproducible test suites, run regression tests, and manage model promotions with guardrails.
        </p>
      </div>

      <Tabs defaultValue={tab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="packs" className="gap-1.5">
            <Package className="h-4 w-4" />
            Packs ({packsResult.count})
          </TabsTrigger>
          <TabsTrigger value="runs" className="gap-1.5">
            <Play className="h-4 w-4" />
            Runs ({runsResult.count})
          </TabsTrigger>
          <TabsTrigger value="decisions" className="gap-1.5">
            <CheckCircle className="h-4 w-4" />
            Decisions ({decisionsResult.count})
          </TabsTrigger>
          <TabsTrigger value="create" className="gap-1.5">
            <Plus className="h-4 w-4" />
            New Pack
          </TabsTrigger>
        </TabsList>

        <TabsContent value="packs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Package className="h-5 w-5" />
                Benchmark Packs
              </CardTitle>
              <CardDescription>
                Curated sets of training examples for reproducible testing and regression checks.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BenchmarkPacksTable
                packs={packsResult.data}
                total={packsResult.count}
                page={page}
                limit={limit}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="runs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Play className="h-5 w-5" />
                Benchmark Runs
              </CardTitle>
              <CardDescription>
                View benchmark run history, guardrail results, and model comparisons.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BenchmarkRunsTable
                runs={runsResult.data}
                total={runsResult.count}
                page={page}
                limit={limit}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="decisions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                Promotion Decisions
              </CardTitle>
              <CardDescription>
                Audit trail of model promotion decisions with metrics snapshots.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PromotionDecisionsTable
                decisions={decisionsResult.data}
                total={decisionsResult.count}
                page={page}
                limit={limit}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="create" className="space-y-4">
          <CreateBenchmarkPack
            modelVersions={modelVersions}
            calibrationProfiles={calibrationProfiles}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
