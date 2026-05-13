'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Plus, RefreshCw, Play, Loader2 } from 'lucide-react'
import {
  createExportPack,
  computeExportPackExamples,
  computeRetrainingReadiness,
} from '@/lib/retraining/service'
import type { ExportPackFilters, SplitConfig } from '@/lib/types'

// ============================================================================
// CREATE EXPORT PACK BUTTON
// ============================================================================

export function CreateExportPackButton() {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const handleCreate = () => {
    if (!name.trim()) return

    startTransition(async () => {
      const defaultSplitConfig: SplitConfig = {
        train_ratio: 0.7,
        validation_ratio: 0.15,
        test_ratio: 0.15,
        split_seed: 42,
        stratify_by: ['state', 'rack_type'],
        prevent_near_duplicate_leakage: true,
      }

      const defaultFilters: ExportPackFilters = {}

      const pack = await createExportPack({
        name: name.trim(),
        description: description.trim() || null,
        filters: defaultFilters,
        split_config: defaultSplitConfig,
        export_formats: ['json', 'csv'],
        include_image_urls: true,
        include_segment_context: true,
        include_health_metadata: true,
        targets_data_gap: null,
        gap_priority: 0,
        is_archived: false,
        created_by: null,
      })

      if (pack) {
        setOpen(false)
        setName('')
        setDescription('')
        router.refresh()
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1" />
          New Export Pack
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Export Pack</DialogTitle>
          <DialogDescription>
            Define a reusable dataset configuration for model training.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="e.g., Full Dataset v1"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="Describe the purpose of this export pack..."
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isPending || !name.trim()}>
            {isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// COMPUTE EXPORT PACK BUTTON
// ============================================================================

export function ComputeExportPackButton({ packId }: { packId: string }) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const handleCompute = () => {
    startTransition(async () => {
      const result = await computeExportPackExamples(packId)
      if (result.success) {
        router.refresh()
      } else {
        console.error('Failed to compute:', result.error)
      }
    })
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleCompute}
      disabled={isPending}
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Play className="h-4 w-4" />
      )}
      <span className="ml-1">Compute</span>
    </Button>
  )
}

// ============================================================================
// REFRESH READINESS BUTTON
// ============================================================================

export function RefreshReadinessButton() {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const handleRefresh = () => {
    startTransition(async () => {
      await computeRetrainingReadiness()
      router.refresh()
    })
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleRefresh}
      disabled={isPending}
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="h-4 w-4" />
      )}
      <span className="ml-1">Refresh</span>
    </Button>
  )
}
