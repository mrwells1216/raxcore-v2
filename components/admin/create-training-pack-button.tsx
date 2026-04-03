'use client'

/**
 * Phase 53: Create Training Pack Button
 * 
 * Modal dialog for creating a new training pack with type selection.
 */

import { useState } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Loader2 } from 'lucide-react'
import type { TrainingPackType } from '@/lib/types'

const PACK_TYPES: { value: TrainingPackType; label: string; description: string }[] = [
  { 
    value: 'baseline_supervision_pack', 
    label: 'Baseline Supervision',
    description: 'General supervision events from scoring flow'
  },
  { 
    value: 'reverse_pass_pack', 
    label: 'Reverse Pass',
    description: 'Predictions improved by reverse engineering'
  },
  { 
    value: 'structural_solver_pack', 
    label: 'Structural Solver',
    description: 'Predictions where structural solver made changes'
  },
  { 
    value: 'hard_case_pack', 
    label: 'Hard Case',
    description: 'Hard-case pattern members for focused training'
  },
  { 
    value: 'confidence_failure_pack', 
    label: 'Confidence Failure',
    description: 'High-confidence misses for calibration'
  },
  { 
    value: 'segment_specific_pack', 
    label: 'Segment Specific',
    description: 'Predictions from specific segments'
  },
  { 
    value: 'candidate_finetune_pack', 
    label: 'Candidate Fine-tune',
    description: 'Pack for training a candidate model'
  },
  { 
    value: 'benchmark_holdout_pack', 
    label: 'Benchmark Holdout',
    description: 'Reserved holdout for benchmark testing'
  },
]

export function CreateTrainingPackButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [packType, setPackType] = useState<TrainingPackType>('baseline_supervision_pack')

  const handleCreate = async () => {
    if (!name.trim()) return
    
    setLoading(true)
    try {
      const response = await fetch('/api/admin/training-packs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          pack_type: packType,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to create training pack')
      }

      const pack = await response.json()
      setOpen(false)
      router.push(`/admin/training-packs/${pack.id}`)
      router.refresh()
    } catch (error) {
      console.error('Error creating pack:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          New Pack
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create Training Pack</DialogTitle>
          <DialogDescription>
            Create a new training pack for organizing supervision data
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="e.g., Q1 2026 Hard Cases"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="type">Pack Type</Label>
            <Select value={packType} onValueChange={(v) => setPackType(v as TrainingPackType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PACK_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    <div>
                      <div className="font-medium">{type.label}</div>
                      <div className="text-xs text-muted-foreground">{type.description}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="Describe what this pack is for..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={loading || !name.trim()}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Pack
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
