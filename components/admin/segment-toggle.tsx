'use client'

/**
 * Phase 41: Inline enable/disable toggle for a calibration segment.
 */

import { useState, useTransition } from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { toggleSegmentEnabled } from '@/app/admin/segments/actions'

interface Props {
  segmentId: string
  enabled: boolean
}

export function SegmentToggle({ segmentId, enabled: initialEnabled }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [isPending, startTransition] = useTransition()

  function handleChange(next: boolean) {
    setEnabled(next) // optimistic
    startTransition(async () => {
      try {
        await toggleSegmentEnabled(segmentId, next)
      } catch {
        setEnabled(!next) // revert on error
      }
    })
  }

  return (
    <div className="flex items-center gap-2">
      <Switch
        id={`toggle-${segmentId}`}
        checked={enabled}
        onCheckedChange={handleChange}
        disabled={isPending}
        className="h-4 w-7 data-[state=checked]:bg-primary"
      />
      <Label
        htmlFor={`toggle-${segmentId}`}
        className="text-xs text-muted-foreground cursor-pointer"
      >
        {enabled ? 'On' : 'Off'}
      </Label>
    </div>
  )
}
