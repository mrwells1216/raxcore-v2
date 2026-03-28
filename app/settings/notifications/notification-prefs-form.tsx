'use client'

import { useState, useTransition } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { CheckCircle } from 'lucide-react'
import type { UserNotificationPrefs } from '@/lib/notifications/service'

interface Props {
  initialPrefs: UserNotificationPrefs | null
}

const DEFAULT: Omit<UserNotificationPrefs, 'user_id' | 'updated_at'> = {
  notify_render_updates: true,
  notify_real_score_reminders: true,
  notify_photo_quality: true,
  notify_map_reminders: false,
  noise_level: 'all',
  quiet_period_hours: 24,
}

export function NotificationPrefsForm({ initialPrefs }: Props) {
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
      const { saveMyNotificationPrefs } = await import('@/lib/notifications/service')
      await saveMyNotificationPrefs({
        notify_render_updates: prefs.notify_render_updates,
        notify_real_score_reminders: prefs.notify_real_score_reminders,
        notify_photo_quality: prefs.notify_photo_quality,
        notify_map_reminders: prefs.notify_map_reminders,
        noise_level: prefs.noise_level,
        quiet_period_hours: prefs.quiet_period_hours,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    })
  }

  return (
    <div className="space-y-6">
      {/* Category toggles */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Alert Categories</CardTitle>
          <CardDescription>Choose which types of notifications you receive.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {([
            { key: 'notify_render_updates',        label: '3D Render Updates',         desc: 'When a render completes or fails.' },
            { key: 'notify_real_score_reminders',  label: 'Real Score Reminders',       desc: 'Prompts to submit your official measurement.' },
            { key: 'notify_photo_quality',         label: 'Photo Quality Warnings',     desc: 'When image quality limits scoring accuracy.' },
            { key: 'notify_map_reminders',         label: 'Map Location Reminders',     desc: 'Prompts to pin a hunt location.' },
          ] as const).map(({ key, label, desc }) => (
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
        </CardContent>
      </Card>

      {/* Noise + quiet period */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Frequency &amp; Noise</CardTitle>
          <CardDescription>Reduce repeat alerts and control how often you hear from us.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Noise Level</Label>
            <p className="text-xs text-muted-foreground">
              &quot;Important only&quot; suppresses low-priority informational alerts.
            </p>
            <Select
              value={prefs.noise_level}
              onValueChange={val => { setPrefs(prev => ({ ...prev, noise_level: val as 'all' | 'important' })); setSaved(false) }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All notifications</SelectItem>
                <SelectItem value="important">Important only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Quiet Period</Label>
            <p className="text-xs text-muted-foreground">
              Minimum hours between repeat reminders for the same buck.
            </p>
            <Select
              value={String(prefs.quiet_period_hours)}
              onValueChange={val => { setPrefs(prev => ({ ...prev, quiet_period_hours: Number(val) })); setSaved(false) }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="6">6 hours</SelectItem>
                <SelectItem value="12">12 hours</SelectItem>
                <SelectItem value="24">24 hours (default)</SelectItem>
                <SelectItem value="48">48 hours</SelectItem>
                <SelectItem value="168">1 week</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} className="min-w-[100px]">
          Save
        </Button>
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-primary">
            <CheckCircle className="h-4 w-4" />
            Saved
          </span>
        )}
      </div>
    </div>
  )
}
