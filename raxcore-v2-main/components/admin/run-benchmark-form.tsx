'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Checkbox } from '@/components/ui/checkbox'
import { Play, Loader2, Settings2 } from 'lucide-react'
import type { BenchmarkPack, CalibrationProfile, RegressionGuardrailConfig, DEFAULT_GUARDRAIL_CONFIG } from '@/lib/types'
import type { ModelVersionRecord } from '@/lib/storage/service'

interface RunBenchmarkFormProps {
  pack: BenchmarkPack
  modelVersions: ModelVersionRecord[]
  calibrationProfiles: CalibrationProfile[]
}

const defaultConfig: RegressionGuardrailConfig = {
  max_avg_gross_error_inches: 8.0,
  max_avg_net_error_inches: 6.0,
  max_regression_vs_active_inches: 1.0,
  max_regression_vs_active_percent: 10.0,
  min_within_5_inches_percent: 40.0,
  min_within_10_inches_percent: 70.0,
  max_overconfidence_drift_percent: 5.0,
  max_subgroup_regression_inches: 2.0,
  subgroups_to_check: ['state', 'rack_type', 'source_type'],
}

export function RunBenchmarkForm({ pack, modelVersions, calibrationProfiles }: RunBenchmarkFormProps) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  // Form state
  const [runPurpose, setRunPurpose] = useState<'release_candidate' | 'regression_test' | 'ad_hoc'>('ad_hoc')
  const [runNotes, setRunNotes] = useState('')
  const [activeModelId, setActiveModelId] = useState<string>('')
  const [candidateModelId, setCandidateModelId] = useState<string>('')
  const [activeCalibrationId, setActiveCalibrationId] = useState<string>('')
  const [candidateCalibrationId, setCandidateCalibrationId] = useState<string>('')

  // Guardrail config
  const [guardrailConfig, setGuardrailConfig] = useState<RegressionGuardrailConfig>(defaultConfig)

  const activeModel = modelVersions.find(m => m.is_active)
  const nonActiveModels = modelVersions.filter(m => !m.is_active)

  // Auto-select active model
  useState(() => {
    if (activeModel && !activeModelId) {
      setActiveModelId(activeModel.id)
    }
  })

  const updateGuardrail = <K extends keyof RegressionGuardrailConfig>(
    key: K,
    value: RegressionGuardrailConfig[K]
  ) => {
    setGuardrailConfig(prev => ({ ...prev, [key]: value }))
  }

  const toggleSubgroup = (subgroup: 'state' | 'rack_type' | 'source_type') => {
    setGuardrailConfig(prev => ({
      ...prev,
      subgroups_to_check: prev.subgroups_to_check.includes(subgroup)
        ? prev.subgroups_to_check.filter(s => s !== subgroup)
        : [...prev.subgroups_to_check, subgroup],
    }))
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/benchmarks/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          benchmark_pack_id: pack.id,
          run_purpose: runPurpose,
          run_notes: runNotes.trim() || undefined,
          active_model_version_id: activeModelId || undefined,
          candidate_model_version_id: candidateModelId || undefined,
          active_calibration_profile_id: activeCalibrationId || undefined,
          candidate_calibration_profile_id: candidateCalibrationId || undefined,
          guardrail_config: guardrailConfig,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        router.push(`/admin/benchmarks/runs/${data.data.id}`)
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to start benchmark run')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="purpose">Run Purpose</Label>
          <Select value={runPurpose} onValueChange={(v) => setRunPurpose(v as typeof runPurpose)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="release_candidate">Release Candidate</SelectItem>
              <SelectItem value="regression_test">Regression Test</SelectItem>
              <SelectItem value="ad_hoc">Ad Hoc</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes">Notes (optional)</Label>
          <Textarea
            id="notes"
            placeholder="Why are you running this benchmark?"
            value={runNotes}
            onChange={(e) => setRunNotes(e.target.value)}
            rows={2}
          />
        </div>
      </div>

      {/* Model Selection */}
      <div className="space-y-4">
        <h3 className="font-semibold">Model Comparison</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Candidate Model (to test)</Label>
            <Select value={candidateModelId} onValueChange={setCandidateModelId}>
              <SelectTrigger>
                <SelectValue placeholder="Select candidate model" />
              </SelectTrigger>
              <SelectContent>
                {modelVersions.map(model => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.version_name} {model.is_active && '(Active)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {calibrationProfiles.length > 0 && (
              <Select value={candidateCalibrationId} onValueChange={setCandidateCalibrationId}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Calibration (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No calibration</SelectItem>
                  {calibrationProfiles.map(profile => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name} {profile.is_active && '(Active)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label>Active Model (baseline)</Label>
            <Select value={activeModelId} onValueChange={setActiveModelId}>
              <SelectTrigger>
                <SelectValue placeholder="Select active model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">No baseline (single model)</SelectItem>
                {modelVersions.map(model => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.version_name} {model.is_active && '(Active)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {calibrationProfiles.length > 0 && activeModelId && (
              <Select value={activeCalibrationId} onValueChange={setActiveCalibrationId}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Calibration (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No calibration</SelectItem>
                  {calibrationProfiles.map(profile => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name} {profile.is_active && '(Active)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </div>

      {/* Guardrail Configuration */}
      <Accordion type="single" collapsible className="w-full">
        <AccordionItem value="guardrails">
          <AccordionTrigger className="gap-2">
            <Settings2 className="h-4 w-4" />
            Guardrail Configuration
          </AccordionTrigger>
          <AccordionContent className="pt-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Max Avg Gross Error (inches)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={guardrailConfig.max_avg_gross_error_inches}
                  onChange={(e) => updateGuardrail('max_avg_gross_error_inches', parseFloat(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>Max Avg Net Error (inches)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={guardrailConfig.max_avg_net_error_inches || ''}
                  onChange={(e) => updateGuardrail('max_avg_net_error_inches', e.target.value ? parseFloat(e.target.value) : null)}
                />
              </div>
              <div className="space-y-2">
                <Label>Max Regression vs Active (inches)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={guardrailConfig.max_regression_vs_active_inches}
                  onChange={(e) => updateGuardrail('max_regression_vs_active_inches', parseFloat(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>Max Regression vs Active (%)</Label>
                <Input
                  type="number"
                  step="1"
                  value={guardrailConfig.max_regression_vs_active_percent}
                  onChange={(e) => updateGuardrail('max_regression_vs_active_percent', parseFloat(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>Min Within 5 Inches (%)</Label>
                <Input
                  type="number"
                  step="1"
                  value={guardrailConfig.min_within_5_inches_percent}
                  onChange={(e) => updateGuardrail('min_within_5_inches_percent', parseFloat(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>Min Within 10 Inches (%)</Label>
                <Input
                  type="number"
                  step="1"
                  value={guardrailConfig.min_within_10_inches_percent}
                  onChange={(e) => updateGuardrail('min_within_10_inches_percent', parseFloat(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>Max Subgroup Regression (inches)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={guardrailConfig.max_subgroup_regression_inches}
                  onChange={(e) => updateGuardrail('max_subgroup_regression_inches', parseFloat(e.target.value))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Subgroups to Check</Label>
              <div className="flex gap-4">
                {(['state', 'rack_type', 'source_type'] as const).map(subgroup => (
                  <div key={subgroup} className="flex items-center gap-2">
                    <Checkbox
                      id={subgroup}
                      checked={guardrailConfig.subgroups_to_check.includes(subgroup)}
                      onCheckedChange={() => toggleSubgroup(subgroup)}
                    />
                    <Label htmlFor={subgroup} className="text-sm font-normal">
                      {subgroup.replace('_', ' ')}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Submit */}
      <div className="flex justify-end">
        <Button
          onClick={handleSubmit}
          disabled={!candidateModelId || submitting}
          size="lg"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Starting...
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-2" />
              Start Benchmark Run
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
