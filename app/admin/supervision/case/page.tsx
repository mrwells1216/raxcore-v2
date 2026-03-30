'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Search, ArrowLeft, CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface CaseTrail {
  prediction_id: string
  buck_id: string | null
  original_score: {
    gross: number | null
    net: number | null
    confidence: number | null
  }
  supervision_events: Array<{
    id: string
    supervision_type: string
    source: string
    confidence: number
    label_status: string
    created_at: string
    delta_gross: number | null
    delta_net: number | null
    labels: Array<{
      label: string
      confidence: number
      status: string
    }>
  }>
  reverse_pass_outcomes: Array<{
    run_id: string
    best_hypothesis_type: string | null
    delta_gross: number | null
    delta_net: number | null
    completed_at: string | null
  }>
  structural_solving_outcomes: Array<{
    run_id: string
    winning_candidate_type: string | null
    primary_reason: string | null
    delta_gross: number | null
    delta_net: number | null
    completed_at: string | null
  }>
  inferred_failure_causes: Array<{
    label: string
    confidence: number
    source: string
    status: string
  }>
  associated_hard_case_patterns: Array<{
    pattern_id: string
    pattern_name: string
    match_confidence: number
  }>
  suggested_learning_actions: Array<{
    id: string
    action_type: string
    action_description: string
    priority: string
    status: string
  }>
}

export default function CaseLookupPage() {
  const [predictionId, setPredictionId] = useState('')
  const [searchId, setSearchId] = useState('')
  
  const { data: caseTrail, error, isLoading } = useSWR<CaseTrail>(
    searchId ? `/api/admin/supervision/case/${searchId}` : null,
    fetcher
  )
  
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearchId(predictionId.trim())
  }
  
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/supervision">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Case Supervision Trail</h1>
          <p className="text-muted-foreground">
            Inspect the full supervision history for a prediction
          </p>
        </div>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lookup Case</CardTitle>
          <CardDescription>Enter a prediction ID to view its supervision trail</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="flex gap-2">
            <Input 
              placeholder="Prediction ID (UUID)"
              value={predictionId}
              onChange={(e) => setPredictionId(e.target.value)}
              className="max-w-md"
            />
            <Button type="submit" disabled={!predictionId.trim()}>
              <Search className="mr-2 h-4 w-4" />
              Search
            </Button>
          </form>
        </CardContent>
      </Card>
      
      {isLoading && (
        <Card>
          <CardContent className="py-8">
            <p className="text-center text-muted-foreground">Loading case data...</p>
          </CardContent>
        </Card>
      )}
      
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Failed to load case data. Make sure the prediction ID is valid.
          </AlertDescription>
        </Alert>
      )}
      
      {caseTrail && (
        <div className="space-y-6">
          {/* Original Score */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Original Prediction</CardTitle>
              <CardDescription>Initial scoring result</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Gross Score</p>
                  <p className="text-2xl font-bold">
                    {caseTrail.original_score.gross?.toFixed(1) || 'N/A'}&quot;
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Net Score</p>
                  <p className="text-2xl font-bold">
                    {caseTrail.original_score.net?.toFixed(1) || 'N/A'}&quot;
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Confidence</p>
                  <p className="text-2xl font-bold">
                    {caseTrail.original_score.confidence?.toFixed(0) || 'N/A'}%
                  </p>
                </div>
              </div>
              {caseTrail.buck_id && (
                <p className="text-sm text-muted-foreground mt-4">
                  Buck ID: {caseTrail.buck_id}
                </p>
              )}
            </CardContent>
          </Card>
          
          {/* Supervision Events */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Supervision Events ({caseTrail.supervision_events.length})</CardTitle>
              <CardDescription>Learning signals captured for this case</CardDescription>
            </CardHeader>
            <CardContent>
              {caseTrail.supervision_events.length === 0 ? (
                <p className="text-muted-foreground">No supervision events recorded</p>
              ) : (
                <div className="space-y-4">
                  {caseTrail.supervision_events.map((event) => (
                    <div key={event.id} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{event.supervision_type.replace(/_/g, ' ')}</span>
                            <Badge 
                              variant={event.label_status === 'confirmed' ? 'default' : 
                                       event.label_status === 'rejected' ? 'destructive' : 'secondary'}
                            >
                              {event.label_status}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Source: {event.source} | Confidence: {(event.confidence * 100).toFixed(0)}%
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(event.created_at).toLocaleString()}
                          </p>
                        </div>
                        {(event.delta_gross !== null || event.delta_net !== null) && (
                          <div className="text-right">
                            {event.delta_gross !== null && (
                              <p className={`font-medium ${event.delta_gross > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {event.delta_gross > 0 ? '+' : ''}{event.delta_gross.toFixed(1)}&quot; gross
                              </p>
                            )}
                            {event.delta_net !== null && (
                              <p className={`text-sm ${event.delta_net > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {event.delta_net > 0 ? '+' : ''}{event.delta_net.toFixed(1)}&quot; net
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                      {event.labels.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-3">
                          {event.labels.map((label, idx) => (
                            <Badge key={idx} variant="outline" className="text-xs">
                              {label.label.replace(/_/g, ' ')} ({(label.confidence * 100).toFixed(0)}%)
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          
          {/* Reverse Pass Outcomes */}
          {caseTrail.reverse_pass_outcomes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Reverse Pass Outcomes ({caseTrail.reverse_pass_outcomes.length})</CardTitle>
                <CardDescription>Precision pass refinement results</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {caseTrail.reverse_pass_outcomes.map((outcome) => (
                    <div key={outcome.run_id} className="flex items-center justify-between border-b pb-2 last:border-0">
                      <div>
                        <p className="font-medium">{outcome.best_hypothesis_type || 'baseline'}</p>
                        <p className="text-xs text-muted-foreground">
                          {outcome.completed_at ? new Date(outcome.completed_at).toLocaleString() : 'In progress'}
                        </p>
                      </div>
                      <div className="text-right">
                        {outcome.delta_gross !== null && (
                          <p className={`font-medium ${outcome.delta_gross > 0 ? 'text-green-600' : outcome.delta_gross < 0 ? 'text-red-600' : ''}`}>
                            {outcome.delta_gross > 0 ? '+' : ''}{outcome.delta_gross.toFixed(1)}&quot;
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          
          {/* Structural Solving Outcomes */}
          {caseTrail.structural_solving_outcomes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Structural Solving Outcomes ({caseTrail.structural_solving_outcomes.length})</CardTitle>
                <CardDescription>Topology reinterpretation results</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {caseTrail.structural_solving_outcomes.map((outcome) => (
                    <div key={outcome.run_id} className="flex items-center justify-between border-b pb-2 last:border-0">
                      <div>
                        <p className="font-medium">{outcome.winning_candidate_type || 'baseline'}</p>
                        {outcome.primary_reason && (
                          <p className="text-sm text-muted-foreground">{outcome.primary_reason}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {outcome.completed_at ? new Date(outcome.completed_at).toLocaleString() : 'In progress'}
                        </p>
                      </div>
                      <div className="text-right">
                        {outcome.delta_gross !== null && (
                          <p className={`font-medium ${outcome.delta_gross > 0 ? 'text-green-600' : outcome.delta_gross < 0 ? 'text-red-600' : ''}`}>
                            {outcome.delta_gross > 0 ? '+' : ''}{outcome.delta_gross.toFixed(1)}&quot;
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          
          {/* Inferred Failure Causes */}
          {caseTrail.inferred_failure_causes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Inferred Failure Causes</CardTitle>
                <CardDescription>What likely went wrong</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {caseTrail.inferred_failure_causes.map((cause, idx) => (
                    <div key={idx} className="flex items-center gap-2 border rounded-lg px-3 py-2">
                      {cause.status === 'confirmed' ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : cause.status === 'rejected' ? (
                        <XCircle className="h-4 w-4 text-red-600" />
                      ) : (
                        <Clock className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="text-sm">{cause.label.replace(/_/g, ' ')}</span>
                      <Badge variant="outline" className="text-xs">
                        {(cause.confidence * 100).toFixed(0)}%
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          
          {/* Associated Patterns */}
          {caseTrail.associated_hard_case_patterns.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Associated Hard-Case Patterns</CardTitle>
                <CardDescription>Known difficult scenarios this case matches</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {caseTrail.associated_hard_case_patterns.map((pattern) => (
                    <div key={pattern.pattern_id} className="flex items-center justify-between">
                      <span className="text-sm">{pattern.pattern_name.replace(/_/g, ' ')}</span>
                      <Badge variant="outline">
                        {(pattern.match_confidence * 100).toFixed(0)}% match
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          
          {/* Suggested Actions */}
          {caseTrail.suggested_learning_actions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Suggested Learning Actions</CardTitle>
                <CardDescription>Recommendations from this case</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {caseTrail.suggested_learning_actions.map((action) => (
                    <div key={action.id} className="flex items-start justify-between border-b pb-2 last:border-0">
                      <div className="space-y-1">
                        <p className="text-sm">{action.action_description}</p>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {action.action_type.replace(/_/g, ' ')}
                          </Badge>
                          <Badge 
                            variant={action.priority === 'high' ? 'default' : 'secondary'}
                            className="text-xs"
                          >
                            {action.priority}
                          </Badge>
                        </div>
                      </div>
                      <Badge variant={action.status === 'implemented' ? 'default' : 'outline'}>
                        {action.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
