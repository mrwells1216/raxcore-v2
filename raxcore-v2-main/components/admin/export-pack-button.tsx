'use client'

/**
 * Phase 53: Export Training Pack Button
 * 
 * Exports a training pack as JSON or CSV manifest.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Download, FileJson, FileSpreadsheet, Loader2 } from 'lucide-react'

interface ExportPackButtonProps {
  packId: string
  packName: string
}

export function ExportPackButton({ packId, packName }: ExportPackButtonProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [loadingFormat, setLoadingFormat] = useState<'json' | 'csv' | null>(null)

  const handleExport = async (format: 'json' | 'csv') => {
    setLoading(true)
    setLoadingFormat(format)
    
    try {
      const response = await fetch(`/api/admin/training-packs/${packId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format }),
      })

      if (!response.ok) {
        throw new Error('Failed to export pack')
      }

      // Get the manifest content
      const manifest = await response.text()
      
      // Create a blob and download
      const blob = new Blob([manifest], { 
        type: format === 'json' ? 'application/json' : 'text/csv' 
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${packName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.${format}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      router.refresh()
    } catch (error) {
      console.error('Error exporting pack:', error)
    } finally {
      setLoading(false)
      setLoadingFormat(null)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleExport('json')} disabled={loading}>
          <FileJson className="h-4 w-4 mr-2" />
          Export as JSON
          {loadingFormat === 'json' && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('csv')} disabled={loading}>
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Export as CSV
          {loadingFormat === 'csv' && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
