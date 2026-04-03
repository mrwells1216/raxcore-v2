'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Play, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface BulkRunExecuteButtonProps {
  runId: string
}

export function BulkRunExecuteButton({ runId }: BulkRunExecuteButtonProps) {
  const router = useRouter()
  const [isExecuting, setIsExecuting] = useState(false)

  const handleExecute = async () => {
    setIsExecuting(true)
    try {
      const res = await fetch(`/api/admin/bulk-validation/runs/${runId}/execute`, {
        method: 'POST',
      })
      const data = await res.json()

      if (data.success) {
        toast.success(`Processed ${data.data.processed} examples in ${(data.data.totalTimeMs / 1000).toFixed(1)}s`)
        router.refresh()
      } else {
        toast.error(data.error || 'Failed to execute run')
      }
    } catch (err) {
      toast.error('Failed to execute run')
    } finally {
      setIsExecuting(false)
    }
  }

  return (
    <Button onClick={handleExecute} disabled={isExecuting}>
      {isExecuting ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Executing...
        </>
      ) : (
        <>
          <Play className="h-4 w-4 mr-2" />
          Execute Run
        </>
      )}
    </Button>
  )
}
