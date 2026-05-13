'use client'

import { CheckCircle2, AlertTriangle, XCircle, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SubjectValidationResult } from '@/lib/capture/subject-validation'
import type { ScanFeedback } from '@/lib/detection/detection-to-scan-feedback'

interface ScanValidationBannerProps {
  validation: SubjectValidationResult | null
  feedback: ScanFeedback | null
  checking: boolean
  onDismiss?: () => void
}

export function ScanValidationBanner({
  validation,
  feedback,
  checking,
  onDismiss,
}: ScanValidationBannerProps) {
  if (checking) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/40 bg-secondary/20">
        <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin shrink-0" />
        <span className="text-xs text-muted-foreground">Checking rack...</span>
      </div>
    )
  }

  // Detection feedback takes priority over client-side validation
  if (feedback) {
    if (feedback.color === 'green') {
      return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-500/25 bg-emerald-500/8">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            {feedback.headline}
          </span>
          {feedback.subline && (
            <span className="text-xs text-muted-foreground ml-auto">{feedback.subline}</span>
          )}
        </div>
      )
    }

    if (feedback.color === 'yellow') {
      return (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/8 px-3 py-2.5">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-amber-600 dark:text-amber-400">{feedback.headline}</p>
            {feedback.nextPrompt && (
              <p className="text-xs text-muted-foreground mt-0.5">{feedback.nextPrompt}</p>
            )}
          </div>
          {onDismiss && (
            <button type="button" onClick={onDismiss} className="shrink-0 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )
    }

    if (feedback.color === 'red') {
      return (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/8 px-3 py-2.5">
          <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-red-600 dark:text-red-400">{feedback.headline}</p>
            {feedback.nextPrompt && (
              <p className="text-xs text-muted-foreground mt-0.5">{feedback.nextPrompt}</p>
            )}
          </div>
        </div>
      )
    }
  }

  // Fall back to client-side validation banner
  if (!validation) return null

  if (validation.severity === 'fail') {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/8 px-3 py-2.5">
        <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-red-600 dark:text-red-400">
            {validation.issues[0] ?? 'Images may not be usable for scoring'}
          </p>
          {validation.issues.length > 1 && (
            <p className="text-xs text-muted-foreground mt-0.5">{validation.issues[1]}</p>
          )}
        </div>
      </div>
    )
  }

  if (validation.severity === 'warn') {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/8 px-3 py-2.5">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className={cn('text-xs text-amber-600 dark:text-amber-400')}>
            {validation.issues[0] ?? 'Image coverage is incomplete — scoring may be less accurate.'}
          </p>
        </div>
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="shrink-0 text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  }

  return null
}
