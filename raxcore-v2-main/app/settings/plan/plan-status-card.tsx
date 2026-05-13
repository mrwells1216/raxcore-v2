'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { CheckCircle, XCircle, Clock } from 'lucide-react'
import type { UserPlanStatus, UsageLedgerEntry } from '@/lib/billing/service'

const PLAN_BADGE_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  guest: 'outline',
  free: 'outline',
  starter: 'secondary',
  pro: 'default',
  admin: 'default',
}

function FeatureRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm py-1">
      <span className="text-foreground">{label}</span>
      {enabled
        ? <CheckCircle className="h-4 w-4 text-primary" />
        : <XCircle className="h-4 w-4 text-muted-foreground/50" />}
    </div>
  )
}

interface Props {
  status: UserPlanStatus | null
  recentLedger: UsageLedgerEntry[]
}

export function PlanStatusCard({ status, recentLedger }: Props) {
  if (!status) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Unable to load plan information. Please try again later.
        </CardContent>
      </Card>
    )
  }

  const pct = status.effective_monthly_limit
    ? Math.min(100, Math.round((status.scores_used_this_period / status.effective_monthly_limit) * 100))
    : 0

  const remaining = status.effective_monthly_limit !== null
    ? Math.max(0, status.effective_monthly_limit - status.scores_used_this_period)
    : null

  const periodEnd = new Date(status.period_end)
  const daysLeft = Math.max(0, Math.ceil((periodEnd.getTime() - Date.now()) / 86400000))

  return (
    <div className="flex flex-col gap-4">
      {/* Plan header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Current Plan</CardTitle>
            <Badge variant={PLAN_BADGE_VARIANT[status.plan_id] ?? 'outline'}>
              {status.plan_name}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Usage bar */}
          <div>
            <div className="flex items-center justify-between text-sm mb-1.5">
              <span className="font-medium">Scores this period</span>
              <span className="text-muted-foreground">
                {status.scores_used_this_period}
                {status.effective_monthly_limit !== null ? ` / ${status.effective_monthly_limit}` : ' (unlimited)'}
              </span>
            </div>
            {status.effective_monthly_limit !== null ? (
              <Progress value={pct} className="h-2" />
            ) : (
              <div className="h-2 rounded-full bg-primary/20" />
            )}
            <div className="flex items-center justify-between mt-1.5 text-xs text-muted-foreground">
              <span>
                {remaining !== null ? `${remaining} remaining` : 'Unlimited'}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Resets in {daysLeft} day{daysLeft !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {/* Daily usage */}
          {status.scores_per_day !== null && (
            <div className="text-sm text-muted-foreground">
              Today: {status.scores_used_today} / {status.scores_per_day} daily scores used
            </div>
          )}

          {/* Feature flags */}
          <div className="border rounded-md px-3 py-2 mt-1">
            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Plan Features</p>
            <FeatureRow label="Score history" enabled={status.history_enabled} />
            <FeatureRow label="Collections" enabled={status.collection_enabled} />
            <FeatureRow label="3D Renders" enabled={status.render_enabled} />
            <FeatureRow label="Advanced analytics" enabled={status.advanced_analytics} />
            <div className="flex items-center justify-between text-sm py-1">
              <span className="text-foreground">Max images per score</span>
              <span className="font-medium">{status.max_images_per_score}</span>
            </div>
          </div>

          {/* Low-credits warning */}
          {remaining !== null && remaining <= 2 && remaining > 0 && (
            <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              You have {remaining} score{remaining !== 1 ? 's' : ''} left this period.
              Contact us to upgrade your plan.
            </div>
          )}
          {remaining === 0 && (
            <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive">
              You&apos;ve used all your scores for this period. Resets on {periodEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent activity */}
      {recentLedger.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent Activity</CardTitle>
            <CardDescription>Last {recentLedger.length} scoring runs</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {recentLedger.map(entry => (
                <div key={entry.id} className="flex items-center justify-between px-6 py-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    {entry.status === 'success'
                      ? <CheckCircle className="h-3.5 w-3.5 text-primary shrink-0" />
                      : <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                    <span className="text-muted-foreground">
                      {new Date(entry.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{entry.images_count} image{entry.images_count !== 1 ? 's' : ''}</span>
                    {entry.status === 'blocked' && (
                      <Badge variant="destructive" className="text-[10px] h-4">blocked</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
