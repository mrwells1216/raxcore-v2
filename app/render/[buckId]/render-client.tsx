'use client'

import { useState } from 'react'
import { AntlerViewer } from '@/components/render/antler-viewer'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Share2, AlertTriangle, Box } from 'lucide-react'
import { toast } from 'sonner'
import type { AntlerGeometry, RenderSettings } from '@/lib/types'

interface RenderClientProps {
  buckId: string
  geometry: AntlerGeometry
  initialSettings: RenderSettings
  grossScore: number
  netScore: number
}

export function RenderClient({ 
  buckId, 
  geometry, 
  initialSettings,
  grossScore,
  netScore 
}: RenderClientProps) {
  const [settings, setSettings] = useState<RenderSettings>(initialSettings)

  const handleSettingsChange = (updates: Partial<RenderSettings>) => {
    setSettings(prev => ({ ...prev, ...updates }))
  }

  const handleShare = async () => {
    try {
      await navigator.share({
        title: 'xRack 3D Antler Visualization',
        text: `Check out this ${geometry.mainFramePoints}-point ${geometry.rackType} buck! Estimated gross score: ${grossScore.toFixed(1)}"`,
        url: window.location.href,
      })
    } catch {
      // Fallback: copy to clipboard
      await navigator.clipboard.writeText(window.location.href)
      toast.success('Link copied to clipboard!')
    }
  }

  return (
    <div className="space-y-6">
      {/* Score Summary Card */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-6">
              <div>
                <p className="text-sm text-muted-foreground">Gross Score</p>
                <p className="text-2xl font-bold">{grossScore.toFixed(1)}"</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Net Score</p>
                <p className="text-2xl font-bold">{netScore.toFixed(1)}"</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleShare}>
                <Share2 className="h-4 w-4 mr-1" />
                Share
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3D Viewer */}
      <AntlerViewer
        geometry={geometry}
        settings={settings}
        onSettingsChange={handleSettingsChange}
      />

      {/* Disclaimer */}
      <Card className="bg-amber-500/5 border-amber-500/20">
        <CardContent className="py-4">
          <div className="flex gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">Parametric 3D Notice</p>
              <p>
                This is a parametric 3D model generated from AI-estimated measurements (beam lengths, spread, tine lengths, mass circumferences).
                It is not a photogrammetric reconstruction from your images. Actual antler shape will differ.
                Use for visualization and sharing only — not as an official scoring reference.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
