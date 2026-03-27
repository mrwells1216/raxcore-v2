import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { 
  ArrowLeft, 
  CheckCircle, 
  XCircle, 
  Box, 
  ExternalLink, 
  MapPin,
  Cpu,
  Calculator,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  Eye,
  Camera
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import { getBuckBundle } from '@/lib/storage/service'
import { LearningExplainabilityPanel } from '@/components/admin/learning-explainability-panel'
import { IntakeQualityDisplay, IntakeQualityBadge } from '@/components/scoring/intake-quality-display'
import type { IntakeQualitySummary } from '@/lib/types'

export default async function AdminSubmissionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { buck, images, prediction, groundTruth } = await getBuckBundle(id)
  if (!buck) return notFound()

  const measurements = prediction?.measurements
  const confidence = prediction?.confidence_percent || 0
  const confidenceLevel = confidence >= 75 ? 'high' : confidence >= 50 ? 'medium' : 'low'
  
  const confidenceColors = {
    high: 'text-primary bg-primary/10 border-primary/30',
    medium: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30',
    low: 'text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/30',
  }

  // Calculate prediction error if ground truth exists
  const grossError = groundTruth && prediction?.predicted_gross && groundTruth.official_gross
    ? (prediction.predicted_gross - groundTruth.official_gross)
    : null
  const netError = groundTruth && prediction?.predicted_net && groundTruth.official_net
    ? (prediction.predicted_net - groundTruth.official_net)
    : null

  // Get intake quality from prediction if available
  const intakeQuality = (prediction?.intake_quality as IntakeQualitySummary | null) || null

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <Link 
            href="/admin/submissions" 
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-3"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to submissions
          </Link>
          <h1 className="text-2xl font-bold">Submission Detail</h1>
          <p className="text-sm text-muted-foreground mt-1">
            ID: <span className="font-mono">{id.slice(0, 8)}...</span> | 
            Submitted {new Date(buck.created_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/results/${id}`}>
            <Button variant="outline" size="sm" className="gap-1.5">
              <ExternalLink className="h-4 w-4" />
              View Results
            </Button>
          </Link>
          {prediction?.measurements && (
            <Link href={`/render/${id}`}>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Box className="h-4 w-4" />
                3D View
              </Button>
            </Link>
          )}
          {buck.property_id && (
            <Link href={`/map/properties/${buck.property_id}`}>
              <Button variant="outline" size="sm" className="gap-1.5">
                <MapPin className="h-4 w-4" />
                View on Map
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Quick Stats Bar */}
      {prediction && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Predicted Gross</p>
              <p className="text-2xl font-bold text-primary tabular-nums">
                {prediction.predicted_gross?.toFixed(1) || '--'}&quot;
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Predicted Net</p>
              <p className="text-2xl font-bold tabular-nums">
                {prediction.predicted_net?.toFixed(1) || '--'}&quot;
              </p>
            </CardContent>
          </Card>
          <Card className={confidenceColors[confidenceLevel]}>
            <CardContent className="p-4 text-center">
              <p className="text-xs opacity-80 mb-1">Confidence</p>
              <p className="text-2xl font-bold tabular-nums">
                {confidence.toFixed(0)}%
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Scoring Method</p>
              <div className="flex items-center justify-center gap-1.5">
                {prediction.scoring_method === 'vision' ? (
                  <>
                    <Cpu className="h-4 w-4 text-primary" />
                    <span className="font-medium">Vision AI</span>
                  </>
                ) : (
                  <>
                    <Calculator className="h-4 w-4" />
                    <span className="font-medium">Heuristic</span>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Images Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Images ({images.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {images.length ? (
              <div className="grid grid-cols-2 gap-3">
                {images.map((img) => (
                  <div 
                    key={img.id} 
                    className="relative aspect-square rounded-lg overflow-hidden bg-muted group"
                  >
                    {img.public_url ? (
                      <Image 
                        src={img.public_url} 
                        alt={img.angle_type || 'Buck image'} 
                        fill 
                        className="object-cover" 
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                        No preview
                      </div>
                    )}
                    {img.angle_type && (
                      <Badge className="absolute bottom-2 left-2 text-xs bg-background/80 backdrop-blur-sm">
                        {img.angle_type}
                      </Badge>
                    )}
                    {img.quality_score && (
                      <Badge 
                        variant="outline" 
                        className="absolute top-2 right-2 text-xs bg-background/80 backdrop-blur-sm"
                      >
                        Q: {img.quality_score.toFixed(0)}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No images stored.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Submission Info Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Submission Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <InfoItem label="State" value={buck.state} />
              <InfoItem label="Rack Type" value={buck.rack_type} capitalize />
              <InfoItem label="Source" value={buck.source_type?.replace('_', ' ') || '-'} capitalize />
              <InfoItem label="Harvest Method" value={buck.harvest_method || '-'} capitalize />
              <InfoItem label="Capture Device" value={buck.capture_device?.replace('_', ' ') || '-'} capitalize />
              <InfoItem label="Main Frame" value={buck.main_frame_points ? `${buck.main_frame_points}-point` : '-'} />
              <InfoItem label="Year" value={buck.harvest_year?.toString() || '-'} />
              <div>
                <p className="text-muted-foreground mb-1">Ears Visible</p>
                <p className="font-medium flex items-center gap-1.5">
                  {buck.ears_fully_visible ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-primary" />
                      Yes
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-muted-foreground" />
                      No
                    </>
                  )}
                </p>
              </div>
            </div>
            
            <div className="pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge 
                  variant={buck.status === 'completed' ? 'default' : 'secondary'}
                  className={
                    buck.status === 'completed' ? 'bg-primary/10 text-primary' :
                    buck.status === 'failed' ? 'bg-destructive/10 text-destructive' :
                    buck.status === 'processing' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                    ''
                  }
                >
                  {buck.status}
                </Badge>
              </div>
            </div>

            {buck.notes && (
              <div className="pt-2 border-t border-border">
                <p className="text-muted-foreground text-xs mb-1">Notes</p>
                <p className="text-sm">{buck.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* AI Prediction Card */}
      {prediction && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {prediction.scoring_method === 'vision' ? (
                    <Cpu className="h-5 w-5 text-primary" />
                  ) : (
                    <Calculator className="h-5 w-5" />
                  )}
                  AI Prediction
                </CardTitle>
                <CardDescription>
                  Error Band: {prediction.error_band_low?.toFixed(1)}&quot; - {prediction.error_band_high?.toFixed(1)}&quot;
                </CardDescription>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <Badge variant="outline" className={confidenceColors[confidenceLevel]}>
                  {confidence.toFixed(0)}% Confidence
                </Badge>
                {intakeQuality && (
                  <IntakeQualityBadge 
                    tier={intakeQuality.tier} 
                    score={intakeQuality.overallScore}
                  />
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Score Comparison */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <ScoreCard 
                label="Predicted Gross" 
                value={prediction.predicted_gross}
                isPrimary
              />
              <ScoreCard 
                label="Predicted Net" 
                value={prediction.predicted_net}
              />
              {groundTruth?.official_gross && (
                <ScoreCard 
                  label="Actual Gross" 
                  value={groundTruth.official_gross}
                  variant="success"
                />
              )}
              {groundTruth?.official_net && (
                <ScoreCard 
                  label="Actual Net" 
                  value={groundTruth.official_net}
                  variant="success"
                />
              )}
            </div>

            {/* Error Display */}
            {(grossError !== null || netError !== null) && (
              <div className="p-4 rounded-lg bg-secondary/50 space-y-3">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Prediction Accuracy
                </h4>
                <div className="grid sm:grid-cols-2 gap-4">
                  {grossError !== null && (
                    <ErrorDisplay 
                      label="Gross Error" 
                      error={grossError}
                    />
                  )}
                  {netError !== null && (
                    <ErrorDisplay 
                      label="Net Error" 
                      error={netError}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Intake Quality Summary - Phase 15 */}
            {intakeQuality && (
              <IntakeQualityDisplay 
                quality={intakeQuality}
                showRecommendations={intakeQuality.tier === 'fair' || intakeQuality.tier === 'poor'}
                compact={intakeQuality.tier === 'excellent' || intakeQuality.tier === 'good'}
              />
            )}

            {/* Measurements Grid */}
            {measurements && (
              <div className="space-y-4">
                <Separator />
                <h4 className="text-sm font-medium">Detailed Measurements</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
                  <MeasurementCell label="Inside Spread" value={measurements.inside_spread} highlight />
                  <MeasurementCell label="Main Beam L" value={measurements.main_beam_left} />
                  <MeasurementCell label="Main Beam R" value={measurements.main_beam_right} />
                  <MeasurementCell label="G1 L/R" value={measurements.g1_left} value2={measurements.g1_right} />
                  <MeasurementCell label="G2 L/R" value={measurements.g2_left} value2={measurements.g2_right} />
                  <MeasurementCell label="G3 L/R" value={measurements.g3_left} value2={measurements.g3_right} />
                  <MeasurementCell label="G4 L/R" value={measurements.g4_left} value2={measurements.g4_right} />
                  <MeasurementCell label="H1 L/R" value={measurements.h1_left} value2={measurements.h1_right} />
                  <MeasurementCell label="H2 L/R" value={measurements.h2_left} value2={measurements.h2_right} />
                  <MeasurementCell label="H3 L/R" value={measurements.h3_left} value2={measurements.h3_right} />
                  <MeasurementCell label="H4 L/R" value={measurements.h4_left} value2={measurements.h4_right} />
                  <MeasurementCell label="Deductions" value={measurements.deductions} variant="destructive" />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Learning Explainability Panel (Admin Only) */}
      <LearningExplainabilityPanel summary={prediction?.extended_learning_summary} />

      {/* Ground Truth Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5" />
            Ground Truth Score
          </CardTitle>
          <CardDescription>
            {groundTruth ? 'User-submitted actual score for training' : 'No ground truth submitted yet'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {groundTruth ? (
            <div className="space-y-4">
              {/* Scores */}
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <ScoreCard 
                  label="Official Gross" 
                  value={groundTruth.official_gross}
                  variant="success"
                />
                <ScoreCard 
                  label="Official Net" 
                  value={groundTruth.official_net}
                  variant="success"
                />
              </div>

              <Separator />

              {/* Metadata */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <InfoItem 
                  label="Source" 
                  value={groundTruth.score_source?.replace('_', ' ') || '-'} 
                  capitalize 
                />
                <div>
                  <p className="text-muted-foreground mb-1">Verified</p>
                  <Badge variant={groundTruth.verified ? 'default' : 'secondary'}>
                    {groundTruth.verified ? 'Yes' : 'No'}
                  </Badge>
                </div>
                {groundTruth.scorer_name && (
                  <InfoItem label="Scorer" value={groundTruth.scorer_name} />
                )}
                {groundTruth.harvest_year && (
                  <InfoItem label="Harvest Year" value={groundTruth.harvest_year.toString()} />
                )}
              </div>

              {groundTruth.notes && (
                <>
                  <Separator />
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">Notes</p>
                    <p className="text-sm">{groundTruth.notes}</p>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="py-8 text-center">
              <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground">
                No actual score has been submitted for this buck yet.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Ground truth data is needed to train and improve the model.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// Sub-components

function InfoItem({ label, value, capitalize }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div>
      <p className="text-muted-foreground mb-1">{label}</p>
      <p className={`font-medium ${capitalize ? 'capitalize' : ''}`}>{value}</p>
    </div>
  )
}

function ScoreCard({ 
  label, 
  value, 
  isPrimary,
  variant 
}: { 
  label: string
  value: number | null | undefined
  isPrimary?: boolean
  variant?: 'success' | 'destructive'
}) {
  return (
    <div className={`p-4 rounded-lg text-center ${
      isPrimary ? 'bg-primary/10 border border-primary/20' :
      variant === 'success' ? 'bg-primary/5 border border-primary/10' :
      variant === 'destructive' ? 'bg-destructive/10 border border-destructive/20' :
      'bg-secondary/50'
    }`}>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${
        isPrimary ? 'text-primary' :
        variant === 'success' ? 'text-primary' :
        variant === 'destructive' ? 'text-destructive' :
        ''
      }`}>
        {value?.toFixed(1) || '--'}&quot;
      </p>
    </div>
  )
}

function ErrorDisplay({ label, error }: { label: string; error: number }) {
  const isGood = Math.abs(error) <= 5
  const isOkay = Math.abs(error) <= 10
  
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className={`flex items-center gap-1.5 font-bold tabular-nums ${
        isGood ? 'text-primary' : isOkay ? 'text-amber-600 dark:text-amber-400' : 'text-destructive'
      }`}>
        {error > 0 ? (
          <TrendingUp className="h-4 w-4" />
        ) : error < 0 ? (
          <TrendingDown className="h-4 w-4" />
        ) : (
          <Minus className="h-4 w-4" />
        )}
        {error > 0 ? '+' : ''}{error.toFixed(1)}&quot;
      </div>
    </div>
  )
}

function MeasurementCell({ 
  label, 
  value, 
  value2,
  highlight,
  variant
}: { 
  label: string
  value: number | null | undefined
  value2?: number | null | undefined
  highlight?: boolean
  variant?: 'destructive'
}) {
  return (
    <div className={`p-2 rounded-lg text-center ${
      highlight ? 'bg-primary/10' :
      variant === 'destructive' ? 'bg-destructive/10' :
      'bg-secondary/30'
    }`}>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className={`font-medium tabular-nums ${
        highlight ? 'text-primary' :
        variant === 'destructive' ? 'text-destructive' :
        ''
      }`}>
        {value2 !== undefined ? (
          <>
            {value?.toFixed(1) || '-'}/{value2?.toFixed(1) || '-'}&quot;
          </>
        ) : (
          <>{value?.toFixed(1) || '-'}&quot;</>
        )}
      </p>
    </div>
  )
}
