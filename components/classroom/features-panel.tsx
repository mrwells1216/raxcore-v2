'use client'

import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  EXPERIMENT_FEATURE_KEYS,
  FEATURE_LABELS,
  FEATURE_DESCRIPTIONS,
  isFeatureEnabled,
  type ExperimentConfig,
  type ExperimentFeatureKey,
} from '@/lib/scoring/experiment-config'
import { DEFAULT_GLOBAL_GROSS_BIAS } from '@/lib/calibration-constants'

interface FeaturesPanelProps {
  value: ExperimentConfig
  onChange: (next: ExperimentConfig) => void
}

export function FeaturesPanel({ value, onChange }: FeaturesPanelProps) {
  function setFeature(key: ExperimentFeatureKey, enabled: boolean) {
    onChange({
      ...value,
      features: { ...value.features, [key]: enabled },
    })
  }

  function setVariable(key: keyof NonNullable<ExperimentConfig['variables']>, raw: string) {
    const variables = { ...value.variables }
    if (key === 'customPrompt') {
      if (raw.trim()) variables.customPrompt = raw
      else delete variables.customPrompt
    } else {
      const n = Number(raw)
      if (raw.trim() === '' || !Number.isFinite(n)) delete variables[key]
      else variables[key] = n
    }
    onChange({ ...value, variables })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Features &amp; Variables</CardTitle>
        <CardDescription className="text-xs">
          Toggle scoring sub-systems and override calibration before sending to the AI.
          Everything defaults ON, matching the normal Score tab.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {EXPERIMENT_FEATURE_KEYS.map((key) => {
            const enabled = isFeatureEnabled(value, key)
            return (
              <div key={key} className="flex items-start justify-between gap-3 py-1">
                <div className="min-w-0">
                  <Label className="text-sm font-medium">{FEATURE_LABELS[key]}</Label>
                  <p className="text-xs text-muted-foreground">{FEATURE_DESCRIPTIONS[key]}</p>
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={(c) => setFeature(key, c)}
                  aria-label={FEATURE_LABELS[key]}
                />
              </div>
            )
          })}
        </div>

        <div className="border-t pt-3 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Calibration overrides
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Gross offset (in)</Label>
              <Input
                type="number"
                step="0.5"
                inputMode="decimal"
                placeholder={`default +${DEFAULT_GLOBAL_GROSS_BIAS}`}
                value={value.variables?.grossBias ?? ''}
                onChange={(e) => setVariable('grossBias', e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Gross multiplier</Label>
              <Input
                type="number"
                step="0.01"
                inputMode="decimal"
                placeholder="1.0"
                value={value.variables?.grossMultiplier ?? ''}
                onChange={(e) => setVariable('grossMultiplier', e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Net offset (in)</Label>
              <Input
                type="number"
                step="0.5"
                inputMode="decimal"
                placeholder={`default +${DEFAULT_GLOBAL_GROSS_BIAS}`}
                value={value.variables?.netBias ?? ''}
                onChange={(e) => setVariable('netBias', e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Confidence multiplier</Label>
              <Input
                type="number"
                step="0.05"
                inputMode="decimal"
                placeholder="1.0"
                value={value.variables?.confidenceMultiplier ?? ''}
                onChange={(e) => setVariable('confidenceMultiplier', e.target.value)}
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Offsets are added to the raw AI score; leave blank to use the learned/seeded
            calibration. Turning off &quot;Score calibration&quot; sends the raw AI number.
          </p>
        </div>

        <div className="border-t pt-3 space-y-1">
          <Label className="text-xs">Extra prompt instruction (optional)</Label>
          <Textarea
            rows={3}
            placeholder="e.g. This buck has heavy mass — do not underestimate circumferences."
            value={value.variables?.customPrompt ?? ''}
            onChange={(e) => setVariable('customPrompt', e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Appended to the measurement prompt. It never overrides the measurement-truth rules.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
