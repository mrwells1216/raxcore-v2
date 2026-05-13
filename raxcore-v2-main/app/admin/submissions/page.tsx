export const dynamic = 'force-dynamic'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { SubmissionsTable } from '@/components/admin/submissions-table'
import { listBucks } from '@/lib/storage/service'

export default async function SubmissionsPage({ 
  searchParams 
}: { 
  searchParams: Promise<{ [key: string]: string | string[] | undefined }> 
}) {
  const params = await searchParams
  const page = Number(params.page) || 1
  const limit = 20
  const statusFilter = typeof params.status === 'string' ? params.status : undefined

  const { data: submissions, count: total } = await listBucks({
    status: statusFilter,
    limit,
    offset: (page - 1) * limit
  })

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">All Submissions</h1>
        <p className="text-muted-foreground">View and manage all buck scoring submissions</p>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Submissions ({total})</CardTitle>
          <CardDescription>Filter by status</CardDescription>
        </CardHeader>
        <CardContent>
          <SubmissionsTable 
            submissions={submissions} 
            total={total} 
            page={page} 
            limit={limit} 
          />
        </CardContent>
      </Card>
    </div>
  )
}
