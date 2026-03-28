'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import type { UserPlanStatus } from '@/lib/billing/service'

interface Props {
  status: UserPlanStatus | null
}

/**
 * Compact plan + usage indicator for user-menu / header.
 * Shows plan name and remaining scores if capped.
 */
export function UsageBadge({ status }: Props) {
  if (!status) return null

  const remaining = status.effective_monthly_limit !== null
    ? Math.max(0, status.effective_monthly_limit - status.scores_used_this_period)
    : null

  const isWarning = remaining !== null && remaining <= 2
  const isExhausted = remaining === 0

  return (
    <Link href="/settings/plan" className="flex items-center gap-1.5 text-xs hover:opacity-80 transition-opacity">
      <Badge
        variant={isExhausted ? 'destructive' : isWarning ? 'outline' : 'secondary'}
        className="text-[10px] h-4 px-1.5 font-medium"
      >
        {status.plan_name}
      </Badge>
      {remaining !== null && (
        <span className={isExhausted ? 'text-destructive' : isWarning ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}>
          {remaining} left
        </span>
      )}
    </Link>
  )
}
