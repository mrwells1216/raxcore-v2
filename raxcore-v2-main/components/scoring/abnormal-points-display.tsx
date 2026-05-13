'use client'

/**
 * Phase 54: Abnormal/Irregular Points Display Component
 * 
 * Shows captured abnormal point signals in a compact, informative way.
 * Used on result pages and admin detail views.
 */

import { AlertCircle, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ABNORMAL_POINT_TAGS } from '@/lib/constants'
import type { YesNoUnsure, AbnormalPointTag } from '@/lib/types'
import { cn } from '@/lib/utils'

interface AbnormalPointsDisplayProps {
  irregularPointsPresent?: YesNoUnsure | null
  nonTypicalTraitsPresent?: YesNoUnsure | null
  estimatedIrregularPointsCount?: number | null
  abnormalPointNotes?: string | null
  abnormalPointTags?: AbnormalPointTag[] | null
  variant?: 'card' | 'inline' | 'compact'
  className?: string
}

// Get human-readable label for yes/no/unsure
function formatYesNoUnsure(value: YesNoUnsure | null | undefined): string {
  if (!value) return 'Not specified'
  const labels: Record<YesNoUnsure, string> = {
    yes: 'Yes',
    no: 'No',
    unsure: 'Unsure',
  }
  return labels[value] || 'Unknown'
}

// Get badge variant based on value
function getYesNoVariant(value: YesNoUnsure | null | undefined): 'default' | 'secondary' | 'outline' {
  if (value === 'yes') return 'default'
  if (value === 'unsure') return 'secondary'
  return 'outline'
}

// Get label for abnormal point tag
function getTagLabel(tag: AbnormalPointTag): string {
  const found = ABNORMAL_POINT_TAGS.find(t => t.value === tag)
  return found?.label || tag.replace(/_/g, ' ')
}

// Check if there's any abnormal point data to display
function hasAbnormalPointData(props: AbnormalPointsDisplayProps): boolean {
  return !!(
    props.irregularPointsPresent ||
    props.nonTypicalTraitsPresent ||
    props.estimatedIrregularPointsCount ||
    props.abnormalPointNotes ||
    (props.abnormalPointTags && props.abnormalPointTags.length > 0)
  )
}

export function AbnormalPointsDisplay({
  irregularPointsPresent,
  nonTypicalTraitsPresent,
  estimatedIrregularPointsCount,
  abnormalPointNotes,
  abnormalPointTags,
  variant = 'card',
  className,
}: AbnormalPointsDisplayProps) {
  // Don't render if no data
  if (!hasAbnormalPointData({
    irregularPointsPresent,
    nonTypicalTraitsPresent,
    estimatedIrregularPointsCount,
    abnormalPointNotes,
    abnormalPointTags,
  })) {
    return null
  }

  // Compact inline variant (for result page summary)
  if (variant === 'compact') {
    return (
      <div className={cn('flex flex-wrap items-center gap-2 text-sm', className)}>
        <span className="text-muted-foreground flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5" />
          Irregular Points:
        </span>
        {irregularPointsPresent && (
          <Badge variant={getYesNoVariant(irregularPointsPresent)} className="text-xs">
            {formatYesNoUnsure(irregularPointsPresent)}
          </Badge>
        )}
        {estimatedIrregularPointsCount !== null && estimatedIrregularPointsCount !== undefined && (
          <span className="text-muted-foreground">
            (~{estimatedIrregularPointsCount} points)
          </span>
        )}
        {abnormalPointTags && abnormalPointTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {abnormalPointTags.slice(0, 3).map(tag => (
              <Badge key={tag} variant="outline" className="text-xs">
                {getTagLabel(tag)}
              </Badge>
            ))}
            {abnormalPointTags.length > 3 && (
              <Badge variant="outline" className="text-xs">
                +{abnormalPointTags.length - 3} more
              </Badge>
            )}
          </div>
        )}
      </div>
    )
  }

  // Inline variant (for admin tables)
  if (variant === 'inline') {
    return (
      <div className={cn('space-y-1 text-sm', className)}>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Irregular:</span>
          <Badge variant={getYesNoVariant(irregularPointsPresent)} className="text-xs">
            {formatYesNoUnsure(irregularPointsPresent)}
          </Badge>
          {nonTypicalTraitsPresent && nonTypicalTraitsPresent !== irregularPointsPresent && (
            <>
              <span className="text-muted-foreground">Non-typical:</span>
              <Badge variant={getYesNoVariant(nonTypicalTraitsPresent)} className="text-xs">
                {formatYesNoUnsure(nonTypicalTraitsPresent)}
              </Badge>
            </>
          )}
        </div>
        {estimatedIrregularPointsCount !== null && estimatedIrregularPointsCount !== undefined && (
          <div className="text-muted-foreground">
            Est. count: <span className="font-medium text-foreground">{estimatedIrregularPointsCount}</span>
          </div>
        )}
        {abnormalPointTags && abnormalPointTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {abnormalPointTags.map(tag => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {getTagLabel(tag)}
              </Badge>
            ))}
          </div>
        )}
        {abnormalPointNotes && (
          <p className="text-xs text-muted-foreground italic line-clamp-2">{abnormalPointNotes}</p>
        )}
      </div>
    )
  }

  // Card variant (default - for result pages and admin detail)
  return (
    <Card className={cn('border-amber-500/30 bg-amber-500/5', className)}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertCircle className="h-4 w-4 text-amber-500" />
          Irregular / Abnormal Points
        </CardTitle>
        <CardDescription className="flex items-center gap-1 text-xs">
          <Info className="h-3 w-3" />
          User-reported signals for non-typical features
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-muted-foreground block text-xs mb-1">Irregular Points</span>
            <Badge variant={getYesNoVariant(irregularPointsPresent)}>
              {formatYesNoUnsure(irregularPointsPresent)}
            </Badge>
          </div>
          <div>
            <span className="text-muted-foreground block text-xs mb-1">Non-Typical Traits</span>
            <Badge variant={getYesNoVariant(nonTypicalTraitsPresent)}>
              {formatYesNoUnsure(nonTypicalTraitsPresent)}
            </Badge>
          </div>
        </div>

        {estimatedIrregularPointsCount !== null && estimatedIrregularPointsCount !== undefined && (
          <div className="text-sm">
            <span className="text-muted-foreground">Estimated abnormal points:</span>{' '}
            <span className="font-semibold">{estimatedIrregularPointsCount}</span>
          </div>
        )}

        {abnormalPointTags && abnormalPointTags.length > 0 && (
          <div>
            <span className="text-muted-foreground text-xs block mb-1.5">Tagged Features</span>
            <div className="flex flex-wrap gap-1.5">
              {abnormalPointTags.map(tag => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {getTagLabel(tag)}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {abnormalPointNotes && (
          <Collapsible>
            <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              View notes
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p className="text-sm text-muted-foreground mt-2 p-2 bg-secondary/50 rounded-md">
                {abnormalPointNotes}
              </p>
            </CollapsibleContent>
          </Collapsible>
        )}

        <p className="text-xs text-muted-foreground/70 border-t border-border pt-2 mt-2">
          Note: This data captures user observations. Full abnormal point scoring is coming in a future update.
        </p>
      </CardContent>
    </Card>
  )
}

// Export a simple summary badge for use in tables/lists
export function AbnormalPointsBadge({
  irregularPointsPresent,
  nonTypicalTraitsPresent,
  className,
}: Pick<AbnormalPointsDisplayProps, 'irregularPointsPresent' | 'nonTypicalTraitsPresent' | 'className'>) {
  if (irregularPointsPresent !== 'yes' && nonTypicalTraitsPresent !== 'yes') {
    return null
  }

  return (
    <Badge variant="outline" className={cn('text-amber-600 border-amber-500/50 bg-amber-500/10', className)}>
      <AlertCircle className="h-3 w-3 mr-1" />
      Abnormal
    </Badge>
  )
}
