'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CalibrationProfileEditor } from './calibration-profile-editor'
import { CalibrationPreview } from './calibration-preview'
import { ModelVersionManager } from './model-version-manager'
import { CalibrationAuditTrail } from './calibration-audit-trail'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Settings2, GitCompare, History, RotateCcw } from 'lucide-react'
import type { CalibrationProfile, ModelVersionWithCalibration, CalibrationChange, ModelActivationEvent } from '@/lib/types'

const fetcher = (url: string) => fetch(url).then((res) => res.json())

interface CalibrationData {
  profiles: CalibrationProfile[]
  active_profile_id: string | null
}

interface ModelsData {
  models: ModelVersionWithCalibration[]
}

interface AuditData {
  changes: CalibrationChange[]
  events: ModelActivationEvent[]
}

export function CalibrationDashboard() {
  const [activeTab, setActiveTab] = useState('profiles')

  const { data: calibrationData, error: calibrationError, isLoading: calibrationLoading, mutate: mutateCalibration } = 
    useSWR<CalibrationData>('/api/admin/calibration', fetcher)

  const { data: modelsData, error: modelsError, isLoading: modelsLoading, mutate: mutateModels } = 
    useSWR<ModelsData>('/api/admin/models/rollback', fetcher)

  const { data: auditData, error: auditError, isLoading: auditLoading } = 
    useSWR<AuditData>('/api/admin/calibration/audit?type=all&limit=50', fetcher)

  const isLoading = calibrationLoading || modelsLoading
  const hasError = calibrationError || modelsError

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (hasError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Failed to load calibration data. Please try refreshing the page.
        </AlertDescription>
      </Alert>
    )
  }

  const profiles = calibrationData?.profiles || []
  const activeProfileId = calibrationData?.active_profile_id
  const activeProfile = profiles.find(p => p.id === activeProfileId)
  const models = modelsData?.models || []
  const activeModel = models.find(m => m.is_active)

  const handleRefresh = () => {
    mutateCalibration()
    mutateModels()
  }

  return (
    <div className="space-y-6">
      {/* Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Model
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {activeModel?.version_name || 'None'}
            </div>
            {activeModel?.last_activated_at && (
              <p className="text-xs text-muted-foreground mt-1">
                Since {new Date(activeModel.last_activated_at).toLocaleDateString()}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Calibration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {activeProfile?.name || 'Default'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Learning: {activeProfile?.learning_correction_strength?.toFixed(1) || '1.0'}x | 
              Max correction: {activeProfile?.max_total_correction?.toFixed(0) || '8'}&quot;
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Available Versions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {models.length}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {profiles.length} calibration profile(s)
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-4 w-full max-w-xl">
          <TabsTrigger value="profiles" className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            <span className="hidden sm:inline">Profiles</span>
          </TabsTrigger>
          <TabsTrigger value="preview" className="flex items-center gap-2">
            <GitCompare className="h-4 w-4" />
            <span className="hidden sm:inline">Preview</span>
          </TabsTrigger>
          <TabsTrigger value="models" className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4" />
            <span className="hidden sm:inline">Models</span>
          </TabsTrigger>
          <TabsTrigger value="audit" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            <span className="hidden sm:inline">Audit</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profiles" className="mt-6">
          <CalibrationProfileEditor 
            profiles={profiles}
            activeProfileId={activeProfileId}
            onUpdate={handleRefresh}
          />
        </TabsContent>

        <TabsContent value="preview" className="mt-6">
          <CalibrationPreview 
            currentProfile={activeProfile}
            profiles={profiles}
          />
        </TabsContent>

        <TabsContent value="models" className="mt-6">
          <ModelVersionManager 
            models={models}
            onUpdate={handleRefresh}
          />
        </TabsContent>

        <TabsContent value="audit" className="mt-6">
          <CalibrationAuditTrail 
            changes={auditData?.changes || []}
            events={auditData?.events || []}
            isLoading={auditLoading}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
