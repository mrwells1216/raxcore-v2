'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ArrowRight, ArrowUp, ArrowDown, Minus, Loader2, PlayCircle, AlertCircle, CheckCircle2, AlertTriangle } from 'lucide-react'
import type { CalibrationProfile, CalibrationPreviewResult } from '@/lib/types'
import { DEFAULT_CALIBRATION_VALUES, CALIBRATION_SAFE_RANGES } from '@/lib/types'

interface CalibrationPreviewProps {
  currentProfile: CalibrationProfile | null | undefined
  profiles: CalibrationProfile[]
}

export function CalibrationPreview({
  currentProfile,
  profiles,
}: CalibrationPreviewProps) {
  const [selectedBaseProfileId, setSelectedBaseProfileId] = useState<string>(
    currentProfile?.id || profiles[0]?.id || ''
  )
  const [proposedChanges, setProposedChanges] = useState<Partial<CalibrationProfile>>({})
  const [previewResult, setPreviewResult] = useState<CalibrationPreviewResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const baseProfile = profiles.find(p => p.id === selectedBaseProfileId) || currentProfile

  const getValue = (field: keyof CalibrationProfile): number => {
    if (proposedChanges[field] !== undefined) {
      return proposedChanges[field] as number
    }
    if (baseProfile && baseProfile[field] !== undefined) {
      return baseProfile[field] as number
    }
    return DEFAULT_CALIBRATION_VALUES[field as keyof typeof DEFAULT_CALIBRATION_VALUES] ?? 1.0
  }

  const handleValueChange = (field: keyof CalibrationProfile, value: number) => {
    setProposedChanges(prev => ({
      ...prev,
      [field]: value,
    }))
    setPreviewResult(null)
    setError(null)
  }

  const handleRunPreview = async () => {
    setLoading(true)
    setError(null)

    try {
      const proposed: Partial<CalibrationProfile> = {
        ...baseProfile,
        ...proposedChanges,
      }

      const response = await fetch('/api/admin/calibration/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposed_profile: proposed,
          sample_size: 50,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to preview')
      }

      const data = await response.json()
      setPreviewResult(data.preview)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run preview')
    } finally {
      setLoading(false)
    }
  }

  const hasChanges = Object.keys(proposedChanges).length > 0

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Compare Calibrations</CardTitle>
          <CardDescription>
            Preview the impact of calibration changes before activating them
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Base Profile Selection */}
          <div className="space-y-2">
            <Label>Base Profile</Label>
            <Select
              value={selectedBaseProfileId}
              onValueChange={(value) => {
                setSelectedBaseProfileId(value)
                setProposedChanges({})
                setPreviewResult(null)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a base profile" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map(profile => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                    {profile.is_active && ' (Active)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quick Adjustments */}
          <div className="space-y-4 pt-4 border-t">
            <Label className="text-sm font-medium">Proposed Changes</Label>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Learning Strength */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Learning Strength</Label>
                  <span className="text-sm font-mono">
                    {getValue('learning_correction_strength').toFixed(2)}x
                  </span>
                </div>
                <Slider
                  value={[getValue('learning_correction_strength')]}
                  min={CALIBRATION_SAFE_RANGES.learning_correction_strength.min}
                  max={CALIBRATION_SAFE_RANGES.learning_correction_strength.max}
                  step={0.1}
                  onValueChange={([v]) => handleValueChange('learning_correction_strength', v)}
                />
              </div>

              {/* Confidence Scaling */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Confidence Scaling</Label>
                  <span className="text-sm font-mono">
                    {getValue('confidence_scaling').toFixed(2)}x
                  </span>
                </div>
                <Slider
                  value={[getValue('confidence_scaling')]}
                  min={CALIBRATION_SAFE_RANGES.confidence_scaling.min}
                  max={CALIBRATION_SAFE_RANGES.confidence_scaling.max}
                  step={0.05}
                  onValueChange={([v]) => handleValueChange('confidence_scaling', v)}
                />
              </div>

              {/* Max Total Correction */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Max Total Correction</Label>
                  <span className="text-sm font-mono">
                    {getValue('max_total_correction').toFixed(1)}&quot;
                  </span>
                </div>
                <Slider
                  value={[getValue('max_total_correction')]}
                  min={CALIBRATION_SAFE_RANGES.max_total_correction.min}
                  max={CALIBRATION_SAFE_RANGES.max_total_correction.max}
                  step={0.5}
                  onValueChange={([v]) => handleValueChange('max_total_correction', v)}
                />
              </div>

              {/* Spread Weight */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Spread Weight</Label>
                  <span className="text-sm font-mono">
                    {getValue('spread_correction_weight').toFixed(2)}x
                  </span>
                </div>
                <Slider
                  value={[getValue('spread_correction_weight')]}
                  min={CALIBRATION_SAFE_RANGES.spread_correction_weight.min}
                  max={CALIBRATION_SAFE_RANGES.spread_correction_weight.max}
                  step={0.1}
                  onValueChange={([v]) => handleValueChange('spread_correction_weight', v)}
                />
              </div>
            </div>
          </div>

          {/* Run Preview Button */}
          <div className="flex items-center gap-4 pt-4">
            <Button
              onClick={handleRunPreview}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <PlayCircle className="h-4 w-4 mr-2" />
              )}
              Run Preview
            </Button>
            {hasChanges && (
              <Button
                variant="ghost"
                onClick={() => {
                  setProposedChanges({})
                  setPreviewResult(null)
                }}
              >
                Reset
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Preview Results */}
      {previewResult && (
        <div className="space-y-4">
          {/* Comparison Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Preview Results</CardTitle>
              <CardDescription>
                Based on {previewResult.current_metrics.sample_count} validation examples
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Current */}
                <div className="space-y-3">
                  <Label className="text-sm font-medium text-muted-foreground">Current</Label>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm">MAE</span>
                      <span className="font-mono">{previewResult.current_metrics.mae_gross.toFixed(2)}&quot;</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">Within 5&quot;</span>
                      <span className="font-mono">{previewResult.current_metrics.within_5_inches}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">Within 10%</span>
                      <span className="font-mono">{previewResult.current_metrics.within_10_percent}</span>
                    </div>
                  </div>
                </div>

                {/* Arrow */}
                <div className="flex items-center justify-center">
                  <ArrowRight className="h-8 w-8 text-muted-foreground" />
                </div>

                {/* Proposed */}
                <div className="space-y-3">
                  <Label className="text-sm font-medium text-muted-foreground">Proposed</Label>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm">MAE</span>
                      <span className="font-mono">{previewResult.proposed_metrics.mae_gross.toFixed(2)}&quot;</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">Within 5&quot;</span>
                      <span className="font-mono">{previewResult.proposed_metrics.within_5_inches}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">Within 10%</span>
                      <span className="font-mono">{previewResult.proposed_metrics.within_10_percent}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Improvement Summary */}
              <div className="mt-6 p-4 rounded-lg bg-muted/50">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="text-center">
                    <div className={`text-2xl font-bold ${
                      previewResult.mae_improvement_inches > 0 ? 'text-green-600' : 
                      previewResult.mae_improvement_inches < 0 ? 'text-red-600' : ''
                    }`}>
                      {previewResult.mae_improvement_inches > 0 ? '-' : '+'}
                      {Math.abs(previewResult.mae_improvement_inches).toFixed(2)}&quot;
                    </div>
                    <div className="text-xs text-muted-foreground">MAE Change</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600 flex items-center justify-center gap-1">
                      <ArrowUp className="h-5 w-5" />
                      {previewResult.examples_improved}
                    </div>
                    <div className="text-xs text-muted-foreground">Improved</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-red-600 flex items-center justify-center gap-1">
                      <ArrowDown className="h-5 w-5" />
                      {previewResult.examples_worsened}
                    </div>
                    <div className="text-xs text-muted-foreground">Worsened</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-muted-foreground flex items-center justify-center gap-1">
                      <Minus className="h-5 w-5" />
                      {previewResult.examples_unchanged}
                    </div>
                    <div className="text-xs text-muted-foreground">Unchanged</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Warnings & Recommendations */}
          {(previewResult.warnings.length > 0 || previewResult.recommendations.length > 0) && (
            <Card>
              <CardContent className="pt-6 space-y-4">
                {previewResult.warnings.map((warning, i) => (
                  <Alert key={i} variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>{warning}</AlertDescription>
                  </Alert>
                ))}
                {previewResult.recommendations.map((rec, i) => (
                  <Alert key={i} className="border-blue-500/20 bg-blue-500/5">
                    <CheckCircle2 className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-blue-600">{rec}</AlertDescription>
                  </Alert>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
