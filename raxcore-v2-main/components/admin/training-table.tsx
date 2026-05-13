'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChevronLeft, ChevronRight, Check, X, Loader2, Image as ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import Image from 'next/image'
import type { TrainingExampleRecord } from '@/lib/storage/service'

interface TrainingTableProps {
  examples: TrainingExampleRecord[]
  total: number
  page: number
  limit: number
}

export function TrainingTable({ examples, total, page, limit }: TrainingTableProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const totalPages = Math.ceil(total / limit)

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'all') {
      params.delete(key)
    } else {
      params.set(key, value)
    }
    params.set('page', '1')
    router.push(`?${params.toString()}`)
  }

  const goToPage = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', String(newPage))
    router.push(`?${params.toString()}`)
  }

  const handleVerify = async (id: string, verified: boolean) => {
    startTransition(async () => {
      try {
        const response = await fetch('/api/admin/verify-training', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, verified, quality_score: verified ? 4 : undefined }),
        })

        if (!response.ok) throw new Error('Failed to update')

        toast.success(verified ? 'Example verified for training' : 'Example rejected')
        router.refresh()
      } catch (error) {
        console.error('Verify error:', error)
        toast.error('Failed to update verification status')
      }
    })
  }

  const getErrorColor = (error: number | null) => {
    if (error === null) return ''
    const abs = Math.abs(error)
    if (abs <= 5) return 'text-primary'
    if (abs <= 10) return 'text-amber-600 dark:text-amber-400'
    return 'text-red-600 dark:text-red-400'
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: '2-digit'
    })
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select 
          value={searchParams.get('verified') || 'all'} 
          onValueChange={(v) => updateFilter('verified', v)}
        >
          <SelectTrigger className="w-[160px] min-h-[44px]">
            <SelectValue placeholder="Verification" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Examples</SelectItem>
            <SelectItem value="true">Verified</SelectItem>
            <SelectItem value="false">Pending</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]">Images</TableHead>
              <TableHead className="text-right">AI Score</TableHead>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead className="text-right">Error</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {examples.length > 0 ? (
              examples.map((ex) => (
                <TableRow key={ex.id}>
                  <TableCell>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <ImageIcon className="h-4 w-4" />
                          <span className="sr-only">View images</span>
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>Training Example Images</DialogTitle>
                        </DialogHeader>
                        <div className="grid grid-cols-2 gap-2 max-h-[60vh] overflow-y-auto">
                          {ex.image_urls.map((url, idx) => (
                            <div key={idx} className="relative aspect-video bg-muted rounded-md overflow-hidden">
                              {url.startsWith('data:') ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img 
                                  src={url} 
                                  alt={`Image ${idx + 1}`}
                                  className="object-cover w-full h-full"
                                />
                              ) : (
                                <Image 
                                  src={url} 
                                  alt={`Image ${idx + 1}`}
                                  fill
                                  className="object-cover"
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      </DialogContent>
                    </Dialog>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {ex.predicted_score?.toFixed(1) || '-'}
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium">
                    {ex.ground_truth_score.toFixed(1)}
                  </TableCell>
                  <TableCell className={`text-right font-mono ${getErrorColor(ex.error_amount)}`}>
                    {ex.error_amount !== null ? (
                      ex.error_amount > 0 ? `+${ex.error_amount.toFixed(1)}` : ex.error_amount.toFixed(1)
                    ) : '-'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs capitalize">
                      {ex.source.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(ex.created_at)}
                  </TableCell>
                  <TableCell>
                    {ex.verified_for_training ? (
                      <Badge className="bg-primary/10 text-primary">
                        Verified
                      </Badge>
                    ) : (
                      <Badge variant="outline">Pending</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {!ex.verified_for_training && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-primary"
                          onClick={() => handleVerify(ex.id, true)}
                          disabled={isPending}
                        >
                          {isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      {ex.verified_for_training && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-600 dark:text-red-400"
                          onClick={() => handleVerify(ex.id, false)}
                          disabled={isPending}
                        >
                          {isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <X className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No training examples found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * limit + 1} - {Math.min(page * limit, total)} of {total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              className="min-h-[36px]"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
              className="min-h-[36px]"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
