'use client'

import { useState } from 'react'
import { ScoringWizard } from '@/components/scoring/scoring-wizard'
import { FeaturesPanel } from './features-panel'
import { ClassroomResults, type ClassroomScoreResponse } from './classroom-results'
import type { ExperimentConfig } from '@/lib/scoring/experiment-config'

export function RaxamFlow({ userId }: { userId: string | null }) {
  const [config, setConfig] = useState<ExperimentConfig>({})
  const [result, setResult] = useState<ClassroomScoreResponse | null>(null)

  if (result) {
    return <ClassroomResults result={result} onReset={() => setResult(null)} />
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Upload photos and score them with any combination of features turned on or off.
        Runs are saved to history with an asterisk so they don&apos;t get mistaken for a clean score.
      </p>
      <FeaturesPanel value={config} onChange={setConfig} />
      <ScoringWizard
        initialMode="upload"
        userId={userId}
        classroom
        experimentConfig={config}
        onComplete={(r) => setResult(r as unknown as ClassroomScoreResponse)}
      />
    </div>
  )
}
