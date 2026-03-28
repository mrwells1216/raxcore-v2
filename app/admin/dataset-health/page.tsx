import { Suspense } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { DatasetHealthOverview } from '@/components/admin/dataset-health-overview'
import { DatasetHealthTable } from '@/components/admin/dataset-health-table'
import { DuplicatesPanel } from '@/components/admin/duplicates-panel'
import { OutliersPanel } from '@/components/admin/outliers-panel'

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-[400px]" />
    </div>
  )
}

export default function DatasetHealthPage() {
  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Dataset Health</h1>
        <p className="text-muted-foreground">
          Monitor and manage training data quality. Review health scores, duplicates, and outliers.
        </p>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full max-w-[600px] grid-cols-4">
          <TabsTrigger value="overview" className="min-h-[44px]">Overview</TabsTrigger>
          <TabsTrigger value="examples" className="min-h-[44px]">Examples</TabsTrigger>
          <TabsTrigger value="duplicates" className="min-h-[44px]">Duplicates</TabsTrigger>
          <TabsTrigger value="outliers" className="min-h-[44px]">Outliers</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Suspense fallback={<LoadingSkeleton />}>
            <DatasetHealthOverview />
          </Suspense>
        </TabsContent>

        <TabsContent value="examples" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Training Examples</CardTitle>
              <CardDescription>
                Browse and filter examples by health status. Review flagged items and make usability decisions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense fallback={<Skeleton className="h-[400px]" />}>
                <DatasetHealthTable />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="duplicates" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Duplicate Clusters</CardTitle>
              <CardDescription>
                Review detected duplicate and near-duplicate examples. Resolve clusters to clean up the dataset.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense fallback={<Skeleton className="h-[400px]" />}>
                <DuplicatesPanel />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="outliers" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Outlier Records</CardTitle>
              <CardDescription>
                Review statistical outliers that may be risky for training. Resolve or exclude as needed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense fallback={<Skeleton className="h-[400px]" />}>
                <OutliersPanel />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
