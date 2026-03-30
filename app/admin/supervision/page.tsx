import { Suspense } from 'react'
import { requireAdmin } from '@/lib/auth/actions'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { 
  getSupervisionDashboardStats, 
  listSupervisionEvents, 
  listHardCasePatterns, 
  getPendingLearningActions,
  getSupervisionTrends,
} from '@/lib/supervision'
import { SUPERVISION_TYPE_INFO, FAILURE_CAUSE_INFO } from '@/lib/supervision/config'
import { 
  Brain, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  TrendingUp, 
  FileSearch,
  Lightbulb,
  Target,
  BarChart3,
  RefreshCw,
} from 'lucide-react'
import Link from 'next/link'

export const metadata = {
  title: 'Supervision Learning | RAXcore Admin',
  description: 'Structured supervision and learning loop management',
}

async function SupervisionStats() {
  const stats = await getSupervisionDashboardStats()
  
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Events</CardTitle>
          <Brain className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.total_events.toLocaleString()}</div>
          <p className="text-xs text-muted-foreground">
            {stats.recent_events_count} in last 7 days
          </p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Pending Review</CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.pending_review_count}</div>
          <p className="text-xs text-muted-foreground">
            Events awaiting confirmation
          </p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Hard Cases</CardTitle>
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.hard_case_patterns_count}</div>
          <p className="text-xs text-muted-foreground">
            Active patterns tracked
          </p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Pending Actions</CardTitle>
          <Lightbulb className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.learning_actions_pending}</div>
          <p className="text-xs text-muted-foreground">
            Learning suggestions to review
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

async function TopFailureCauses() {
  const stats = await getSupervisionDashboardStats()
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Top Failure Causes</CardTitle>
        <CardDescription>Most common issues identified</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {stats.top_failure_causes.slice(0, 5).map((cause) => {
            const info = FAILURE_CAUSE_INFO[cause.label]
            return (
              <div key={cause.label} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{info?.label || cause.label}</span>
                  {cause.confirmed_count > 0 && (
                    <Badge variant="outline" className="text-xs">
                      {cause.confirmed_count} confirmed
                    </Badge>
                  )}
                </div>
                <span className="text-sm font-medium">{cause.count}</span>
              </div>
            )
          })}
          {stats.top_failure_causes.length === 0 && (
            <p className="text-sm text-muted-foreground">No failure causes recorded yet</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

async function EventsBySource() {
  const stats = await getSupervisionDashboardStats()
  
  const sourceLabels: Record<string, string> = {
    auto: 'Automatic',
    reverse_pass: 'Reverse Pass',
    structural_solver: 'Structural Solver',
    benchmark: 'Benchmark',
    admin: 'Admin',
  }
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Events by Source</CardTitle>
        <CardDescription>Where supervision signals come from</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {Object.entries(stats.events_by_source).map(([source, count]) => (
            <div key={source} className="flex items-center justify-between">
              <span className="text-sm">{sourceLabels[source] || source}</span>
              <span className="text-sm font-medium">{count}</span>
            </div>
          ))}
          {Object.keys(stats.events_by_source).length === 0 && (
            <p className="text-sm text-muted-foreground">No events recorded yet</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

async function RecentEvents() {
  const { data: events } = await listSupervisionEvents({ limit: 10 })
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent Events</CardTitle>
        <CardDescription>Latest supervision signals</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {events.map((event) => {
            const typeInfo = SUPERVISION_TYPE_INFO[event.supervision_type]
            return (
              <div key={event.id} className="flex items-start justify-between border-b pb-2 last:border-0">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{typeInfo?.label || event.supervision_type}</span>
                    <Badge 
                      variant={event.label_status === 'confirmed' ? 'default' : 
                               event.label_status === 'rejected' ? 'destructive' : 'secondary'}
                      className="text-xs"
                    >
                      {event.label_status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(event.created_at).toLocaleString()} - {event.source}
                  </p>
                </div>
                {event.delta_gross !== null && (
                  <span className={`text-sm font-medium ${event.delta_gross > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {event.delta_gross > 0 ? '+' : ''}{event.delta_gross.toFixed(1)}&quot;
                  </span>
                )}
              </div>
            )
          })}
          {events.length === 0 && (
            <p className="text-sm text-muted-foreground">No events recorded yet</p>
          )}
        </div>
        <div className="mt-4">
          <Button variant="outline" size="sm" asChild className="w-full">
            <Link href="/admin/supervision/events">View All Events</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

async function HardCasePatternsList() {
  const { data: patterns } = await listHardCasePatterns({ limit: 8 })
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Hard-Case Patterns</CardTitle>
        <CardDescription>Recurring difficult scenarios</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {patterns.map((pattern) => (
            <div key={pattern.id} className="flex items-center justify-between border-b pb-2 last:border-0">
              <div className="space-y-1">
                <span className="text-sm font-medium">{pattern.pattern_name.replace(/_/g, ' ')}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {pattern.actual_example_count || pattern.examples_count} examples
                  </Badge>
                  <Badge 
                    variant={pattern.mitigation_status === 'mitigated' ? 'default' : 
                             pattern.mitigation_status === 'in_progress' ? 'secondary' : 'outline'}
                    className="text-xs"
                  >
                    {pattern.mitigation_status}
                  </Badge>
                </div>
              </div>
              <div className="text-right">
                <span className={`text-sm font-medium ${
                  pattern.severity >= 0.8 ? 'text-red-600' : 
                  pattern.severity >= 0.6 ? 'text-orange-600' : 'text-yellow-600'
                }`}>
                  {(pattern.severity * 100).toFixed(0)}%
                </span>
                <p className="text-xs text-muted-foreground">severity</p>
              </div>
            </div>
          ))}
          {patterns.length === 0 && (
            <p className="text-sm text-muted-foreground">No patterns tracked yet</p>
          )}
        </div>
        <div className="mt-4">
          <Button variant="outline" size="sm" asChild className="w-full">
            <Link href="/admin/supervision/patterns">View All Patterns</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

async function PendingActionsList() {
  const actions = await getPendingLearningActions()
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pending Learning Actions</CardTitle>
        <CardDescription>Suggestions awaiting review</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {actions.slice(0, 5).map((action) => (
            <div key={action.id} className="flex items-start justify-between border-b pb-2 last:border-0">
              <div className="space-y-1">
                <span className="text-sm font-medium">{action.action_description}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {action.action_type.replace(/_/g, ' ')}
                  </Badge>
                  <Badge 
                    variant={action.priority === 'critical' ? 'destructive' : 
                             action.priority === 'high' ? 'default' : 'secondary'}
                    className="text-xs"
                  >
                    {action.priority}
                  </Badge>
                </div>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/admin/supervision/actions/${action.id}`}>Review</Link>
              </Button>
            </div>
          ))}
          {actions.length === 0 && (
            <p className="text-sm text-muted-foreground">No pending actions</p>
          )}
        </div>
        <div className="mt-4">
          <Button variant="outline" size="sm" asChild className="w-full">
            <Link href="/admin/supervision/actions">View All Actions</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

async function TrendChart() {
  const trends = await getSupervisionTrends(14)
  
  const maxEvents = Math.max(...trends.map(t => t.total_events), 1)
  
  return (
    <Card className="col-span-full">
      <CardHeader>
        <CardTitle className="text-base">Supervision Trend (14 Days)</CardTitle>
        <CardDescription>Daily supervision event volume</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-1 h-32">
          {trends.map((day) => {
            const height = (day.total_events / maxEvents) * 100
            const confirmedHeight = (day.confirmed_events / maxEvents) * 100
            return (
              <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex flex-col items-center" style={{ height: '100px' }}>
                  <div 
                    className="w-full bg-muted rounded-t relative"
                    style={{ height: `${height}%`, minHeight: day.total_events > 0 ? '4px' : '0' }}
                  >
                    <div 
                      className="absolute bottom-0 left-0 right-0 bg-primary rounded-t"
                      style={{ height: `${confirmedHeight > 0 ? (confirmedHeight / height) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(day.date).getDate()}
                </span>
              </div>
            )
          })}
        </div>
        <div className="flex items-center justify-center gap-4 mt-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-muted rounded" />
            <span className="text-xs text-muted-foreground">Total</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-primary rounded" />
            <span className="text-xs text-muted-foreground">Confirmed</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default async function SupervisionDashboardPage() {
  await requireAdmin()
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Supervision Learning</h1>
          <p className="text-muted-foreground">
            Structured error analysis and learning loop management
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/supervision/case">
              <FileSearch className="mr-2 h-4 w-4" />
              Case Lookup
            </Link>
          </Button>
          <form action="/api/admin/supervision/refresh" method="POST">
            <Button variant="outline" size="sm" type="submit">
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh Stats
            </Button>
          </form>
        </div>
      </div>
      
      <Suspense fallback={<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>}>
        <SupervisionStats />
      </Suspense>
      
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <TrendChart />
      </Suspense>
      
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="patterns">Patterns</TabsTrigger>
          <TabsTrigger value="actions">Actions</TabsTrigger>
        </TabsList>
        
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Suspense fallback={<Skeleton className="h-64" />}>
              <TopFailureCauses />
            </Suspense>
            <Suspense fallback={<Skeleton className="h-64" />}>
              <EventsBySource />
            </Suspense>
          </div>
        </TabsContent>
        
        <TabsContent value="events" className="space-y-4">
          <Suspense fallback={<Skeleton className="h-96" />}>
            <RecentEvents />
          </Suspense>
        </TabsContent>
        
        <TabsContent value="patterns" className="space-y-4">
          <Suspense fallback={<Skeleton className="h-96" />}>
            <HardCasePatternsList />
          </Suspense>
        </TabsContent>
        
        <TabsContent value="actions" className="space-y-4">
          <Suspense fallback={<Skeleton className="h-96" />}>
            <PendingActionsList />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  )
}
