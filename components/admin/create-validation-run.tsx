'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'

export function CreateValidationRun() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  
  const [runName, setRunName] = useState('')
  const [includeUnverified, setIncludeUnverified] = useState(false)
  const [minScore, setMinScore] = useState('')
  const [maxScore, setMaxScore] = useState('')
  const [sampleSize, setSampleSize] = useState('')

  const handleCreate = () => {
    if (!runName.trim()) {
      toast.error('Please enter a run name')
      return
    }

    startTransition(async () => {
      try {
        const config: Record<string, unknown> = {
          include_unverified: includeUnverified
        }

        if (minScore) config.score_range_min = parseFloat(minScore)
        if (maxScore) config.score_range_max = parseFloat(maxScore)
        if (sampleSize) config.sample_size = parseInt(sampleSize)

        const response = await fetch('/api/admin/validation/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runName: runName.trim(),
            config
          }),
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to create validation run')
        }

        toast.success(`Created validation run with ${data.eligibleExamples} examples`)
        setRunName('')
        setIncludeUnverified(false)
        setMinScore('')
        setMaxScore('')
        setSampleSize('')
        router.refresh()
      } catch (error) {
        console.error('Create error:', error)
        toast.error(error instanceof Error ? error.message : 'Failed to create validation run')
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">New Validation Run</CardTitle>
        <CardDescription>
          Create a new validation run to test model accuracy.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="run-name">Run Name</Label>
          <Input
            id="run-name"
            placeholder="e.g., Weekly validation - Mar 2026"
            value={runName}
            onChange={(e) => setRunName(e.target.value)}
            className="min-h-[44px]"
          />
        </div>

        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="filters">
            <AccordionTrigger className="text-sm">
              Advanced Filters
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="include-unverified" className="flex-1">
                  Include Unverified Examples
                </Label>
                <Switch
                  id="include-unverified"
                  checked={includeUnverified}
                  onCheckedChange={setIncludeUnverified}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="min-score">Min Score</Label>
                  <Input
                    id="min-score"
                    type="number"
                    placeholder="e.g., 100"
                    value={minScore}
                    onChange={(e) => setMinScore(e.target.value)}
                    className="min-h-[44px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-score">Max Score</Label>
                  <Input
                    id="max-score"
                    type="number"
                    placeholder="e.g., 200"
                    value={maxScore}
                    onChange={(e) => setMaxScore(e.target.value)}
                    className="min-h-[44px]"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sample-size">Sample Size (optional)</Label>
                <Input
                  id="sample-size"
                  type="number"
                  placeholder="Leave empty for all"
                  value={sampleSize}
                  onChange={(e) => setSampleSize(e.target.value)}
                  className="min-h-[44px]"
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <Button 
          onClick={handleCreate} 
          disabled={isPending || !runName.trim()}
          className="w-full min-h-[44px]"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Plus className="h-4 w-4 mr-2" />
          )}
          Create Validation Run
        </Button>
      </CardContent>
    </Card>
  )
}
