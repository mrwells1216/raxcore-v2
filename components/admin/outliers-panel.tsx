'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Loader2, AlertTriangle, CheckCircle2, Eye } from 'lucide-react'
import { toast } from 'sonner'
import type { OutlierRecord, OutlierType, OutlierSeverity } from '@/lib/types'

const fetcher = (url: string) => fetch(url).then(res => res.json())

function SeverityBadge({ severity }: { severity: OutlierSeverity }) {
  const variants: Record<OutlierSeverity, { variant: 'default' | 'secondary' | 'destructive'; label: string }> = {
    mild: { variant: 'secondary', label: 'Mild' },
    moderate: { variant: 'default', label: 'Moderate' },
    severe: { variant: 'destructive', label: 'Severe' },
  }
  
  const { variant, label } = variants[severity]
  return <Badge variant={variant}>{label}</Badge>
}

function OutlierTypeBadge({ type }: { type: OutlierType }) {
  const labels: Record<OutlierType, string> = {
    score_outlier: 'Score',
    error_outlier: 'Error',
    measurement_outlier: 'Measurement',
    metadata_outlier: 'Metadata',
    correction_instability: 'Instability',
  }
  
  return <Badge variant="outline">{labels[type]}</Badge>
}

function OutlierDetailDialog({ outlier }: { outlier: OutlierRecord }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8">
          <Eye className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Outlier Details</DialogTitle>
          <DialogDescription>
            Detected: {new Date(outlier.detected_at).toLocaleString()}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex gap-2">
            <OutlierTypeBadge type={outlier.outlier_type} />
            <SeverityBadge severity={outlier.severity} />
            {outlier.is_resolved && (
              <Badge variant="default" className="bg-primary">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Resolved
              </Badge>
            )}
          </div>

          <div>
            <p className="text-sm font-medium">Reason</p>
            <p className="text-sm text-muted-foreground">{outlier.outlier_reason}</p>
          </div>

          {outlier.statistical_details && (
            <div>
              <p className="text-sm font-medium">Statistical Details</p>
              <div className="bg-muted rounded-md p-3 font-mono text-xs">
                {Object.entries(outlier.statistical_details).map(([key, value]) => (
                  <div key={key} className="flex justify-between">
                    <span>{key.replace(/_/g, ' ')}:</span>
                    <span>{typeof value === 'number' ? value.toFixed(2) : String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {outlier.is_resolved && outlier.resolution_action && (
            <div>
              <p className="text-sm font-medium">Resolution</p>
              <p className="text-sm text-muted-foreground">{outlier.resolution_action}</p>
              <p className="text-xs text-muted-foreground mt-1">
                By {outlier.resolved_by} on {new Date(outlier.resolved_at!).toLocaleDateString()}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          {!outlier.is_resolved && (
            <>
              <Button variant="outline">Keep (False Positive)</Button>
              <Button variant="destructive">Exclude from Training</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function OutliersPanel() {
  const [resolvedFilter, setResolvedFilter] = useState<string>('false')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [severityFilter, setSeverityFilter] = useState<string>('all')

  const queryParams = new URLSearchParams()
  if (resolvedFilter !== 'all') {
    queryParams.set('resolved', resolvedFilter)
  }
  if (typeFilter !== 'all') {
    queryParams.set('outlier_type', typeFilter)
  }
  if (severityFilter !== 'all') {
    queryParams.set('severity', severityFilter)
  }

  const { data, error, isLoading } = useSWR<{
    outliers: OutlierRecord[]
  }>(`/api/admin/health/outliers?${queryParams}`, fetcher)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Failed to load outlier records. Please try again.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={resolvedFilter} onValueChange={setResolvedFilter}>
          <SelectTrigger className="w-[140px] min-h-[44px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="false">Unresolved</SelectItem>
            <SelectItem value="true">Resolved</SelectItem>
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[140px] min-h-[44px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="score_outlier">Score</SelectItem>
            <SelectItem value="error_outlier">Error</SelectItem>
            <SelectItem value="measurement_outlier">Measurement</SelectItem>
            <SelectItem value="metadata_outlier">Metadata</SelectItem>
            <SelectItem value="correction_instability">Instability</SelectItem>
          </SelectContent>
        </Select>

        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-[140px] min-h-[44px]">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="mild">Mild</SelectItem>
            <SelectItem value="moderate">Moderate</SelectItem>
            <SelectItem value="severe">Severe</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {data.outliers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <AlertTriangle className="h-12 w-12 mx-auto mb-4 opacity-20" />
          <p>No outliers found</p>
          <p className="text-sm">Run health computation to detect outliers</p>
        </div>
      ) : (
        <div className="rounded-md border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Detected</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.outliers.map((outlier) => (
                <TableRow key={outlier.id}>
                  <TableCell>
                    <OutlierTypeBadge type={outlier.outlier_type} />
                  </TableCell>
                  <TableCell>
                    <SeverityBadge severity={outlier.severity} />
                  </TableCell>
                  <TableCell className="max-w-[300px] truncate text-sm">
                    {outlier.outlier_reason}
                  </TableCell>
                  <TableCell>
                    {outlier.is_resolved ? (
                      <Badge variant="default" className="bg-primary">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Resolved
                      </Badge>
                    ) : (
                      <Badge variant="outline">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Open
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(outlier.detected_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <OutlierDetailDialog outlier={outlier} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
