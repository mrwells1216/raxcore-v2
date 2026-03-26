'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp, ExternalLink, Info, AlertTriangle, CheckCircle, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { ExtendedLearningSummary } from '@/lib/types'

interface LearningExplainabilityPanelProps {
  summary: ExtendedLearningSummary | null | undefined
  className?: string
}

export function LearningExplainabilityPanel({ summary, className }: LearningExplainabilityPanelProps) {
  const [showInfluentialExamples, setShowInfluentialExamples] = useState(false)
  const [showMeasurementCorrections, setShowMeasurementCorrections] = useState(false)

  if (!summary) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Info className="h-5 w-5 text-muted-foreground" />
            Learning Correction
          </CardTitle>
          <CardDescription>No learning data available for this prediction.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const getCorrectionDirectionIcon = () => {
    switch (summary.correctionDirection) {
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

  const getStrengthBadgeVariant = (strength: string) => {
    switch (strength) {
      case 'high':
        return 'default'
      case 'medium':
        return 'secondary'
      case 'low':
        return 'outline'
      default:
        return 'outline'
    }
  }

  const getMatchQualityBadgeVariant = (quality: string) => {
    switch (quality) {
      case 'strong':
        return 'default'
      case 'moderate':
        return 'secondary'
      case 'weak':
        return 'outline'
      default:
        return 'outline'
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Info className="h-5 w-5" />
          Learning Correction (Phase 10)
        </CardTitle>
        <CardDescription>
          Similarity-weighted corrections from verified training examples.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <p className="text-2xl font-bold">{summary.verifiedExamplesConsidered}</p>
            <p className="text-xs text-muted-foreground">Examples Considered</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <p className="text-2xl font-bold">{summary.highlySimilarExamplesUsed}</p>
            <p className="text-xs text-muted-foreground">Highly Similar</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <p className="text-2xl font-bold">{(summary.exampleConsistency * 100).toFixed(0)}%</p>
            <p className="text-xs text-muted-foreground">Consistency</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <Badge variant={getMatchQualityBadgeVariant(summary.matchQuality)} className="mt-1">
              {summary.matchQuality} match
            </Badge>
            <p className="text-xs text-muted-foreground mt-1">Quality</p>
          </div>
        </div>

        <Separator />

        {/* Correction Applied */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium flex items-center gap-2">
              {getCorrectionDirectionIcon()}
              Correction Applied
            </p>
            <Badge variant={getStrengthBadgeVariant(summary.correctionStrength)}>
              {summary.correctionStrength} strength
            </Badge>
          </div>
          
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Gross</p>
              <p className={`font-medium ${summary.grossAdjustmentApplied > 0 ? 'text-green-600' : summary.grossAdjustmentApplied < 0 ? 'text-orange-600' : ''}`}>
                {summary.grossAdjustmentApplied > 0 ? '+' : ''}{summary.grossAdjustmentApplied.toFixed(2)}&quot;
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Net</p>
              <p className={`font-medium ${summary.netAdjustmentApplied > 0 ? 'text-green-600' : summary.netAdjustmentApplied < 0 ? 'text-orange-600' : ''}`}>
                {summary.netAdjustmentApplied > 0 ? '+' : ''}{summary.netAdjustmentApplied.toFixed(2)}&quot;
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Confidence</p>
              <p className="font-medium text-blue-600">+{summary.confidenceAdjustmentApplied.toFixed(1)}%</p>
            </div>
          </div>

          {summary.correctionCapped && (
            <div className="flex items-center gap-2 text-sm text-orange-600 bg-orange-50 dark:bg-orange-950/20 p-2 rounded">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>{summary.cappingReason}</span>
            </div>
          )}
        </div>

        <Separator />

        {/* Matching Features */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Strongest Matching Features</p>
          <div className="flex flex-wrap gap-1">
            {summary.strongestMatchingFeatures.length > 0 ? (
              summary.strongestMatchingFeatures.map((feature, i) => (
                <Badge key={i} variant="secondary" className="text-xs">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  {feature}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">None</span>
            )}
          </div>

          {summary.weakestMatchingFeatures.length > 0 && (
            <>
              <p className="text-sm font-medium pt-2">Missing Features</p>
              <div className="flex flex-wrap gap-1">
                {summary.weakestMatchingFeatures.map((feature, i) => (
                  <Badge key={i} variant="outline" className="text-xs text-muted-foreground">
                    {feature}
                  </Badge>
                ))}
              </div>
            </>
          )}
        </div>

        <Separator />

        {/* Notes */}
        {summary.notes.length > 0 && (
          <div className="space-y-1">
            <p className="text-sm font-medium">Learning Notes</p>
            <ul className="text-sm text-muted-foreground space-y-1">
              {summary.notes.map((note, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Expandable: Per-Measurement Corrections */}
        {summary.measurementCorrections.length > 0 && (
          <div className="space-y-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between"
              onClick={() => setShowMeasurementCorrections(!showMeasurementCorrections)}
            >
              <span className="text-sm font-medium">Per-Measurement Corrections ({summary.measurementCorrections.length})</span>
              {showMeasurementCorrections ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>

            {showMeasurementCorrections && (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2 font-medium">Field</th>
                      <th className="text-right p-2 font-medium">Original</th>
                      <th className="text-right p-2 font-medium">Correction</th>
                      <th className="text-right p-2 font-medium">Corrected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.measurementCorrections.map((mc, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2 font-mono text-xs">{mc.field.replace(/_/g, ' ')}</td>
                        <td className="p-2 text-right">{mc.originalValue.toFixed(1)}&quot;</td>
                        <td className={`p-2 text-right ${mc.correction > 0 ? 'text-green-600' : mc.correction < 0 ? 'text-orange-600' : ''}`}>
                          {mc.correction > 0 ? '+' : ''}{mc.correction.toFixed(2)}&quot;
                        </td>
                        <td className="p-2 text-right font-medium">{mc.correctedValue.toFixed(1)}&quot;</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Expandable: Influential Examples */}
        {summary.influentialExamples.length > 0 && (
          <div className="space-y-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between"
              onClick={() => setShowInfluentialExamples(!showInfluentialExamples)}
            >
              <span className="text-sm font-medium">Influential Examples ({summary.influentialExamples.length})</span>
              {showInfluentialExamples ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>

            {showInfluentialExamples && (
              <div className="space-y-2">
                {summary.influentialExamples.map((ex, i) => (
                  <div key={i} className="border rounded-lg p-3 text-sm space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{(ex.similarity * 100).toFixed(0)}% match</Badge>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Link href={`/admin/submissions/${ex.buckId}`} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                                View buck <ExternalLink className="h-3 w-3" />
                              </Link>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Buck ID: {ex.buckId}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <div className="text-right">
                        <span className={`font-medium ${ex.errorContribution > 0 ? 'text-green-600' : ex.errorContribution < 0 ? 'text-orange-600' : ''}`}>
                          {ex.errorContribution > 0 ? '+' : ''}{ex.errorContribution.toFixed(1)}&quot; error
                        </span>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Predicted: {ex.predictedScore.toFixed(1)}&quot;</span>
                      <span>Ground Truth: {ex.groundTruthScore.toFixed(1)}&quot;</span>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {ex.matchingFeatures.slice(0, 4).map((feature, fi) => (
                        <Badge key={fi} variant="secondary" className="text-xs">
                          {feature}
                        </Badge>
                      ))}
                      {ex.matchingFeatures.length > 4 && (
                        <Badge variant="outline" className="text-xs">
                          +{ex.matchingFeatures.length - 4} more
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
