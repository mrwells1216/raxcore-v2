'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { 
  Phase495Metadata, 
  MeasurementFamily,
  CrossViewFusionStrategy,
  DisagreementLevel 
} from '@/lib/types'
import { 
  AlertTriangle, 
  CheckCircle, 
  Eye, 
  Layers, 
  SplitSquareHorizontal,
  XCircle,
  ArrowRight,
  Wrench
} from 'lucide-react'

interface CrossViewConflictPanelProps {
  metadata: Phase495Metadata
  showFullDetails?: boolean
}

const disagreementLevelColors: Record<DisagreementLevel, string> = {
  low: 'bg-green-500',
  moderate: 'bg-yellow-500',
  high: 'bg-orange-500',
  critical: 'bg-red-500',
}

const disagreementLevelLabels: Record<DisagreementLevel, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  critical: 'Critical',
}

const fusionStrategyLabels: Record<CrossViewFusionStrategy, string> = {
  weighted_average: 'Weighted Average',
  dominant_view: 'Dominant View',
  highest_trust: 'Highest Trust',
  flagged_for_review: 'Flagged for Review',
}

const fusionStrategyColors: Record<CrossViewFusionStrategy, string> = {
  weighted_average: 'text-green-600',
  dominant_view: 'text-blue-600',
  highest_trust: 'text-yellow-600',
  flagged_for_review: 'text-red-600',
}

const familyLabels: Record<MeasurementFamily, string> = {
  spread: 'Spread',
  beam: 'Beam',
  tine: 'Tine',
  mass: 'Mass',
  deduction: 'Deduction',
}

export function CrossViewConflictPanel({ metadata, showFullDetails = true }: CrossViewConflictPanelProps) {
  const { crossViewConflict, enhancedFusionUsed } = metadata

  if (!crossViewConflict || !enhancedFusionUsed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <SplitSquareHorizontal className="h-4 w-4" />
            Cross-View Conflict Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Phase 49.5 conflict analysis not available. 
            {!enhancedFusionUsed && ' (Enhanced fusion was not used)'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const { conflictSummary, perFamilyResiduals, viewTrustScores, disagreementClassifications, fusionStrategies, rejectedViews } = crossViewConflict
  const overallConfidencePercent = Math.round(conflictSummary.overallConfidence * 100)

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Overall Conflict Summary */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <SplitSquareHorizontal className="h-4 w-4" />
              Conflict Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 mb-2">
              {conflictSummary.reverseEngineeringRecommended ? (
                <AlertTriangle className="h-4 w-4 text-orange-500" />
              ) : conflictSummary.totalDisagreements === 0 ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <Eye className="h-4 w-4 text-blue-500" />
              )}
              <span className="font-medium">{conflictSummary.totalDisagreements} Disagreement(s)</span>
            </div>
            <Progress value={overallConfidencePercent} className="h-2 mb-2" />
            <div className="text-xs text-muted-foreground">
              {overallConfidencePercent}% fusion confidence
            </div>
            {conflictSummary.highDisagreementFamilies.length > 0 && (
              <div className="mt-2 flex gap-1 flex-wrap">
                {conflictSummary.highDisagreementFamilies.map(family => (
                  <Badge key={family} variant="destructive" className="text-xs">
                    {familyLabels[family]}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Fusion Strategy Overview */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Fusion Strategies
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {Object.entries(fusionStrategies).map(([family, strategy]) => (
                <div key={family} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{familyLabels[family as MeasurementFamily]}</span>
                  <span className={fusionStrategyColors[strategy]}>
                    {fusionStrategyLabels[strategy]}
                  </span>
                </div>
              ))}
            </div>
            {conflictSummary.dominantViewUsed && (
              <div className="mt-2 text-xs text-blue-600 flex items-center gap-1">
                <ArrowRight className="h-3 w-3" />
                Dominant view used
              </div>
            )}
          </CardContent>
        </Card>

        {/* Reverse Engineering */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Wrench className="h-4 w-4" />
              Reverse Engineering
            </CardTitle>
          </CardHeader>
          <CardContent>
            {conflictSummary.reverseEngineeringRecommended ? (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  <span className="font-medium text-orange-600">Recommended</span>
                </div>
                <div className="space-y-1">
                  {conflictSummary.reverseEngineeringTriggerReasons.map((reason, i) => (
                    <p key={i} className="text-xs text-muted-foreground">
                      {reason}
                    </p>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="text-sm text-muted-foreground">Not needed</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {showFullDetails && (
        <Accordion type="single" collapsible className="w-full">
          {/* Per-Family Residuals */}
          <AccordionItem value="residuals">
            <AccordionTrigger className="text-sm">
              Per-Family Residuals ({Object.keys(perFamilyResiduals).length})
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3">
                {Object.entries(perFamilyResiduals).map(([family, residual]) => (
                  <div key={family} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium">{familyLabels[family as MeasurementFamily]}</span>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${disagreementLevelColors[residual.disagreementLevel]}`} />
                        <span className="text-xs text-muted-foreground">
                          {disagreementLevelLabels[residual.disagreementLevel]}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Max Dev:</span>
                        <span className="ml-1 font-mono">{residual.maxDeviation.toFixed(2)}"</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Mean Dev:</span>
                        <span className="ml-1 font-mono">{residual.meanDeviation.toFixed(2)}"</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Std Dev:</span>
                        <span className="ml-1 font-mono">{residual.stdDev.toFixed(2)}"</span>
                      </div>
                    </div>
                    <div className="mt-2 text-xs">
                      <span className="text-muted-foreground">Disagreement Score:</span>
                      <span className="ml-1 font-mono">{(residual.disagreementScore * 100).toFixed(1)}%</span>
                      {residual.dominantViewIndex !== null && (
                        <span className="ml-2 text-blue-600">
                          Dominant: View #{residual.dominantViewIndex + 1}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* View Trust Scores */}
          <AccordionItem value="trust">
            <AccordionTrigger className="text-sm">
              View Trust Scores ({Object.keys(viewTrustScores).length})
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3">
                {Object.entries(viewTrustScores).map(([index, view]) => (
                  <div key={index} className={`border rounded-lg p-3 ${view.isOutlier ? 'border-red-300 bg-red-50 dark:bg-red-950/20' : ''}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">View #{parseInt(index) + 1}</span>
                        <Badge variant="outline" className="text-xs capitalize">
                          {view.angleType}
                        </Badge>
                        {view.isOutlier && (
                          <Badge variant="destructive" className="text-xs">
                            Outlier
                          </Badge>
                        )}
                      </div>
                      <span className="text-sm font-mono">{(view.overallTrust * 100).toFixed(0)}%</span>
                    </div>
                    <div className="grid grid-cols-5 gap-1 text-xs">
                      {Object.entries(view.perFamilyTrust).map(([family, trust]) => (
                        <div key={family} className="text-center">
                          <div className="text-muted-foreground capitalize">{family.slice(0, 3)}</div>
                          <div className="font-mono">{(trust * 100).toFixed(0)}%</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Disagreement Classifications */}
          {disagreementClassifications.length > 0 && (
            <AccordionItem value="classifications">
              <AccordionTrigger className="text-sm">
                Disagreement Classifications ({disagreementClassifications.length})
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2">
                  {disagreementClassifications.map((classification, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-2 p-2 rounded text-sm ${
                        classification.reverseEngineeringRecommended 
                          ? 'bg-orange-50 dark:bg-orange-950/20' 
                          : 'bg-muted/50'
                      }`}
                    >
                      {classification.reverseEngineeringRecommended ? (
                        <AlertTriangle className="h-4 w-4 text-orange-500 flex-shrink-0 mt-0.5" />
                      ) : (
                        <Eye className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="font-medium">
                          {familyLabels[classification.family]}: {classification.primaryType.replace(/_/g, ' ')}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {classification.explanation}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* Rejected Views */}
          {rejectedViews.length > 0 && (
            <AccordionItem value="rejected">
              <AccordionTrigger className="text-sm">
                Rejected Views ({rejectedViews.length})
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2">
                  {rejectedViews.map((view, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 p-2 rounded text-sm bg-red-50 dark:bg-red-950/20"
                    >
                      <XCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <div className="font-medium">
                          View #{view.imageIndex + 1} ({view.angleType})
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {view.reason}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      )}

      {/* Compact Summary */}
      <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
        <p>
          Cross-view analysis processed {Object.keys(viewTrustScores).length} view(s).
          {conflictSummary.totalDisagreements === 0 && ' Views are in agreement.'}
          {conflictSummary.totalDisagreements > 0 && ` Found ${conflictSummary.totalDisagreements} disagreement(s).`}
          {rejectedViews.length > 0 && ` Rejected ${rejectedViews.length} outlier view(s).`}
        </p>
      </div>
    </div>
  )
}

/**
 * Compact badge summary for cross-view conflict
 */
export function CrossViewConflictBadge({ metadata }: { metadata: Phase495Metadata | null }) {
  if (!metadata?.crossViewConflict || !metadata.enhancedFusionUsed) {
    return null
  }

  const { conflictSummary } = metadata.crossViewConflict
  const hasIssues = conflictSummary.totalDisagreements > 0 || conflictSummary.reverseEngineeringRecommended

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <Badge 
            variant={hasIssues ? 'secondary' : 'default'}
            className="text-xs gap-1"
          >
            <SplitSquareHorizontal className="h-3 w-3" />
            {conflictSummary.reverseEngineeringRecommended 
              ? 'Review' 
              : conflictSummary.totalDisagreements > 0 
                ? `${conflictSummary.totalDisagreements} Conflict(s)` 
                : 'Aligned'}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>Fusion confidence: {Math.round(conflictSummary.overallConfidence * 100)}%</p>
          {conflictSummary.highDisagreementFamilies.length > 0 && (
            <p className="text-xs text-muted-foreground">
              High disagreement: {conflictSummary.highDisagreementFamilies.join(', ')}
            </p>
          )}
          {conflictSummary.reverseEngineeringRecommended && (
            <p className="text-xs text-orange-500">Reverse engineering recommended</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
