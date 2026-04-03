'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Ruler, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import type { MeasurementCorrectionSummary, MeasurementCategory, CategoryCorrectionSummary, FieldCorrectionDetail } from '@/lib/types'

interface MeasurementCorrectionPanelProps {
  summary: MeasurementCorrectionSummary | null | undefined
  className?: string
}

const categoryLabels: Record<MeasurementCategory, string> = {
  spread: 'Inside Spread',
  beam: 'Main Beams',
  tine: 'Tine Lengths',
  mass: 'Mass/Circumference',
  deduction: 'Deductions',
}

const categoryIcons: Record<MeasurementCategory, string> = {
  spread: 'Width',
  beam: 'Length',
  tine: 'Height',
  mass: 'Circle',
  deduction: 'Minus',
}

export function MeasurementCorrectionPanel({ summary, className }: MeasurementCorrectionPanelProps) {
  const [showCategoryDetails, setShowCategoryDetails] = useState(false)
  const [showFieldDetails, setShowFieldDetails] = useState(false)

  if (!summary) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Ruler className="h-5 w-5 text-muted-foreground" />
            Measurement-Level Correction
          </CardTitle>
          <CardDescription>No measurement correction data available for this prediction.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const getDirectionIcon = (direction: 'increase' | 'decrease' | 'none' | 'mixed') => {
    switch (direction) {
      case 'increase':
        return <TrendingUp className="h-4 w-4 text-green-600" />
      case 'decrease':
        return <TrendingDown className="h-4 w-4 text-orange-600" />
      case 'mixed':
        return <Minus className="h-4 w-4 text-blue-600" />
      default:
        return <Minus className="h-4 w-4 text-muted-foreground" />
    }
  }

  const getStrengthColor = (strength: string): string => {
    switch (strength) {
      case 'high':
        return 'bg-primary text-primary-foreground'
      case 'medium':
        return 'bg-secondary text-secondary-foreground'
      case 'low':
        return 'bg-muted text-muted-foreground'
      default:
        return 'bg-muted text-muted-foreground'
    }
  }

  const getCorrectionColor = (value: number): string => {
    if (value > 0.1) return 'text-green-600'
    if (value < -0.1) return 'text-orange-600'
    return 'text-muted-foreground'
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Ruler className="h-5 w-5" />
          Measurement-Level Correction (Phase 21)
        </CardTitle>
        <CardDescription>
          Per-category corrections applied before final score calculation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <p className="text-2xl font-bold">{summary.verifiedExamplesUsed}</p>
            <p className="text-xs text-muted-foreground">Examples Used</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <p className="text-2xl font-bold">{summary.highlySimilarExamplesUsed}</p>
            <p className="text-xs text-muted-foreground">Highly Similar</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <p className="text-2xl font-bold">{summary.totalCategoriesCorrected}</p>
            <p className="text-xs text-muted-foreground">Categories Corrected</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <p className="text-2xl font-bold">{summary.totalFieldsCorrected}</p>
            <p className="text-xs text-muted-foreground">Fields Corrected</p>
          </div>
        </div>

        <Separator />

        {/* Overall Correction */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium flex items-center gap-2">
              {getDirectionIcon(summary.overallCorrectionDirection)}
              Total Score Correction
            </p>
            <Badge className={getStrengthColor(summary.correctionStrength)}>
              {summary.correctionStrength} strength
            </Badge>
          </div>
          
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Gross Correction</p>
              <p className={`text-xl font-bold ${getCorrectionColor(summary.grossCorrectionApplied)}`}>
                {summary.grossCorrectionApplied > 0 ? '+' : ''}{summary.grossCorrectionApplied.toFixed(2)}&quot;
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Net Correction</p>
              <p className={`text-xl font-bold ${getCorrectionColor(summary.netCorrectionApplied)}`}>
                {summary.netCorrectionApplied > 0 ? '+' : ''}{summary.netCorrectionApplied.toFixed(2)}&quot;
              </p>
            </div>
          </div>
        </div>

        <Separator />

        {/* Strongest/Weakest */}
        <div className="grid grid-cols-2 gap-4">
          {summary.strongestCorrection && (
            <div className="p-3 rounded-lg border border-primary/20 bg-primary/5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Strongest Correction</p>
              <p className="font-medium mt-1">{categoryLabels[summary.strongestCorrection.category]}</p>
              <p className={`text-sm ${getCorrectionColor(summary.strongestCorrection.amount)}`}>
                {summary.strongestCorrection.amount > 0 ? '+' : ''}{summary.strongestCorrection.amount.toFixed(2)}&quot;
                ({summary.strongestCorrection.direction})
              </p>
            </div>
          )}
          {summary.weakestCategory && (
            <div className="p-3 rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/20">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Weakest Evidence</p>
              <p className="font-medium mt-1">{categoryLabels[summary.weakestCategory]}</p>
              <p className="text-sm text-orange-600">
                Low confidence - needs more examples
              </p>
            </div>
          )}
        </div>

        {/* Confidence */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Weighted Confidence</span>
            <span className="font-medium">{(summary.confidenceWeightedAvg * 100).toFixed(0)}%</span>
          </div>
          <Progress value={summary.confidenceWeightedAvg * 100} className="h-2" />
        </div>

        {/* Notes */}
        {summary.notes.length > 0 && (
          <div className="space-y-1 bg-muted/30 rounded-lg p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Correction Notes</p>
            <ul className="text-sm space-y-1">
              {summary.notes.map((note, i) => (
                <li key={i} className="flex items-start gap-2">
                  <CheckCircle className="h-3.5 w-3.5 mt-0.5 text-primary flex-shrink-0" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Expandable: Category Details */}
        {summary.categoryCorrections && summary.categoryCorrections.length > 0 && (
          <div className="space-y-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between"
              onClick={() => setShowCategoryDetails(!showCategoryDetails)}
            >
              <span className="text-sm font-medium">Category Breakdown ({summary.categoryCorrections.length})</span>
              {showCategoryDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>

            {showCategoryDetails && (
              <div className="space-y-2">
                {summary.categoryCorrections.map((cat, i) => (
                  <CategoryCorrectionCard key={i} correction={cat} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Expandable: Field Details */}
        {summary.fieldCorrections && summary.fieldCorrections.length > 0 && (
          <div className="space-y-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between"
              onClick={() => setShowFieldDetails(!showFieldDetails)}
            >
              <span className="text-sm font-medium">Per-Field Corrections ({summary.fieldCorrections.length})</span>
              {showFieldDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>

            {showFieldDetails && (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2 font-medium">Field</th>
                      <th className="text-left p-2 font-medium">Category</th>
                      <th className="text-right p-2 font-medium">Original</th>
                      <th className="text-right p-2 font-medium">Correction</th>
                      <th className="text-right p-2 font-medium">Final</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.fieldCorrections.map((fc, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2 font-mono text-xs">{fc.field.replace(/_/g, ' ')}</td>
                        <td className="p-2">
                          <Badge variant="outline" className="text-xs capitalize">
                            {fc.category}
                          </Badge>
                        </td>
                        <td className="p-2 text-right">{fc.originalValue.toFixed(1)}&quot;</td>
                        <td className={`p-2 text-right font-medium ${fc.correction > 0 ? 'text-green-600' : fc.correction < 0 ? 'text-orange-600' : ''}`}>
                          {fc.correction > 0 ? '+' : ''}{fc.correction.toFixed(2)}&quot;
                        </td>
                        <td className="p-2 text-right font-medium">{fc.correctedValue.toFixed(1)}&quot;</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CategoryCorrectionCard({ correction }: { correction: CategoryCorrectionSummary }) {
  const getDirectionBadge = () => {
    if (correction.direction === 'increase') {
      return <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">Increased</Badge>
    }
    if (correction.direction === 'decrease') {
      return <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300">Decreased</Badge>
    }
    return <Badge variant="outline">No Change</Badge>
  }

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="font-medium">{categoryLabels[correction.category]}</p>
          {getDirectionBadge()}
        </div>
        {correction.capped && (
          <Badge variant="outline" className="text-orange-600 border-orange-300">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Capped
          </Badge>
        )}
      </div>
      
      <div className="grid grid-cols-4 gap-2 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Original</p>
          <p className="font-medium">{correction.originalTotal.toFixed(1)}&quot;</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Correction</p>
          <p className={`font-medium ${correction.correctionAmount > 0 ? 'text-green-600' : correction.correctionAmount < 0 ? 'text-orange-600' : ''}`}>
            {correction.correctionAmount > 0 ? '+' : ''}{correction.correctionAmount.toFixed(2)}&quot;
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Final</p>
          <p className="font-medium">{correction.correctedTotal.toFixed(1)}&quot;</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Samples</p>
          <p className="font-medium">{correction.sampleCount}</p>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Confidence: {(correction.confidence * 100).toFixed(0)}%</span>
        <span className="text-muted-foreground">Change: {correction.correctionPercent > 0 ? '+' : ''}{correction.correctionPercent.toFixed(1)}%</span>
      </div>

      {correction.cappingReason && (
        <p className="text-xs text-orange-600 bg-orange-50 dark:bg-orange-950/20 p-2 rounded">
          {correction.cappingReason}
        </p>
      )}
    </div>
  )
}
