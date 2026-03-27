'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Plus, CheckCircle2, AlertCircle, Loader2, Save, Trash2 } from 'lucide-react'
import type { CalibrationProfile, CalibrationProfileInput } from '@/lib/types'
import { DEFAULT_CALIBRATION_VALUES, CALIBRATION_SAFE_RANGES } from '@/lib/types'

interface CalibrationProfileEditorProps {
  profiles: CalibrationProfile[]
  activeProfileId: string | null | undefined
  onUpdate: () => void
}

const FIELD_LABELS: Record<string, { label: string; description: string; unit?: string }> = {
  spread_correction_weight: {
    label: 'Spread Correction Weight',
    description: 'How strongly to apply corrections to inside spread measurements',
  },
  beam_correction_weight: {
    label: 'Beam Correction Weight',
    description: 'How strongly to apply corrections to main beam measurements',
  },
  tine_correction_weight: {
    label: 'Tine Correction Weight',
    description: 'How strongly to apply corrections to G1-G5 tine measurements',
  },
  mass_correction_weight: {
    label: 'Mass Correction Weight',
    description: 'How strongly to apply corrections to H1-H4 circumference measurements',
  },
  deduction_correction_weight: {
    label: 'Deduction Correction Weight',
    description: 'How strongly to apply corrections to deductions and abnormal points',
  },
  confidence_scaling: {
    label: 'Confidence Scaling',
    description: 'Multiplier applied to reported confidence (0.5-1.5)',
  },
  learning_correction_strength: {
    label: 'Learning Correction Strength',
    description: 'How aggressively to apply learned corrections from training examples',
  },
  max_total_correction: {
    label: 'Max Total Correction',
    description: 'Maximum absolute score correction allowed',
    unit: 'inches',
  },
  max_spread_correction: {
    label: 'Max Spread Correction',
    description: 'Maximum correction to spread measurement',
    unit: 'inches',
  },
  max_beam_correction: {
    label: 'Max Beam Correction',
    description: 'Maximum correction to beam measurements',
    unit: 'inches',
  },
  max_tine_correction: {
    label: 'Max Tine Correction',
    description: 'Maximum correction to tine measurements',
    unit: 'inches',
  },
  max_mass_correction: {
    label: 'Max Mass Correction',
    description: 'Maximum correction to circumference measurements',
    unit: 'inches',
  },
}

export function CalibrationProfileEditor({
  profiles,
  activeProfileId,
  onUpdate,
}: CalibrationProfileEditorProps) {
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    activeProfileId || profiles[0]?.id || null
  )
  const [editedValues, setEditedValues] = useState<Partial<CalibrationProfile>>({})
  const [saving, setSaving] = useState(false)
  const [activating, setActivating] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [newProfileName, setNewProfileName] = useState('')
  const [newProfileDescription, setNewProfileDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const selectedProfile = profiles.find(p => p.id === selectedProfileId)
  const isActive = selectedProfileId === activeProfileId

  const hasChanges = Object.keys(editedValues).length > 0

  const getValue = (field: keyof CalibrationProfile): number => {
    if (editedValues[field] !== undefined) {
      return editedValues[field] as number
    }
    if (selectedProfile && selectedProfile[field] !== undefined) {
      return selectedProfile[field] as number
    }
    return DEFAULT_CALIBRATION_VALUES[field as keyof typeof DEFAULT_CALIBRATION_VALUES] ?? 1.0
  }

  const handleValueChange = (field: keyof CalibrationProfile, value: number) => {
    setEditedValues(prev => ({
      ...prev,
      [field]: value,
    }))
    setError(null)
    setSuccess(null)
  }

  const handleSave = async () => {
    if (!selectedProfileId || !hasChanges) return
    
    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(`/api/admin/calibration/${selectedProfileId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editedValues,
          reason: 'Updated via calibration editor',
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save')
      }

      setEditedValues({})
      setSuccess('Profile saved successfully')
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  const handleActivate = async () => {
    if (!selectedProfileId || isActive) return
    
    setActivating(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(`/api/admin/calibration/${selectedProfileId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'activate',
          reason: 'Activated via calibration editor',
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to activate')
      }

      setSuccess('Profile activated successfully')
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate profile')
    } finally {
      setActivating(false)
    }
  }

  const handleCreate = async () => {
    if (!newProfileName.trim()) return
    
    setCreating(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/calibration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProfileName.trim(),
          description: newProfileDescription.trim() || null,
        } as CalibrationProfileInput),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create')
      }

      const data = await response.json()
      setShowCreateDialog(false)
      setNewProfileName('')
      setNewProfileDescription('')
      setSelectedProfileId(data.profile.id)
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create profile')
    } finally {
      setCreating(false)
    }
  }

  const handleReset = () => {
    setEditedValues({})
    setError(null)
    setSuccess(null)
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Profile List */}
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="text-lg">Calibration Profiles</CardTitle>
          <CardDescription>
            Select a profile to view or edit
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {profiles.map(profile => (
            <button
              key={profile.id}
              onClick={() => {
                setSelectedProfileId(profile.id)
                setEditedValues({})
                setError(null)
                setSuccess(null)
              }}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${
                selectedProfileId === profile.id
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-muted/50'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{profile.name}</span>
                {profile.id === activeProfileId && (
                  <Badge variant="secondary" className="text-xs">Active</Badge>
                )}
              </div>
              {profile.description && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {profile.description}
                </p>
              )}
            </button>
          ))}

          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" className="w-full mt-4">
                <Plus className="h-4 w-4 mr-2" />
                New Profile
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Calibration Profile</DialogTitle>
                <DialogDescription>
                  Create a new calibration profile with default values.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Profile Name</Label>
                  <Input
                    id="name"
                    value={newProfileName}
                    onChange={(e) => setNewProfileName(e.target.value)}
                    placeholder="e.g., High Confidence Profile"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={newProfileDescription}
                    onChange={(e) => setNewProfileDescription(e.target.value)}
                    placeholder="Optional description of this profile's purpose"
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button 
                  variant="outline" 
                  onClick={() => setShowCreateDialog(false)}
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleCreate}
                  disabled={!newProfileName.trim() || creating}
                >
                  {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      {/* Editor Panel */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">
                {selectedProfile?.name || 'Select a Profile'}
              </CardTitle>
              {selectedProfile?.description && (
                <CardDescription>{selectedProfile.description}</CardDescription>
              )}
            </div>
            {isActive && (
              <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Active
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!selectedProfile ? (
            <div className="text-center py-8 text-muted-foreground">
              Select a profile to view and edit its settings
            </div>
          ) : (
            <div className="space-y-6">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {success && (
                <Alert className="border-green-500/20 bg-green-500/5">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-600">{success}</AlertDescription>
                </Alert>
              )}

              <Accordion type="multiple" defaultValue={['weights', 'caps']} className="space-y-4">
                {/* Correction Weights */}
                <AccordionItem value="weights" className="border rounded-lg px-4">
                  <AccordionTrigger className="text-sm font-medium">
                    Correction Weights
                  </AccordionTrigger>
                  <AccordionContent className="space-y-6 pt-4">
                    {['spread_correction_weight', 'beam_correction_weight', 'tine_correction_weight', 'mass_correction_weight', 'deduction_correction_weight'].map(field => {
                      const fieldKey = field as keyof CalibrationProfile
                      const range = CALIBRATION_SAFE_RANGES[field as keyof typeof CALIBRATION_SAFE_RANGES]
                      const meta = FIELD_LABELS[field]
                      const value = getValue(fieldKey)
                      const isDefault = value === DEFAULT_CALIBRATION_VALUES[field as keyof typeof DEFAULT_CALIBRATION_VALUES]
                      
                      return (
                        <div key={field} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm">{meta.label}</Label>
                            <span className={`text-sm font-mono ${!isDefault ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                              {value.toFixed(2)}x
                            </span>
                          </div>
                          <Slider
                            value={[value]}
                            min={range.min}
                            max={range.max}
                            step={0.05}
                            onValueChange={([v]) => handleValueChange(fieldKey, v)}
                            className="w-full"
                          />
                          <p className="text-xs text-muted-foreground">{meta.description}</p>
                        </div>
                      )
                    })}
                  </AccordionContent>
                </AccordionItem>

                {/* Confidence & Learning */}
                <AccordionItem value="confidence" className="border rounded-lg px-4">
                  <AccordionTrigger className="text-sm font-medium">
                    Confidence & Learning
                  </AccordionTrigger>
                  <AccordionContent className="space-y-6 pt-4">
                    {['confidence_scaling', 'learning_correction_strength'].map(field => {
                      const fieldKey = field as keyof CalibrationProfile
                      const range = CALIBRATION_SAFE_RANGES[field as keyof typeof CALIBRATION_SAFE_RANGES]
                      const meta = FIELD_LABELS[field]
                      const value = getValue(fieldKey)
                      const isDefault = value === DEFAULT_CALIBRATION_VALUES[field as keyof typeof DEFAULT_CALIBRATION_VALUES]
                      
                      return (
                        <div key={field} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm">{meta.label}</Label>
                            <span className={`text-sm font-mono ${!isDefault ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                              {value.toFixed(2)}x
                            </span>
                          </div>
                          <Slider
                            value={[value]}
                            min={range.min}
                            max={range.max}
                            step={0.05}
                            onValueChange={([v]) => handleValueChange(fieldKey, v)}
                            className="w-full"
                          />
                          <p className="text-xs text-muted-foreground">{meta.description}</p>
                        </div>
                      )
                    })}
                  </AccordionContent>
                </AccordionItem>

                {/* Correction Caps */}
                <AccordionItem value="caps" className="border rounded-lg px-4">
                  <AccordionTrigger className="text-sm font-medium">
                    Correction Caps
                  </AccordionTrigger>
                  <AccordionContent className="space-y-6 pt-4">
                    {['max_total_correction', 'max_spread_correction', 'max_beam_correction', 'max_tine_correction', 'max_mass_correction'].map(field => {
                      const fieldKey = field as keyof CalibrationProfile
                      const range = CALIBRATION_SAFE_RANGES[field as keyof typeof CALIBRATION_SAFE_RANGES]
                      const meta = FIELD_LABELS[field]
                      const value = getValue(fieldKey)
                      const isDefault = value === DEFAULT_CALIBRATION_VALUES[field as keyof typeof DEFAULT_CALIBRATION_VALUES]
                      
                      return (
                        <div key={field} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm">{meta.label}</Label>
                            <span className={`text-sm font-mono ${!isDefault ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                              {value.toFixed(1)}&quot;
                            </span>
                          </div>
                          <Slider
                            value={[value]}
                            min={range.min}
                            max={range.max}
                            step={0.5}
                            onValueChange={([v]) => handleValueChange(fieldKey, v)}
                            className="w-full"
                          />
                          <p className="text-xs text-muted-foreground">{meta.description}</p>
                        </div>
                      )
                    })}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              {/* Actions */}
              <div className="flex flex-wrap gap-3 pt-4 border-t">
                <Button
                  onClick={handleSave}
                  disabled={!hasChanges || saving}
                >
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </Button>

                {!isActive && (
                  <Button
                    variant="outline"
                    onClick={handleActivate}
                    disabled={activating}
                  >
                    {activating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Activate Profile
                  </Button>
                )}

                {hasChanges && (
                  <Button
                    variant="ghost"
                    onClick={handleReset}
                  >
                    Reset Changes
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
