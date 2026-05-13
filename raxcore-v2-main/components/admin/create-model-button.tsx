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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Loader2 } from 'lucide-react'
import { createCandidateModel } from '@/lib/retraining/service'
import type { ExportPack } from '@/lib/types'

export function CreateModelButton({ exportPacks }: { exportPacks: ExportPack[] }) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const [name, setName] = useState('')
  const [version, setVersion] = useState('')
  const [description, setDescription] = useState('')
  const [exportPackId, setExportPackId] = useState<string>('')
  const [trainingApproach, setTrainingApproach] = useState('')
  const [trainingNotes, setTrainingNotes] = useState('')

  const handleCreate = () => {
    if (!name.trim() || !version.trim()) return

    startTransition(async () => {
      const model = await createCandidateModel({
        name: name.trim(),
        version: version.trim(),
        description: description.trim() || null,
        export_pack_id: exportPackId || null,
        training_approach: trainingApproach.trim() || null,
        training_notes: trainingNotes.trim() || null,
        status: 'pending',
        metrics_summary: null,
        comparison_to_production: null,
        created_by: null,
      })

      if (model) {
        setOpen(false)
        setName('')
        setVersion('')
        setDescription('')
        setExportPackId('')
        setTrainingApproach('')
        setTrainingNotes('')
        router.refresh()
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1" />
          Register Model
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Register Candidate Model</DialogTitle>
          <DialogDescription>
            Add a new model candidate for offline evaluation before production promotion.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Model Name</Label>
              <Input
                id="name"
                placeholder="e.g., RaxCore Vision"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="version">Version</Label>
              <Input
                id="version"
                placeholder="e.g., 2.1.0"
                value={version}
                onChange={e => setVersion(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Input
              id="description"
              placeholder="Brief description of this model version"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="exportPack">Training Export Pack</Label>
            <Select value={exportPackId} onValueChange={setExportPackId}>
              <SelectTrigger>
                <SelectValue placeholder="Select export pack used for training" />
              </SelectTrigger>
              <SelectContent>
                {exportPacks.map(pack => (
                  <SelectItem key={pack.id} value={pack.id}>
                    {pack.name} ({pack.example_count} examples)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="approach">Training Approach</Label>
            <Input
              id="approach"
              placeholder="e.g., Fine-tuned GPT-4V with 2000 examples"
              value={trainingApproach}
              onChange={e => setTrainingApproach(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Training Notes</Label>
            <Textarea
              id="notes"
              placeholder="Any additional notes about training configuration, hyperparameters, etc."
              value={trainingNotes}
              onChange={e => setTrainingNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isPending || !name.trim() || !version.trim()}>
            {isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Register
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
