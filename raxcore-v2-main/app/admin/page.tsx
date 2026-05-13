export const dynamic = 'force-dynamic'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Database, TrendingUp, CheckCircle, AlertTriangle, BarChart3 } from 'lucide-react'
import { getAdminStats, listBucks, getActiveModelVersion } from '@/lib/storage/service'
import { listAdminTasks } from '@/lib/notifications/service'
import { AdminTaskPanel } from '@/components/admin/admin-task-panel'

export default async function AdminDashboard() {
  const [stats, { data: recentBucks }, activeModel, openTasks] = await Promise.all([
    getAdminStats(),
    listBucks({ limit: 5 }),
    getActiveModelVersion(),
    listAdminTasks({ status: 'open', limit: 20, offset: 0 }),
  ])

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground">Monitor submissions, training data, and model performance</p>
      </div>
      
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Database, label: 'Total Bucks', value: stats.totalSubmissions, cls: 'text-primary bg-primary/10' },
          { icon: TrendingUp, label: 'Completed', value: stats.completedSubmissions, cls: 'text-accent bg-accent/10' },
          { icon: CheckCircle, label: 'Verified', value: stats.verifiedTraining, cls: 'text-primary bg-primary/10' },
          { icon: AlertTriangle, label: 'Pending', value: stats.totalTrainingExamples - stats.verifiedTraining, cls: 'text-amber-600 bg-amber-500/10' },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${item.cls}`}>
                  <item.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{item.value}</p>
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <AdminTaskPanel initialTasks={openTasks} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Model Performance
            </CardTitle>
            <CardDescription>
              Current model: {activeModel?.version_name || 'xrack-v1'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Avg Gross Error</span>
                <span className="font-medium">
                  {stats.avgGrossError !== null ? `${stats.avgGrossError.toFixed(1)}"` : 'N/A'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Avg Net Error</span>
                <span className="font-medium">
                  {stats.avgNetError !== null ? `${stats.avgNetError.toFixed(1)}"` : 'N/A'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Training Examples</span>
                <span className="font-medium">{stats.verifiedTraining}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge variant="secondary" className="bg-primary/10 text-primary">Active</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Recent Submissions
            </CardTitle>
            <CardDescription>Latest buck scoring requests</CardDescription>
          </CardHeader>
          <CardContent>
            {recentBucks.length > 0 ? (
              <div className="space-y-3">
                {recentBucks.map((buck) => (
                  <div 
                    key={buck.id} 
                    className="flex items-center justify-between py-2 border-b border-border last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-medium">
                        {buck.location?.slice(0, 2).toUpperCase() || 'US'}
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {buck.nickname || `Buck ${buck.session_id.slice(-6)}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(buck.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <Badge variant={buck.status === 'completed' ? 'secondary' : 'outline'}>
                      {buck.status}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                No submissions yet
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
