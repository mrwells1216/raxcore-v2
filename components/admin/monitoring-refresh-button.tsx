'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'

export function MonitoringRefreshButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  function handleRefresh() {
    setLoading(true)
    router.refresh()
    // Reset spinner after a short delay — refresh() is non-awaitable in App Router
    setTimeout(() => setLoading(false), 1200)
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleRefresh}
      disabled={loading}
      className="gap-2 min-h-[44px] sm:min-h-auto"
    >
      <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
      Refresh
    </Button>
  )
}
