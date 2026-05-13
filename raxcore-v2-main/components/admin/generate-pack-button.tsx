'use client'

/**
 * Phase 53: Generate Training Pack Button
 * 
 * Triggers the full pack generation pipeline with filter configuration.
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
import { Checkbox } from '@/components/ui/checkbox'
import { Zap, Loader2 } from 'lucide-react'

interface GeneratePackButtonProps {
  packId: string
}

export function GeneratePackButton({ packId }: GeneratePackButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  
  // Filter options
  const [maxItems, setMaxItems] = useState('1000')
  const [minConfidence, setMinConfidence] = useState('')
  const [requireVerified, setRequireVerified] = useState(false)
  const [requireReverse, setRequireReverse] = useState(false)
  const [requireStructural, setRequireStructural] = useState(false)

  const handleGenerate = async () => {
    setLoading(true)
    setProgress('Starting generation...')
    
    try {
      const filterConfig = {
        max_items: maxItems ? parseInt(maxItems) : 1000,
        min_confidence_score: minConfidence ? parseFloat(minConfidence) : undefined,
        require_verified_score: requireVerified,
        require_reverse_run: requireReverse,
        require_structural_run: requireStructural,
      }

      const response = await fetch(`/api/admin/training-packs/${packId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterConfig }),
      })

      if (!response.ok) {
        throw new Error('Failed to generate pack')
      }

      const result = await response.json()
      setProgress(`Done! ${result.itemCount} items, ${result.labelCount} labels`)
      
      setTimeout(() => {
        setOpen(false)
        router.refresh()
      }, 1500)
    } catch (error) {
      console.error('Error generating pack:', error)
      setProgress('Error generating pack')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Zap className="h-4 w-4 mr-2" />
          Generate Pack
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Generate Training Pack</DialogTitle>
          <DialogDescription>
            Configure filters and run the full generation pipeline
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="maxItems">Max Items</Label>
            <Input
              id="maxItems"
              type="number"
              placeholder="1000"
              value={maxItems}
              onChange={(e) => setMaxItems(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="minConfidence">Min Confidence Score</Label>
            <Input
              id="minConfidence"
              type="number"
              step="0.1"
              placeholder="0.0 - 1.0 (optional)"
              value={minConfidence}
              onChange={(e) => setMinConfidence(e.target.value)}
            />
          </div>

          <div className="space-y-3">
            <Label>Requirements</Label>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="requireVerified"
                  checked={requireVerified}
                  onCheckedChange={(c) => setRequireVerified(c === true)}
                />
                <label htmlFor="requireVerified" className="text-sm">
                  Require verified ground truth score
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="requireReverse"
                  checked={requireReverse}
                  onCheckedChange={(c) => setRequireReverse(c === true)}
                />
                <label htmlFor="requireReverse" className="text-sm">
                  Require reverse engineering run
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="requireStructural"
                  checked={requireStructural}
                  onCheckedChange={(c) => setRequireStructural(c === true)}
                />
                <label htmlFor="requireStructural" className="text-sm">
                  Require structural solver run
                </label>
              </div>
            </div>
          </div>

          {progress && (
            <div className="p-3 bg-muted rounded-lg text-sm">
              {loading && <Loader2 className="h-4 w-4 inline mr-2 animate-spin" />}
              {progress}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleGenerate} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
