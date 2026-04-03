'use client'

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LearningCorrectionsTable } from '@/components/admin/learning-corrections-table'
import { DriftAlertsPanel } from '@/components/admin/drift-alerts-panel'
import { InfluenceConfigPanel } from '@/components/admin/influence-config-panel'

export default function InfluencePage() {
  const [activeTab, setActiveTab] = useState('corrections')
  
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Influence Weighting</h1>
        <p className="text-muted-foreground">
          Monitor learning corrections, drift detection, and influence configuration
        </p>
      </div>
      
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="corrections">Corrections</TabsTrigger>
          <TabsTrigger value="drift">Drift Detection</TabsTrigger>
          <TabsTrigger value="config">Configuration</TabsTrigger>
        </TabsList>
        
        <TabsContent value="corrections" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Learning Corrections</CardTitle>
              <CardDescription>
                View which examples contributed to each correction and their weights
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LearningCorrectionsTable />
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="drift" className="mt-4">
          <DriftAlertsPanel />
        </TabsContent>
        
        <TabsContent value="config" className="mt-4">
          <InfluenceConfigPanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}
