'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'
import { Loader2, Plus, TrendingDown, TrendingUp } from 'lucide-react'
import type { ModelVersion } from '@/lib/types'

export default function ModelsPage() {
  const [models, setModels] = useState<ModelVersion[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void fetchModels()
  }, [])

  async function fetchModels() {
    setLoading(true)
    const res = await fetch('/api/admin/models')
    const json = await res.json()
    setModels(json.models || [])
    setLoading(false)
  }

  async function toggleActive(model: ModelVersion) {
    await fetch('/api/admin/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: model.id }),
    })
    await fetchModels()
  }

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold tracking-tight">Model Versions</h1><p className="text-muted-foreground">Manage AI scoring model versions and track performance</p></div><Button disabled><Plus className="mr-2 h-4 w-4" />Deploy New Model</Button></div>
      <div className="grid gap-4 md:grid-cols-3"><Card><CardHeader className="pb-2"><CardDescription>Active Model</CardDescription><CardTitle className="text-lg">{models.find((m) => m.is_active)?.version_name || 'None'}</CardTitle></CardHeader></Card><Card><CardHeader className="pb-2"><CardDescription>Total Models</CardDescription><CardTitle className="text-lg">{models.length}</CardTitle></CardHeader></Card><Card><CardHeader className="pb-2"><CardDescription>Total Training Data</CardDescription><CardTitle className="text-lg">{models.reduce((sum, m) => sum + (m.training_data_count || 0), 0)}</CardTitle></CardHeader></Card></div>
      <Card><CardHeader><CardTitle>All Models</CardTitle><CardDescription>Model versions with performance metrics from verified training examples</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Version</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Training Data</TableHead><TableHead className="text-right">Avg Gross Error</TableHead><TableHead className="text-right">Avg Net Error</TableHead><TableHead>Created</TableHead><TableHead className="text-right">Active</TableHead></TableRow></TableHeader><TableBody>{models.map((model) => <TableRow key={model.id}><TableCell className="font-medium">{model.version_name}</TableCell><TableCell>{model.is_active ? <Badge className="bg-primary">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell><TableCell className="text-right">{model.training_data_count || 0}</TableCell><TableCell className="text-right">{model.avg_gross_error !== null ? <div className="flex items-center justify-end gap-1">{model.avg_gross_error > 0 ? <TrendingUp className="h-3 w-3 text-destructive" /> : <TrendingDown className="h-3 w-3 text-primary" />}{Math.abs(model.avg_gross_error).toFixed(1)}&quot;</div> : <span className="text-muted-foreground">-</span>}</TableCell><TableCell className="text-right">{model.avg_net_error !== null ? <div className="flex items-center justify-end gap-1">{model.avg_net_error > 0 ? <TrendingUp className="h-3 w-3 text-destructive" /> : <TrendingDown className="h-3 w-3 text-primary" />}{Math.abs(model.avg_net_error).toFixed(1)}&quot;</div> : <span className="text-muted-foreground">-</span>}</TableCell><TableCell>{new Date(model.created_at).toLocaleDateString()}</TableCell><TableCell className="text-right"><Switch checked={model.is_active} onCheckedChange={() => toggleActive(model)} /></TableCell></TableRow>)}{models.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No model versions found</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
    </div>
  )
}
