'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, ChevronLeft, ChevronRight, Settings } from 'lucide-react'
import { setUserPlan, grantExtraCredits } from '@/lib/billing/service'
import { notifyPlanChanged, notifyCreditsGranted } from '@/lib/billing/notifications'
import type { AdminUserPlanRow, Plan, PlanId } from '@/lib/billing/service'

const PLAN_BADGE: Record<string, 'default' | 'secondary' | 'outline'> = {
  guest: 'outline',
  free: 'outline',
  starter: 'secondary',
  pro: 'default',
  admin: 'default',
}

interface EditState {
  userId: string
  email: string | null
  currentPlan: PlanId
  scoresOverride: number | null
}

interface Props {
  users: AdminUserPlanRow[]
  plans: Plan[]
  currentPage: number
  totalPages: number
  totalCount: number
  currentPlanFilter: string | null
}

export function AdminBillingTable({
  users,
  plans,
  currentPage,
  totalPages,
  totalCount,
  currentPlanFilter,
}: Props) {
  const router = useRouter()
  const sp = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [editTarget, setEditTarget] = useState<EditState | null>(null)
  const [selectedPlan, setSelectedPlan] = useState<PlanId>('free')
  const [overrideInput, setOverrideInput] = useState('')
  const [creditsInput, setCreditsInput] = useState('')
  const [saving, setSaving] = useState(false)

  function openEdit(user: AdminUserPlanRow) {
    setEditTarget({
      userId: user.user_id,
      email: user.email,
      currentPlan: user.plan_id,
      scoresOverride: user.scores_override,
    })
    setSelectedPlan(user.plan_id)
    setOverrideInput(user.scores_override !== null ? String(user.scores_override) : '')
    setCreditsInput('')
  }

  function navigate(page: number, plan?: string | null) {
    const params = new URLSearchParams(sp.toString())
    params.set('page', String(page))
    if (plan !== undefined) {
      if (plan) params.set('plan', plan)
      else params.delete('plan')
    }
    startTransition(() => router.push(`/admin/billing?${params.toString()}`))
  }

  async function handleSave() {
    if (!editTarget) return
    setSaving(true)
    try {
      const override = overrideInput ? Number(overrideInput) : null
      const planChanged = selectedPlan !== editTarget.currentPlan
      await setUserPlan(editTarget.userId, selectedPlan, { scoresOverride: override })
      if (planChanged) {
        const planLabel = plans.find(p => p.id === selectedPlan)?.display_name ?? selectedPlan
        await notifyPlanChanged(editTarget.userId, planLabel).catch(() => null)
      }
      if (creditsInput && Number(creditsInput) > 0) {
        await grantExtraCredits(editTarget.userId, Number(creditsInput))
        await notifyCreditsGranted(editTarget.userId, Number(creditsInput)).catch(() => null)
      }
      setEditTarget(null)
      startTransition(() => router.refresh())
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-base">User Plans</CardTitle>
              <CardDescription>{totalCount.toLocaleString()} users</CardDescription>
            </div>
            {/* Plan filter */}
            <Select
              value={currentPlanFilter ?? 'all'}
              onValueChange={v => navigate(1, v === 'all' ? null : v)}
            >
              <SelectTrigger className="w-36 h-8 text-xs">
                <SelectValue placeholder="All plans" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All plans</SelectItem>
                {plans.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">User</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Plan</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Used</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Limit</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Today</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Resets</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">
                      No users found.
                    </td>
                  </tr>
                )}
                {users.map(u => {
                  const pct = u.effective_monthly_limit
                    ? Math.min(100, Math.round((u.scores_used_this_period / u.effective_monthly_limit) * 100))
                    : 0
                  const isHeavy = pct >= 80
                  return (
                    <tr key={u.user_id} className="hover:bg-muted/40 transition-colors">
                      <td className="px-6 py-3">
                        <span className="font-mono text-xs text-muted-foreground">
                          {u.email ?? u.user_id.slice(0, 12) + '…'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={PLAN_BADGE[u.plan_id] ?? 'outline'} className="text-xs">
                          {u.plan_name}
                        </Badge>
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${isHeavy ? 'text-amber-600 dark:text-amber-400 font-medium' : ''}`}>
                        {u.scores_used_this_period}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {u.effective_monthly_limit ?? '∞'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {u.scores_used_today}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                        {new Date(u.period_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openEdit(u)}
                        >
                          <Settings className="h-3.5 w-3.5" />
                          <span className="sr-only">Edit plan for {u.email}</span>
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-3 border-t">
              <span className="text-xs text-muted-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={currentPage <= 1 || isPending}
                  onClick={() => navigate(currentPage - 1)}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={currentPage >= totalPages || isPending}
                  onClick={() => navigate(currentPage + 1)}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={open => { if (!open) setEditTarget(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Plan</DialogTitle>
            <p className="text-xs text-muted-foreground mt-1 font-mono break-all">
              {editTarget?.email ?? editTarget?.userId}
            </p>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="plan-select">Plan</Label>
              <Select value={selectedPlan} onValueChange={v => setSelectedPlan(v as PlanId)}>
                <SelectTrigger id="plan-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {plans.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="override-input">Monthly scores override <span className="text-muted-foreground">(leave blank to use plan default)</span></Label>
              <Input
                id="override-input"
                type="number"
                min="0"
                placeholder="e.g. 25"
                value={overrideInput}
                onChange={e => setOverrideInput(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="credits-input">Grant extra credits this period</Label>
              <Input
                id="credits-input"
                type="number"
                min="1"
                placeholder="e.g. 10"
                value={creditsInput}
                onChange={e => setCreditsInput(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
