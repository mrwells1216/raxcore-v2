export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { getBenchmarkPack } from '@/lib/benchmark/service'
import { listModelVersions } from '@/lib/storage/service'
import { listCalibrationProfiles } from '@/lib/calibration/service'
import { RunBenchmarkForm } from '@/components/admin/run-benchmark-form'
import { ArrowLeft, Play } from 'lucide-react'
import Link from 'next/link'

export default async function RunBenchmarkPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [pack, modelVersions, calibrationProfiles] = await Promise.all([
    getBenchmarkPack(id),
    listModelVersions(),
    listCalibrationProfiles(),
  ])

  if (!pack) {
    notFound()
  }

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-col gap-4">
        <Link
          href="/admin/benchmarks?tab=packs"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Packs
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Play className="h-6 w-6" />
            Run Benchmark: {pack.name}
          </h1>
          <p className="text-muted-foreground mt-1">
            {pack.example_count} examples in this pack
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configure Run</CardTitle>
          <CardDescription>
            Select models to compare and configure guardrail thresholds.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RunBenchmarkForm
            pack={pack}
            modelVersions={modelVersions}
            calibrationProfiles={calibrationProfiles}
          />
        </CardContent>
      </Card>
    </div>
  )
}
