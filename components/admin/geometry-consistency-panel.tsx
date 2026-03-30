'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import type { Phase42Metadata, GeometryConsistencyTier, LandmarkQualityTier, ReferenceSourceType } from '@/lib/types'
import { AlertTriangle, CheckCircle, Info, Eye, Target, Ruler } from 'lucide-react'

interface GeometryConsistencyPanelProps {
  metadata: Phase42Metadata
  showFullDetails?: boolean
}

const tierColors: Record<GeometryConsistencyTier, string> = {
  excellent: 'bg-green-500',
  good: 'bg-emerald-500',
  fair: 'bg-yellow-500',
  poor: 'bg-orange-500',
  implausible: 'bg-red-500',
}

const tierLabels: Record<GeometryConsistencyTier, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  implausible: 'Implausible',
}

const landmarkQualityColors: Record<LandmarkQualityTier, string> = {
  excellent: 'text-green-600',
  good: 'text-emerald-600',
  fair: 'text-yellow-600',
  poor: 'text-orange-600',
  missing: 'text-muted-foreground',
}

const referenceSourceLabels: Record<ReferenceSourceType, string> = {
  strong_ear: 'Strong Ear',
  partial_ear: 'Partial Ear',
  strong_eye: 'Strong Eye',
  combined_ear_eye: 'Combined Ear+Eye',
  weak_fallback: 'Weak Fallback',
  none: 'None',
}

export function GeometryConsistencyPanel({ metadata, showFullDetails = true }: GeometryConsistencyPanelProps) {
  const { geometry_consistency, reference_ranking, enhanced_landmarks } = metadata

  if (!geometry_consistency || !reference_ranking || !enhanced_landmarks) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="h-4 w-4" />
            Geometry Consistency
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Phase 42 data not available for this prediction.</p>
        </CardContent>
      </Card>
    )
  }

  const consistencyPercent = Math.round(geometry_consistency.consistency_score * 100)
  const reliabilityPercent = Math.round(reference_ranking.overall_reliability * 100)
  const landmarkConfidence = Math.round(enhanced_landmarks.overall_confidence * 100)

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Geometry Consistency */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Ruler className="h-4 w-4" />
              Geometry
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-3 h-3 rounded-full ${tierColors[geometry_consistency.tier]}`} />
              <span className="font-medium">{tierLabels[geometry_consistency.tier]}</span>
              <span className="text-muted-foreground text-sm">({consistencyPercent}%)</span>
            </div>
            <Progress value={consistencyPercent} className="h-2 mb-2" />
            <div className="flex gap-1 flex-wrap">
              {geometry_consistency.critical_flags > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {geometry_consistency.critical_flags} critical
                </Badge>
              )}
              {geometry_consistency.warning_flags > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {geometry_consistency.warning_flags} warnings
                </Badge>
              )}
              {geometry_consistency.info_flags > 0 && (
                <Badge variant="outline" className="text-xs">
                  {geometry_consistency.info_flags} info
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Reference Ranking */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Reference Quality
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 mb-2">
              {reference_ranking.is_sufficient ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-orange-500" />
              )}
              <span className="font-medium">{referenceSourceLabels[reference_ranking.primary_source]}</span>
            </div>
            <Progress value={reliabilityPercent} className="h-2 mb-2" />
            <div className="text-xs text-muted-foreground">
              {reliabilityPercent}% reliability
              {!reference_ranking.is_sufficient && (
                <span className="text-orange-500 ml-1">(insufficient)</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Enhanced Landmarks */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="h-4 w-4" />
              Landmarks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 mb-2">
              <span className={`font-medium capitalize ${landmarkQualityColors[enhanced_landmarks.overall_quality]}`}>
                {enhanced_landmarks.overall_quality}
              </span>
              <span className="text-muted-foreground text-sm">({landmarkConfidence}%)</span>
            </div>
            <Progress value={landmarkConfidence} className="h-2 mb-2" />
            <div className="grid grid-cols-2 gap-1 text-xs">
              <div className="flex items-center gap-1">
                <span className={landmarkQualityColors[enhanced_landmarks.ear_base_quality]}>
                  Ears: {enhanced_landmarks.ear_base_quality}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className={landmarkQualityColors[enhanced_landmarks.eye_quality]}>
                  Eyes: {enhanced_landmarks.eye_quality}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {showFullDetails && (
        <Accordion type="single" collapsible className="w-full">
          {/* Geometry Flags */}
          {geometry_consistency.flags.length > 0 && (
            <AccordionItem value="flags">
              <AccordionTrigger className="text-sm">
                Geometry Flags ({geometry_consistency.flags.length})
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2">
                  {geometry_consistency.flags.map((flag, i) => (
                    <div
                      key={flag.id || i}
                      className={`flex items-start gap-2 p-2 rounded text-sm ${
                        flag.severity === 'critical' ? 'bg-red-50 dark:bg-red-950/20' :
                        flag.severity === 'warning' ? 'bg-yellow-50 dark:bg-yellow-950/20' :
                        'bg-muted/50'
                      }`}
                    >
                      {flag.severity === 'critical' ? (
                        <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                      ) : flag.severity === 'warning' ? (
                        <AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                      ) : (
                        <Info className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="font-medium">{flag.message}</div>
                        <div className="text-xs text-muted-foreground">
                          {flag.category.replace(/_/g, ' ')}
                          {flag.field && ` • ${flag.field}`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* Asymmetry Analysis */}
          <AccordionItem value="asymmetry">
            <AccordionTrigger className="text-sm">
              Asymmetry Analysis
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant={geometry_consistency.asymmetry_likely_real ? 'default' : 'secondary'}>
                    {geometry_consistency.asymmetry_likely_real ? 'Likely Real' : 'Possible Artifact'}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    Cause: {geometry_consistency.asymmetry_cause.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="text-sm">
                  <span className="font-medium">L/R Divergence:</span>{' '}
                  {(geometry_consistency.asymmetry_divergence * 100).toFixed(1)}%
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Reference Sources by Measurement */}
          <AccordionItem value="references">
            <AccordionTrigger className="text-sm">
              Reference Sources by Measurement
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">SPREAD</div>
                  <Badge variant="outline">{referenceSourceLabels[reference_ranking.spread_reference]}</Badge>
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">BEAM</div>
                  <Badge variant="outline">{referenceSourceLabels[reference_ranking.beam_reference]}</Badge>
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">TINE</div>
                  <Badge variant="outline">{referenceSourceLabels[reference_ranking.tine_reference]}</Badge>
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">MASS</div>
                  <Badge variant="outline">{referenceSourceLabels[reference_ranking.mass_reference]}</Badge>
                </div>
              </div>
              
              {reference_ranking.warnings.length > 0 && (
                <div className="mt-3 space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">WARNINGS</div>
                  {reference_ranking.warnings.map((warning, i) => (
                    <div key={i} className="text-xs text-orange-600 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {warning}
                    </div>
                  ))}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* Enhanced Landmark Details */}
          <AccordionItem value="landmarks">
            <AccordionTrigger className="text-sm">
              Landmark Quality Details
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">EAR BASE</div>
                  <span className={landmarkQualityColors[enhanced_landmarks.ear_base_quality]}>
                    {enhanced_landmarks.ear_base_quality}
                  </span>
                  <span className="text-muted-foreground text-xs ml-1">
                    ({Math.round(enhanced_landmarks.ear_base_confidence * 100)}%)
                  </span>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">EAR TIP</div>
                  <span className={landmarkQualityColors[enhanced_landmarks.ear_tip_quality]}>
                    {enhanced_landmarks.ear_tip_quality}
                  </span>
                  <span className="text-muted-foreground text-xs ml-1">
                    ({Math.round(enhanced_landmarks.ear_tip_confidence * 100)}%)
                  </span>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">EYES</div>
                  <span className={landmarkQualityColors[enhanced_landmarks.eye_quality]}>
                    {enhanced_landmarks.eye_quality}
                  </span>
                  <span className="text-muted-foreground text-xs ml-1">
                    ({Math.round(enhanced_landmarks.eye_confidence * 100)}%)
                  </span>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">BEAM TIPS</div>
                  <span className={landmarkQualityColors[enhanced_landmarks.beam_tip_visibility]}>
                    {enhanced_landmarks.beam_tip_visibility}
                  </span>
                  <span className="text-muted-foreground text-xs ml-1">
                    ({Math.round(enhanced_landmarks.beam_tip_confidence * 100)}%)
                  </span>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">BROW TINES</div>
                  <span className={landmarkQualityColors[enhanced_landmarks.brow_tine_visibility]}>
                    {enhanced_landmarks.brow_tine_visibility}
                  </span>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">INSIDE SPREAD</div>
                  <span className={landmarkQualityColors[enhanced_landmarks.inside_spread_visibility]}>
                    {enhanced_landmarks.inside_spread_visibility}
                  </span>
                </div>
              </div>
              
              {enhanced_landmarks.best_frontal_image !== null && (
                <div className="mt-3 text-xs text-muted-foreground">
                  Best frontal: Image #{enhanced_landmarks.best_frontal_image + 1}
                  {enhanced_landmarks.best_side_images.length > 0 && (
                    <span className="ml-2">
                      | Best sides: {enhanced_landmarks.best_side_images.map(i => `#${i + 1}`).join(', ')}
                    </span>
                  )}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* Trust Penalties */}
          {Object.keys(geometry_consistency.measurement_trust_penalties).length > 0 && (
            <AccordionItem value="penalties">
              <AccordionTrigger className="text-sm">
                Measurement Trust Penalties
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2">
                  {Object.entries(geometry_consistency.measurement_trust_penalties).map(([field, penalty]) => (
                    <div key={field} className="flex items-center justify-between text-sm">
                      <span className="font-mono">{field}</span>
                      <span className="text-red-500">-{(penalty * 100).toFixed(0)}% trust</span>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      )}

      {/* Summary */}
      <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
        <p>{geometry_consistency.summary}</p>
        {geometry_consistency.confidence_adjustment !== 0 && (
          <p className="mt-1 text-xs">
            Confidence adjustment: {geometry_consistency.confidence_adjustment > 0 ? '+' : ''}{geometry_consistency.confidence_adjustment}%
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Compact badge summary for geometry consistency
 */
export function GeometryConsistencyBadge({ metadata }: { metadata: Phase42Metadata | null }) {
  if (!metadata?.geometry_consistency) {
    return null
  }

  const { geometry_consistency } = metadata
  const tier = geometry_consistency.tier

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <Badge 
            variant={tier === 'excellent' || tier === 'good' ? 'default' : 'secondary'}
            className="text-xs gap-1"
          >
            <Ruler className="h-3 w-3" />
            {tierLabels[tier]}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>Geometry: {Math.round(geometry_consistency.consistency_score * 100)}% consistency</p>
          {geometry_consistency.flags.length > 0 && (
            <p className="text-xs text-muted-foreground">{geometry_consistency.flags.length} flag(s)</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
