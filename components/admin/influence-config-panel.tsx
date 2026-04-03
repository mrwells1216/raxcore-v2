'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertTriangle, Save, RefreshCw, Calculator } from 'lucide-react'
import type { InfluenceConfig } from '@/lib/types'

const fetcher = (url: string) => fetch(url).then(res => res.json())

export function InfluenceConfigPanel() {
  const { data, error, isLoading, mutate } = useSWR<{ config: InfluenceConfig }>(
    '/api/admin/influence/config',
    fetcher
  )
  
  const [saving, setSaving] = useState(false)
  const [computing, setComputing] = useState(false)
  const [computeResult, setComputeResult] = useState<{ processed: number; updated: number; errors: number } | null>(null)
  
  const [localConfig, setLocalConfig] = useState<InfluenceConfig | null>(null)
  
  // Initialize local config when data loads
  if (data?.config && !localConfig) {
    setLocalConfig(data.config)
  }
  
  const config = localConfig || data?.config
  
  const handleSave = async () => {
    if (!localConfig) return
    
    setSaving(true)
    try {
      const res = await fetch('/api/admin/influence/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weight_factors: localConfig.weight_factors,
          safety_caps: localConfig.safety_caps,
          drift_protection: localConfig.drift_protection,
          eligibility_rules: localConfig.eligibility_rules,
        }),
      })
      
      if (res.ok) {
        mutate()
      }
    } finally {
      setSaving(false)
    }
  }
  
  const handleComputeWeights = async () => {
    setComputing(true)
    setComputeResult(null)
    
    try {
      const res = await fetch('/api/admin/influence/compute', { method: 'POST' })
      const result = await res.json()
      setComputeResult(result)
    } finally {
      setComputing(false)
    }
  }
  
  const updateWeightFactor = (key: string, value: number) => {
    if (!localConfig) return
    setLocalConfig({
      ...localConfig,
      weight_factors: {
        ...localConfig.weight_factors,
        [key]: value,
      },
    })
  }
  
  const updateSafetyCap = (key: string, value: number) => {
    if (!localConfig) return
    setLocalConfig({
      ...localConfig,
      safety_caps: {
        ...localConfig.safety_caps,
        [key]: value,
      },
    })
  }
  
  const updateDriftProtection = (key: string, value: number | boolean) => {
    if (!localConfig) return
    setLocalConfig({
      ...localConfig,
      drift_protection: {
        ...localConfig.drift_protection,
        [key]: value,
      },
    })
  }
  
  const updateEligibility = (key: string, value: number | boolean) => {
    if (!localConfig) return
    setLocalConfig({
      ...localConfig,
      eligibility_rules: {
        ...localConfig.eligibility_rules,
        [key]: value,
      },
    })
  }
  
  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  
  if (error || !config) {
    return (
      <div className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="h-4 w-4" />
        <span>Error loading configuration</span>
      </div>
    )
  }
  
  return (
    <div className="space-y-6">
      {/* Weight Factors */}
      <Card>
        <CardHeader>
          <CardTitle>Influence Weight Factors</CardTitle>
          <CardDescription>
            How much each factor contributes to an example&apos;s influence weight (should sum to ~1.0)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Object.entries(config.weight_factors).map(([key, value]) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={`wf-${key}`} className="text-sm">
                  {formatKey(key)}
                </Label>
                <Input
                  id={`wf-${key}`}
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={value}
                  onChange={(e) => updateWeightFactor(key, parseFloat(e.target.value))}
                  className="font-mono"
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      
      {/* Safety Caps */}
      <Card>
        <CardHeader>
          <CardTitle>Safety Caps</CardTitle>
          <CardDescription>
            Hard limits on corrections to prevent runaway learning
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>Max Per-Example Influence</Label>
              <Input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={config.safety_caps.max_per_example_influence}
                onChange={(e) => updateSafetyCap('max_per_example_influence', parseFloat(e.target.value))}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label>Max Total Correction (inches)</Label>
              <Input
                type="number"
                step="0.5"
                min="0"
                value={config.safety_caps.max_total_correction_inches}
                onChange={(e) => updateSafetyCap('max_total_correction_inches', parseFloat(e.target.value))}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label>Max Measurement Correction (%)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={config.safety_caps.max_per_measurement_correction_percent}
                onChange={(e) => updateSafetyCap('max_per_measurement_correction_percent', parseFloat(e.target.value))}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label>Min Examples for Correction</Label>
              <Input
                type="number"
                min="1"
                value={config.safety_caps.min_examples_for_correction}
                onChange={(e) => updateSafetyCap('min_examples_for_correction', parseInt(e.target.value))}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label>Min Total Influence Weight</Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                value={config.safety_caps.min_total_influence_weight}
                onChange={(e) => updateSafetyCap('min_total_influence_weight', parseFloat(e.target.value))}
                className="font-mono"
              />
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Drift Protection */}
      <Card>
        <CardHeader>
          <CardTitle>Drift Protection</CardTitle>
          <CardDescription>
            Settings for detecting and mitigating learning drift
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Drift Protection Enabled</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically detect and respond to learning drift
                </p>
              </div>
              <Switch
                checked={config.drift_protection.enabled}
                onCheckedChange={(checked) => updateDriftProtection('enabled', checked)}
              />
            </div>
            
            <div className="flex items-center justify-between">
              <div>
                <Label>Auto-Reduce Strength on Drift</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically reduce learning strength when drift is detected
                </p>
              </div>
              <Switch
                checked={config.drift_protection.auto_reduce_strength_on_drift}
                onCheckedChange={(checked) => updateDriftProtection('auto_reduce_strength_on_drift', checked)}
              />
            </div>
            
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label>Directional Bias Threshold</Label>
                <Input
                  type="number"
                  step="0.5"
                  min="1"
                  value={config.drift_protection.directional_bias_threshold}
                  onChange={(e) => updateDriftProtection('directional_bias_threshold', parseFloat(e.target.value))}
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label>Detection Window (hours)</Label>
                <Input
                  type="number"
                  min="24"
                  value={config.drift_protection.detection_window_hours}
                  onChange={(e) => updateDriftProtection('detection_window_hours', parseInt(e.target.value))}
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label>Strength Reduction Factor</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  value={config.drift_protection.strength_reduction_factor}
                  onChange={(e) => updateDriftProtection('strength_reduction_factor', parseFloat(e.target.value))}
                  className="font-mono"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Eligibility Rules */}
      <Card>
        <CardHeader>
          <CardTitle>Eligibility Rules</CardTitle>
          <CardDescription>
            Which examples can contribute to learning corrections
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Require Usable for Training</Label>
                <p className="text-sm text-muted-foreground">
                  Only use examples marked as usable for training
                </p>
              </div>
              <Switch
                checked={config.eligibility_rules.require_usable_for_training}
                onCheckedChange={(checked) => updateEligibility('require_usable_for_training', checked)}
              />
            </div>
            
            <div className="flex items-center justify-between">
              <div>
                <Label>Exclude Outliers</Label>
                <p className="text-sm text-muted-foreground">
                  Skip examples flagged as outliers
                </p>
              </div>
              <Switch
                checked={config.eligibility_rules.exclude_outliers}
                onCheckedChange={(checked) => updateEligibility('exclude_outliers', checked)}
              />
            </div>
            
            <div className="flex items-center justify-between">
              <div>
                <Label>Exclude Duplicates</Label>
                <p className="text-sm text-muted-foreground">
                  Skip examples flagged as duplicates
                </p>
              </div>
              <Switch
                checked={config.eligibility_rules.exclude_duplicates}
                onCheckedChange={(checked) => updateEligibility('exclude_duplicates', checked)}
              />
            </div>
            
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Min Health Score</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={config.eligibility_rules.min_health_score}
                  onChange={(e) => updateEligibility('min_health_score', parseInt(e.target.value))}
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label>Low Quality Weight Multiplier</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  value={config.eligibility_rules.low_quality_weight_multiplier}
                  onChange={(e) => updateEligibility('low_quality_weight_multiplier', parseFloat(e.target.value))}
                  className="font-mono"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? 'Saving...' : 'Save Configuration'}
        </Button>
        
        <Button variant="outline" onClick={handleComputeWeights} disabled={computing}>
          <Calculator className="h-4 w-4 mr-2" />
          {computing ? 'Computing...' : 'Recompute All Weights'}
        </Button>
        
        <Button variant="outline" onClick={() => mutate()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>
      
      {computeResult && (
        <div className="bg-muted/50 rounded-lg p-4 text-sm">
          <div className="font-medium mb-1">Weight Computation Complete</div>
          <div>
            Processed: {computeResult.processed} | 
            Updated: {computeResult.updated} | 
            Errors: {computeResult.errors}
          </div>
        </div>
      )}
    </div>
  )
}

function formatKey(key: string): string {
  return key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}
