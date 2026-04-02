export const dynamic = 'force-dynamic'

import { AdminSidebar } from '@/components/admin/admin-sidebar'
import { listJobs, getJobStats, getScheduledJobDefinitions } from '@/lib/jobs'
import { JobsTable } from './jobs-table'
import { JobStatsCards } from './job-stats-cards'
import { ScheduledJobsPanel } from './scheduled-jobs-panel'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { JobStatus, JobType } from '@/lib/jobs/types'

export const metadata = { title: 'Jobs | RaxCore Admin' }

export default async function AdminJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ 
    page?: string
    status?: string
    type?: string
    tab?: string
  }>
}) {
  const params = await searchParams
  const page = Math.max(1, Number(params.page ?? 1))
  const statusFilter = params.status as JobStatus | undefined
  const typeFilter = params.type as JobType | undefined
  const limit = 50
  const offset = (page - 1) * limit

  const [{ data: jobs, count }, stats, scheduledJobs] = await Promise.all([
    listJobs(
      {
        status: statusFilter,
        jobType: typeFilter,
      },
      limit,
      offset
    ),
    getJobStats(),
    getScheduledJobDefinitions(),
  ])

  const totalPages = Math.ceil((count ?? 0) / limit)

  return (
    <div className="flex h-svh overflow-hidden bg-background font-sans">
      <AdminSidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-6xl mx-auto">
          <h1 className="text-2xl font-semibold mb-6">Durable Jobs</h1>

          <Tabs defaultValue={params.tab || 'overview'} className="space-y-6">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="jobs">All Jobs</TabsTrigger>
              <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6">
              <JobStatsCards stats={stats} />
              
              <div className="rounded-lg border p-4">
                <h3 className="font-medium mb-3">Recent Jobs</h3>
                <JobsTable 
                  jobs={jobs.slice(0, 10)} 
                  currentPage={1}
                  totalPages={1}
                  totalCount={Math.min(10, jobs.length)}
                  compact
                />
              </div>
            </TabsContent>

            <TabsContent value="jobs">
              <JobsTable
                jobs={jobs}
                currentPage={page}
                totalPages={totalPages}
                totalCount={count ?? 0}
                statusFilter={statusFilter}
                typeFilter={typeFilter}
              />
            </TabsContent>

            <TabsContent value="scheduled">
              <ScheduledJobsPanel definitions={scheduledJobs} />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  )
}
