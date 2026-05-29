'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Play, Loader2 } from 'lucide-react'

interface RunBenchmarkExecuteButtonProps {
  benchmarkRunId: string
  exampleCount: number
}

/**
 * Triggers inline execution of a pending benchmark run (scores every example
 * against ground truth + evaluates guardrails). Long-running; the button stays
 * in a loading state until the server responds, then refreshes the page so the
 * headline metrics render.
 */
export function RunBenchmarkExecuteButton({
  benchmarkRunId,
  exampleCount,
}: RunBenchmarkExecuteButtonProps) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRun = async () => {
    setRunning(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/benchmarks/runs/${benchmarkRunId}/execute`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to run benchmark')
        return
      }
      router.refresh()
    } catch {
      setError('Network error running benchmark')
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ready to Run</CardTitle>
        <CardDescription>
          Score all {exampleCount} gold-standard examples against their official
          measurements, then evaluate regression guardrails. This may take a few
          minutes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={handleRun} disabled={running} size="lg">
          {running ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Scoring examples…
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-2" />
              Run Scoring Now
            </>
          )}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
