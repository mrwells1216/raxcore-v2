'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { TrainingPack, ScoringVariant } from '@/lib/types'

interface LinkTrainingPackDialogProps {
  variant: ScoringVariant
  availablePacks: TrainingPack[]
  onLinked?: (packId: string) => void
  trigger?: React.ReactNode
}

export function LinkTrainingPackDialog({
  variant,
  availablePacks,
  onLinked,
  trigger,
}: LinkTrainingPackDialogProps) {
  const [open, setOpen] = useState(false)
  const [selectedPackId, setSelectedPackId] = useState<string>('')
  const [loading, setLoading] = useState(false)

  async function handleLink() {
    if (!selectedPackId) return

    setLoading(true)
    try {
      const res = await fetch(`/api/admin/variants/${variant.id}/link-pack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trainingPackId: selectedPackId }),
      })

      if (!res.ok) throw new Error('Failed to link')

      onLinked?.(selectedPackId)
      setOpen(false)
      setSelectedPackId('')
    } catch (error) {
      console.error('Error linking pack:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm" variant="outline">
            Link Training Pack
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link Training Pack</DialogTitle>
          <DialogDescription>
            Associate a training pack with {variant.name} for evaluation
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Select Training Pack</label>
            <Select value={selectedPackId} onValueChange={setSelectedPackId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a pack..." />
              </SelectTrigger>
              <SelectContent>
                {availablePacks.map((pack) => (
                  <SelectItem key={pack.id} value={pack.id}>
                    <div className="flex items-center gap-2">
                      <span>{pack.name}</span>
                      <Badge variant="secondary" className="text-xs">
                        {pack.pack_type}
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleLink}
              disabled={!selectedPackId || loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Linking...
                </>
              ) : (
                'Link Pack'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
