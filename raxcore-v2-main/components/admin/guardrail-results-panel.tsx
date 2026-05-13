'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { CheckCircle, XCircle, AlertTriangle, Shield } from 'lucide-react'
import type { GuardrailEvaluationResult } from '@/lib/types'

interface GuardrailResultsPanelProps {
  results: GuardrailEvaluationResult
}

export function GuardrailResultsPanel({ results }: GuardrailResultsPanelProps) {
  const getCheckIcon = (passed: boolean, severity: string) => {
    if (passed) {
      return <CheckCircle className="h-4 w-4 text-green-600" />
    }
    if (severity === 'critical') {
      return <XCircle className="h-4 w-4 text-destructive" />
    }
    return <AlertTriangle className="h-4 w-4 text-yellow-600" />
  }

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <Badge variant="destructive" className="text-xs">Critical</Badge>
      case 'warning':
        return <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-600 text-xs">Warning</Badge>
      default:
        return <Badge variant="outline" className="text-xs">Info</Badge>
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Guardrail Results
          {results.overall_passed ? (
            <Badge variant="secondary" className="bg-green-500/10 text-green-600 ml-2">
              <CheckCircle className="h-3 w-3 mr-1" />
              Passed
            </Badge>
          ) : (
            <Badge variant="destructive" className="ml-2">
              <XCircle className="h-3 w-3 mr-1" />
              Failed
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{results.summary}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-2xl font-bold text-green-600">
              {results.checks.filter(c => c.passed).length}
            </p>
            <p className="text-xs text-muted-foreground">Passed</p>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-2xl font-bold text-destructive">
              {results.critical_failures}
            </p>
            <p className="text-xs text-muted-foreground">Critical Failures</p>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-2xl font-bold text-yellow-600">
              {results.warning_failures}
            </p>
            <p className="text-xs text-muted-foreground">Warnings</p>
          </div>
        </div>

        {/* Checks Table */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">Status</TableHead>
                <TableHead>Check</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead className="text-right">Threshold</TableHead>
                <TableHead className="text-right">Actual</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.checks.map((check, idx) => (
                <TableRow key={idx} className={!check.passed ? 'bg-destructive/5' : ''}>
                  <TableCell>{getCheckIcon(check.passed, check.severity)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{check.name}</span>
                      <span className="text-xs text-muted-foreground">{check.description}</span>
                    </div>
                  </TableCell>
                  <TableCell>{getSeverityBadge(check.severity)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {check.threshold} {check.unit}
                  </TableCell>
                  <TableCell className={`text-right font-mono ${!check.passed ? 'text-destructive font-semibold' : ''}`}>
                    {check.actual.toFixed(2)} {check.unit}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Subgroup Results */}
        {results.subgroup_results.length > 0 && (
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="subgroups">
              <AccordionTrigger>
                Subgroup Regression Analysis ({results.subgroup_results.filter(s => !s.passed).length} issues)
              </AccordionTrigger>
              <AccordionContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40px]">Status</TableHead>
                        <TableHead>Subgroup</TableHead>
                        <TableHead className="text-right">Active MAE</TableHead>
                        <TableHead className="text-right">Candidate MAE</TableHead>
                        <TableHead className="text-right">Regression</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results.subgroup_results.map((sg, idx) => (
                        <TableRow key={idx} className={!sg.passed ? 'bg-destructive/5' : ''}>
                          <TableCell>
                            {sg.passed ? (
                              <CheckCircle className="h-4 w-4 text-green-600" />
                            ) : (
                              <AlertTriangle className="h-4 w-4 text-yellow-600" />
                            )}
                          </TableCell>
                          <TableCell>
                            <span className="text-xs text-muted-foreground uppercase">{sg.subgroup_type}:</span>{' '}
                            <span className="font-medium">{sg.subgroup_value}</span>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {sg.active_mae.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {sg.candidate_mae.toFixed(2)}
                          </TableCell>
                          <TableCell className={`text-right font-mono ${!sg.passed ? 'text-destructive font-semibold' : sg.regression_inches < 0 ? 'text-green-600' : ''}`}>
                            {sg.regression_inches >= 0 ? '+' : ''}{sg.regression_inches.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}
      </CardContent>
    </Card>
  )
}
