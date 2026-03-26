'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

export function DebugBanner() {
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  const [status, setStatus] = useState<string[]>(['initializing...'])

  useEffect(() => {
    console.log('[v0] DebugBanner useEffect running')
    setMounted(true)
    setStatus(prev => [...prev, 'page mounted'])
    
    // Check if window is defined (client-side)
    if (typeof window !== 'undefined') {
      setStatus(prev => [...prev, `route: ${pathname}`])
      console.log('[v0] DebugBanner mounted on route:', pathname)
    }

    // Test a simple timeout to ensure event loop is working
    const timer = setTimeout(() => {
      setStatus(prev => [...prev, 'event loop OK'])
      console.log('[v0] DebugBanner event loop confirmed')
    }, 100)

    return () => clearTimeout(timer)
  }, [pathname])

  // Always render something visible immediately
  return (
    <div 
      className="fixed top-0 left-0 right-0 z-[9999] bg-yellow-500 text-black p-2 text-xs font-mono"
      style={{ minHeight: '40px' }}
    >
      <div className="flex flex-wrap gap-2 items-center">
        <span className="font-bold">DEBUG:</span>
        <span>mounted={mounted ? 'YES' : 'NO'}</span>
        <span>|</span>
        <span>route={pathname || 'unknown'}</span>
        <span>|</span>
        <span>status=[{status.join(', ')}]</span>
      </div>
    </div>
  )
}
