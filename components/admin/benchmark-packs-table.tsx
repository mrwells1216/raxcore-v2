'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronLeft, ChevronRight, MoreHorizontal, Play, Archive, Eye, Trash2 } from 'lucide-react'
import type { BenchmarkPack } from '@/lib/types'

interface BenchmarkPacksTableProps {
  packs: BenchmarkPack[]
  total: number
  page: number
  limit: number
}

export function BenchmarkPacksTable({ packs, total, page, limit }: BenchmarkPacksTableProps) {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)

  const totalPages = Math.ceil(total / limit)

  const handleArchive = async (packId: string) => {
    setLoading(packId)
    try {
      const res = await fetch(`/api/admin/benchmarks/packs/${packId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_archived: true }),
      })
      if (res.ok) {
        router.refresh()
      }
    } finally {
      setLoading(null)
    }
  }

  const handleDelete = async (packId: string) => {
    if (!confirm('Are you sure you want to delete this pack? This cannot be undone.')) {
      return
    }
    setLoading(packId)
    try {
      const res = await fetch(`/api/admin/benchmarks/packs/${packId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        router.refresh()
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to delete pack')
      }
    } finally {
      setLoading(null)
    }
  }

  const handleRunBenchmark = (packId: string) => {
    router.push(`/admin/benchmarks/${packId}/run`)
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  if (packs.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No benchmark packs created yet.</p>
        <p className="text-sm mt-1">Create your first pack to start running reproducible tests.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-center">Examples</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {packs.map((pack) => (
              <TableRow key={pack.id} className={pack.is_archived ? 'opacity-60' : ''}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{pack.name}</span>
                    {pack.description && (
                      <span className="text-xs text-muted-foreground line-clamp-1">
                        {pack.description}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant="secondary">{pack.example_count}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {pack.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                    {pack.tags.length > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{pack.tags.length - 3}
                      </Badge>
                    )}
                    {pack.is_archived && (
                      <Badge variant="secondary" className="text-xs">
                        Archived
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDate(pack.created_at)}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={loading === pack.id}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => router.push(`/admin/benchmarks/${pack.id}`)}>
                        <Eye className="h-4 w-4 mr-2" />
                        View Details
                      </DropdownMenuItem>
                      {!pack.is_archived && (
                        <>
                          <DropdownMenuItem onClick={() => handleRunBenchmark(pack.id)}>
                            <Play className="h-4 w-4 mr-2" />
                            Run Benchmark
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleArchive(pack.id)}>
                            <Archive className="h-4 w-4 mr-2" />
                            Archive
                          </DropdownMenuItem>
                        </>
                      )}
                      <DropdownMenuItem
                        onClick={() => handleDelete(pack.id)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * limit + 1} - {Math.min(page * limit, total)} of {total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => router.push(`/admin/benchmarks?tab=packs&page=${page - 1}`)}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => router.push(`/admin/benchmarks?tab=packs&page=${page + 1}`)}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
