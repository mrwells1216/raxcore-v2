'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TrendingUp, TrendingDown, Minus, Search, Filter, Trophy, AlertTriangle } from 'lucide-react'
import type { ModelComparisonDetail } from '@/lib/types'
import type { ModelVersionRecord } from '@/lib/storage/service'

interface ModelComparisonViewProps {
  primaryModelId: string | null
  comparisonDetails: ModelComparisonDetail[]
  modelVersions: ModelVersionRecord[]
}

type FilterType = 'all' | 'improved' | 'worsened' | 'unchanged'

export function ModelComparisonView({
  primaryModelId,
  comparisonDetails,
  modelVersions,
}: ModelComparisonViewProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<FilterType>('all')
  const [sortBy, setSortBy] = useState<'error' | 'improvement' | 'groundTruth'>('error')

  const getModelName = (modelVersionId: string | null) => {
    if (!modelVersionId) return 'Primary'
    const model = modelVersions.find((m) => m.id === modelVersionId)
    return model?.version_name || 'Unknown'
  }

  const filteredAndSorted = useMemo(() => {
    let filtered = comparisonDetails

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (d) =>
          d.buck_id?.toLowerCase().includes(query) ||
          d.training_example_id.toLowerCase().includes(query)
      )
    }

    // Type filter
    if (filterType !== 'all') {
      filtered = filtered.filter((d) => {
        const primaryResult = d.results.find((r) => r.model_version_id === primaryModelId)
        const comparisonResult = d.results.find((r) => r.model_version_id !== primaryModelId)

        if (!primaryResult || !comparisonResult) return false

        const primaryAbsError = Math.abs(primaryResult.error_gross)
        const comparisonAbsError = Math.abs(comparisonResult.error_gross)

        switch (filterType) {
          case 'improved':
            return primaryAbsError < comparisonAbsError
          case 'worsened':
            return primaryAbsError > comparisonAbsError
          case 'unchanged':
            return primaryAbsError === comparisonAbsError
          default:
            return true
        }
      })
    }

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      const aPrimary = a.results.find((r) => r.model_version_id === primaryModelId)
      const bPrimary = b.results.find((r) => r.model_version_id === primaryModelId)

      switch (sortBy) {
        case 'error':
          return Math.abs(bPrimary?.error_gross || 0) - Math.abs(aPrimary?.error_gross || 0)
        case 'improvement':
          const aComparison = a.results.find((r) => r.model_version_id !== primaryModelId)
          const bComparison = b.results.find((r) => r.model_version_id !== primaryModelId)
          const aImprovement = (aComparison?.error_diff_vs_primary || 0)
          const bImprovement = (bComparison?.error_diff_vs_primary || 0)
          return bImprovement - aImprovement
        case 'groundTruth':
          return b.ground_truth_gross - a.ground_truth_gross
        default:
          return 0
      }
    })

    return sorted
  }, [comparisonDetails, searchQuery, filterType, sortBy, primaryModelId])

  // Stats
  const stats = useMemo(() => {
    let improved = 0
    let worsened = 0
    let unchanged = 0

    comparisonDetails.forEach((d) => {
      const primaryResult = d.results.find((r) => r.model_version_id === primaryModelId)
      const comparisonResult = d.results.find((r) => r.model_version_id !== primaryModelId)

      if (primaryResult && comparisonResult) {
        const primaryAbsError = Math.abs(primaryResult.error_gross)
        const comparisonAbsError = Math.abs(comparisonResult.error_gross)

        if (primaryAbsError < comparisonAbsError) improved++
        else if (primaryAbsError > comparisonAbsError) worsened++
        else unchanged++
      }
    })

    return { improved, worsened, unchanged, total: comparisonDetails.length }
  }, [comparisonDetails, primaryModelId])

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card
          className={`cursor-pointer transition-colors ${
            filterType === 'improved' ? 'ring-2 ring-green-500' : ''
          }`}
          onClick={() => setFilterType(filterType === 'improved' ? 'all' : 'improved')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Improved</p>
                <p className="text-2xl font-bold text-green-600">{stats.improved}</p>
                <p className="text-xs text-muted-foreground">
                  {stats.total > 0 ? ((stats.improved / stats.total) * 100).toFixed(0) : 0}% of
                  examples
                </p>
              </div>
              <Trophy className="h-8 w-8 text-green-500 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer transition-colors ${
            filterType === 'worsened' ? 'ring-2 ring-red-500' : ''
          }`}
          onClick={() => setFilterType(filterType === 'worsened' ? 'all' : 'worsened')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Worsened</p>
                <p className="text-2xl font-bold text-red-600">{stats.worsened}</p>
                <p className="text-xs text-muted-foreground">
                  {stats.total > 0 ? ((stats.worsened / stats.total) * 100).toFixed(0) : 0}% of
                  examples
                </p>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-500 opacity-50" />
            </div>
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer transition-colors ${
            filterType === 'unchanged' ? 'ring-2 ring-gray-500' : ''
          }`}
          onClick={() => setFilterType(filterType === 'unchanged' ? 'all' : 'unchanged')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Unchanged</p>
                <p className="text-2xl font-bold text-gray-600">{stats.unchanged}</p>
                <p className="text-xs text-muted-foreground">
                  {stats.total > 0 ? ((stats.unchanged / stats.total) * 100).toFixed(0) : 0}% of
                  examples
                </p>
              </div>
              <Minus className="h-8 w-8 text-gray-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Search */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Side-by-Side Comparison</CardTitle>
          <CardDescription>
            Compare each example&apos;s results across model versions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="error">Largest Error</SelectItem>
                  <SelectItem value="improvement">Most Improvement</SelectItem>
                  <SelectItem value="groundTruth">Highest Score</SelectItem>
                </SelectContent>
              </Select>
              {filterType !== 'all' && (
                <Button variant="ghost" size="sm" onClick={() => setFilterType('all')}>
                  Clear Filter
                </Button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Example</TableHead>
                  <TableHead className="text-right">Ground Truth</TableHead>
                  {comparisonDetails[0]?.results.map((r) => (
                    <TableHead key={r.model_version_id || 'primary'} className="text-center">
                      <Badge variant={r.model_version_id === primaryModelId ? 'default' : 'outline'}>
                        {getModelName(r.model_version_id)}
                      </Badge>
                    </TableHead>
                  ))}
                  <TableHead className="text-center">Best Model</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAndSorted.slice(0, 50).map((detail) => (
                  <TableRow key={detail.training_example_id}>
                    <TableCell>
                      <span className="font-mono text-xs">
                        {detail.buck_id?.slice(0, 8) || detail.training_example_id.slice(0, 8)}...
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {detail.ground_truth_gross.toFixed(1)}&quot;
                    </TableCell>
                    {detail.results.map((r) => {
                      const isPrimary = r.model_version_id === primaryModelId
                      const isBest = r.model_version_id === detail.best_model_version_id

                      return (
                        <TableCell
                          key={r.model_version_id || 'primary'}
                          className={`text-center ${isBest ? 'bg-green-500/5' : ''}`}
                        >
                          <div className="flex flex-col items-center gap-1">
                            <span className="font-mono">{r.final_gross.toFixed(1)}&quot;</span>
                            <span
                              className={`text-xs font-mono ${
                                Math.abs(r.error_gross) <= 5
                                  ? 'text-green-600'
                                  : Math.abs(r.error_gross) <= 10
                                  ? 'text-blue-600'
                                  : Math.abs(r.error_gross) <= 15
                                  ? 'text-yellow-600'
                                  : 'text-red-600'
                              }`}
                            >
                              {r.error_gross > 0 ? '+' : ''}
                              {r.error_gross.toFixed(1)}
                            </span>
                            {!isPrimary && r.error_diff_vs_primary != null && (
                              <span className="flex items-center gap-0.5 text-xs">
                                {r.error_diff_vs_primary < 0 ? (
                                  <>
                                    <TrendingDown className="h-3 w-3 text-green-500" />
                                    <span className="text-green-600">
                                      {r.error_diff_vs_primary.toFixed(1)}
                                    </span>
                                  </>
                                ) : r.error_diff_vs_primary > 0 ? (
                                  <>
                                    <TrendingUp className="h-3 w-3 text-red-500" />
                                    <span className="text-red-600">
                                      +{r.error_diff_vs_primary.toFixed(1)}
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </span>
                            )}
                          </div>
                        </TableCell>
                      )
                    })}
                    <TableCell className="text-center">
                      <Badge
                        variant={
                          detail.best_model_version_id === primaryModelId ? 'default' : 'outline'
                        }
                        className="text-xs"
                      >
                        {getModelName(detail.best_model_version_id)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {filteredAndSorted.length > 50 && (
            <p className="text-sm text-muted-foreground mt-4 text-center">
              Showing 50 of {filteredAndSorted.length} results
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
