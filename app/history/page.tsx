export const dynamic = 'force-dynamic'

import Link from 'next/link'
import Image from 'next/image'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AppHeader } from '@/components/app-header'
import { ArrowRight, Camera, ChevronLeft, ChevronRight } from 'lucide-react'
import { listHistory } from '@/lib/storage/service'

const PAGE_SIZE = 20

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const page = Math.max(1, Number(params.page) || 1)
  const offset = (page - 1) * PAGE_SIZE

  const { data: bucks, count } = await listHistory({ limit: PAGE_SIZE, offset })
  const totalPages = Math.ceil(count / PAGE_SIZE)

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container max-w-2xl mx-auto px-4 py-6 pb-24">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <h1 
              className="text-2xl font-bold tracking-wider"
              style={{ color: 'var(--bronze-light)' }}
            >
              Scoring History
            </h1>
            {count > 0 && (
              <span 
                className="text-xs font-mono px-2 py-0.5 rounded"
                style={{ background: 'rgba(184,114,72,0.15)', color: 'var(--bronze-mid)', border: '1px solid var(--bronze-dark)' }}
              >
                {count}
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            {count > 0 ? 'Your AI-powered antler score estimates' : 'View your past AI antler score estimates'}
          </p>
        </div>

        {bucks.length === 0 && count === 0 ? (
          <Card 
            className="relative overflow-hidden"
            style={{ border: '1px solid var(--bronze-dark)', background: 'linear-gradient(180deg, rgba(28,24,20,0.95) 0%, rgba(22,20,18,0.98) 100%)' }}
          >
            <CardContent className="flex flex-col items-center justify-center py-16 text-center relative z-10">
              {/* Crosshair icon with bronze styling */}
              <div 
                className="h-16 w-16 rounded-full flex items-center justify-center mb-5"
                style={{ 
                  background: 'linear-gradient(145deg, var(--bronze-mid), var(--bronze-dark))',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,200,100,0.2)',
                }}
              >
                <Camera className="h-7 w-7" style={{ color: '#0d0a06' }} />
              </div>
              <h3 
                className="text-lg font-bold tracking-wider mb-2"
                style={{ color: 'var(--bronze-light)' }}
              >
                No Scores Yet
              </h3>
              <p className="text-muted-foreground text-sm mb-6 max-w-xs">
                Submit your first buck to get an AI-powered antler score estimate
              </p>
              <Link 
                href="/score"
                className="btn-bronze flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-bold tracking-widest uppercase"
              >
                Start Scoring
                <ArrowRight className="h-4 w-4" />
              </Link>
            </CardContent>
            {/* Subtle corner marks */}
            <div className="corner-marks absolute inset-0 pointer-events-none" />
          </Card>
        ) : (
          <>
            <div className="space-y-3">
              {bucks.map((buck) => {
                const prediction = buck.predictions?.[0]
                const thumbnail = buck.buck_images?.find((img) => img.public_url)?.public_url
                return (
                  <Link key={buck.id} href={`/results/${buck.id}`}>
                    <Card className="card-hover-glow group overflow-hidden">
                      <CardContent className="flex items-center gap-4 p-4">
                        {/* Thumbnail with bronze border on hover */}
                        <div 
                          className="relative h-16 w-16 rounded-lg overflow-hidden bg-muted flex-shrink-0 transition-all duration-200"
                          style={{ 
                            border: '2px solid transparent',
                            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.3)',
                          }}
                        >
                          {thumbnail ? (
                            <Image src={thumbnail} alt="Buck" fill className="object-cover transition-transform duration-300 group-hover:scale-105" />
                          ) : (
                            <div className="flex items-center justify-center h-full">
                              <Camera className="h-6 w-6 text-muted-foreground" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {buck.state && (
                              <Badge 
                                variant="secondary" 
                                className="text-xs"
                                style={{ background: 'rgba(184,114,72,0.15)', color: 'var(--bronze-light)', border: '1px solid var(--bronze-dark)' }}
                              >
                                {buck.state}
                              </Badge>
                            )}
                            {buck.rack_type && (
                              <Badge variant="outline" className="text-xs capitalize">{buck.rack_type}</Badge>
                            )}
                          </div>
                          {prediction && buck.status === 'completed' ? (
                            <div className="flex items-baseline gap-2">
                              <span 
                                className="text-xl font-bold score-emboss"
                                style={{ color: 'var(--bronze-light)' }}
                              >
                                {prediction.predicted_gross?.toFixed(1)}&quot;
                              </span>
                              <span className="text-sm text-muted-foreground">gross</span>
                              <span 
                                className="text-xs px-1.5 py-0.5 rounded"
                                style={{ background: 'rgba(90,184,80,0.15)', color: 'var(--scan-green)' }}
                              >
                                {prediction.confidence_percent?.toFixed(0)}%
                              </span>
                            </div>
                          ) : (
                            <Badge
                              variant={buck.status === 'failed' ? 'destructive' : 'secondary'}
                            >
                              {buck.status}
                            </Badge>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(buck.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <ArrowRight className="h-5 w-5 text-muted-foreground flex-shrink-0 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-[var(--bronze-light)]" />
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
                <p className="text-sm text-muted-foreground">
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, count)} of {count}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    disabled={page <= 1}
                    className="min-h-[44px] min-w-[44px]"
                  >
                    <Link href={`?page=${page - 1}`} aria-label="Previous page">
                      <ChevronLeft className="h-4 w-4" />
                    </Link>
                  </Button>
                  <span className="flex items-center px-3 text-sm text-muted-foreground">
                    {page} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    disabled={page >= totalPages}
                    className="min-h-[44px] min-w-[44px]"
                  >
                    <Link href={`?page=${page + 1}`} aria-label="Next page">
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
