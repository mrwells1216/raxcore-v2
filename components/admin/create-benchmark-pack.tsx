'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Package, Plus, Loader2, Search, X } from 'lucide-react'
import type { CalibrationProfile } from '@/lib/types'
import type { ModelVersionRecord } from '@/lib/storage/service'
import useSWR from 'swr'

interface CreateBenchmarkPackProps {
  modelVersions: ModelVersionRecord[]
  calibrationProfiles: CalibrationProfile[]
}

interface TrainingExample {
  id: string
  buck_id: string | null
  gross_score: number | null
  net_score: number | null
  state: string | null
  rack_type: string | null
  source_type: string | null
}

const fetcher = (url: string) => fetch(url).then(res => res.json())

export function CreateBenchmarkPack({ modelVersions, calibrationProfiles }: CreateBenchmarkPackProps) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [selectedExamples, setSelectedExamples] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  
  // Filters
  const [stateFilter, setStateFilter] = useState<string>('all')
  const [rackTypeFilter, setRackTypeFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Fetch training examples
  const { data: examplesData, isLoading } = useSWR<{ success: boolean; data: TrainingExample[] }>(
    '/api/admin/training?limit=500&hasGroundTruth=true',
    fetcher
  )

  const examples = examplesData?.data || []

  // Get unique filter values
  const states = [...new Set(examples.map(e => e.state).filter(Boolean))]
  const rackTypes = [...new Set(examples.map(e => e.rack_type).filter(Boolean))]

  // Apply filters
  const filteredExamples = examples.filter(ex => {
    if (stateFilter !== 'all' && ex.state !== stateFilter) return false
    if (rackTypeFilter !== 'all' && ex.rack_type !== rackTypeFilter) return false
    if (searchQuery && !ex.buck_id?.toLowerCase().includes(searchQuery.toLowerCase())) return false
    return true
  })

  const addTag = () => {
    const trimmed = tagInput.trim().toLowerCase()
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed])
      setTagInput('')
    }
  }

  const removeTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag))
  }

  const toggleExample = (id: string) => {
    const newSelected = new Set(selectedExamples)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedExamples(newSelected)
  }

  const selectAllFiltered = () => {
    const newSelected = new Set(selectedExamples)
    filteredExamples.forEach(ex => newSelected.add(ex.id))
    setSelectedExamples(newSelected)
  }

  const clearSelection = () => {
    setSelectedExamples(new Set())
  }

  const handleSubmit = async () => {
    if (!name.trim() || selectedExamples.size === 0) return

    setCreating(true)
    try {
      const res = await fetch('/api/admin/benchmarks/packs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          tags,
          example_ids: Array.from(selectedExamples),
        }),
      })

      if (res.ok) {
        const data = await res.json()
        router.push(`/admin/benchmarks/${data.data.id}`)
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to create benchmark pack')
      }
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Pack Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Pack Details
          </CardTitle>
          <CardDescription>
            Define the benchmark pack name, description, and tags.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Pack Name *</Label>
            <Input
              id="name"
              placeholder="e.g., Core Regression Suite"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Describe what this benchmark pack tests..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Add tag..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
              />
              <Button type="button" variant="outline" size="icon" onClick={addTag}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {tags.map(tag => (
                  <Badge key={tag} variant="secondary" className="gap-1">
                    {tag}
                    <button onClick={() => removeTag(tag)} className="ml-1 hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex justify-between border-t pt-4">
          <div className="text-sm text-muted-foreground">
            {selectedExamples.size} examples selected
          </div>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || selectedExamples.size === 0 || creating}
          >
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Package className="h-4 w-4 mr-2" />
                Create Pack
              </>
            )}
          </Button>
        </CardFooter>
      </Card>

      {/* Example Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Select Examples</CardTitle>
          <CardDescription>
            Choose training examples with ground truth to include in this pack.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by Buck ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            <Select value={stateFilter} onValueChange={setStateFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="State" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All States</SelectItem>
                {states.map(state => (
                  <SelectItem key={state} value={state!}>{state}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={rackTypeFilter} onValueChange={setRackTypeFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Rack Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {rackTypes.map(type => (
                  <SelectItem key={type} value={type!}>{type}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Selection Actions */}
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {filteredExamples.length} examples match filters
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={selectAllFiltered}>
                Select All Filtered
              </Button>
              <Button variant="outline" size="sm" onClick={clearSelection}>
                Clear
              </Button>
            </div>
          </div>

          {/* Examples List */}
          <div className="border rounded-md max-h-[400px] overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredExamples.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                No examples match the current filters.
              </div>
            ) : (
              <div className="divide-y">
                {filteredExamples.slice(0, 100).map(ex => (
                  <div
                    key={ex.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer"
                    onClick={() => toggleExample(ex.id)}
                  >
                    <Checkbox
                      checked={selectedExamples.has(ex.id)}
                      onCheckedChange={() => toggleExample(ex.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{ex.buck_id || ex.id.slice(0, 8)}</p>
                      <p className="text-xs text-muted-foreground">
                        {ex.state} | {ex.rack_type} | Gross: {ex.gross_score?.toFixed(0) || '-'}
                      </p>
                    </div>
                  </div>
                ))}
                {filteredExamples.length > 100 && (
                  <div className="text-center py-2 text-sm text-muted-foreground">
                    Showing first 100 of {filteredExamples.length} examples
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
