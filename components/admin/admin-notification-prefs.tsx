'use client'

import { useState, useTransition } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { CheckCircle } from 'lucide-react'
import type { AdminNotificationPrefs } from '@/lib/notifications/service'

interface Props {
  initialPrefs: AdminNotificationPrefs | null
}

const DEFAULT: Omit<AdminNotificationPrefs, 'user_id' | 'updated_at'> = {
  show_high_priority_only: false,
  show_benchmark_warnings: true,
  show_data_gap_reminders: true,
  show_duplicate_reminders: true,
  show_calibration_reminders: true,
  show_model_promotion: true,
}

export function AdminNotificationPrefs({ initialPrefs }: Props) {
  const merged = { ...DEFAULT, ...(initialPrefs ?? {}) }
  const [prefs, setPrefs] = useState(merged)
  const [saved, setSaved] = useState(false)
  const [, startTransition] = useTransition()

  function toggle(key: keyof typeof prefs) {
    setPrefs(prev => ({ ...prev, [key]: !prev[key] }))
    setSaved(false)
  }

  function handleSave() {
    startTransition(async () => {
      const { saveMyAdminNotificationPrefs } = await import('@/lib/notifications/service')
      await saveMyAdminNotificationPrefs(prefs)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    })
  }

  const rows = [
    { key: 'show_high_priority_only',    label: 'High-priority tasks only',    desc: 'Hide low and normal priority items from the task panel.' },
    { key: 'show_benchmark_warnings',    label: 'Benchmark warnings',           desc: 'Alerts when validation runs fall below threshold.' },
    { key: 'show_data_gap_reminders',    label: 'Data gap reminders',           desc: 'Tasks flagged for missing or low-quality training data.' },
    { key: 'show_duplicate_reminders',   label: 'Suspect duplicate reminders',  desc: 'When the system detects possible duplicate submissions.' },
    { key: 'show_calibration_reminders', label: 'Calibration reminders',        desc: 'Alerts when the model may need re-calibration.' },
    { key: 'show_model_promotion',       label: 'Model promotion tasks',        desc: 'When a new model version is ready for promotion.' },
  ] as const

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Task Panel Preferences</CardTitle>
        <CardDescription>Choose which task categories appear in your admin panel.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.map(({ key, label, desc }) => (
          <div key={key} className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor={key} className="text-sm font-medium cursor-pointer">{label}</Label>
              <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
            </div>
            <Switch
              id={key}
              checked={prefs[key] as boolean}
              onCheckedChange={() => toggle(key)}
            />
          </div>
        ))}

        <div className="flex items-center gap-3 pt-2">
          <Button size="sm" onClick={handleSave}>
            Save preferences
          </Button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-primary">
              <CheckCircle className="h-4 w-4" />
              Saved
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
