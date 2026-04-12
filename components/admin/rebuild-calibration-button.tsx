'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, RefreshCw } from 'lucide-react'

export function RebuildCalibrationButton() {
  const [rebuilding, setRebuilding] = useState(false)
  const [result, setResult] = useState<{
    ok: boolean
    message?: string
    profilesSaved?: number
  } | null>(null)

  const handleRebuild = async () => {
    setRebuilding(true)
    setResult(null)

    try {
      const response = await fetch('/api/calibration/rebuild', {
        method: 'POST',
      })
      const data = await response.json()

      if (!response.ok) {
        setResult({
          ok: false,
          message: data.error || 'Failed to rebuild profiles',
        })
        return
      }

      setResult({
        ok: true,
        message: data.message,
        profilesSaved: data.profilesSaved,
      })

      // Reload page to show updated profiles
      window.location.reload()
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Network error',
      })
    } finally {
      setRebuilding(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button
        onClick={handleRebuild}
        disabled={rebuilding}
        variant="outline"
        size="sm"
      >
        {rebuilding ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4 mr-2" />
        )}
        Rebuild calibration profiles
      </Button>

      {result && (
        <div
          className={`text-sm px-3 py-2 rounded ${
            result.ok
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {result.message || (result.ok ? `Saved ${result.profilesSaved} profiles` : 'Error')}
        </div>
      )}
    </div>
  )
}
