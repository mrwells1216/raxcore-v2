import Link from 'next/link'
import Image from 'next/image'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AppHeader } from '@/components/app-header'
import {
  ArrowRight,
  Camera,
  Library,
  Plus,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { listUserBucks } from '@/lib/storage/service'
import { getUser, getProfile } from '@/lib/auth/actions'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'My Library | RAXcore',
  description: 'View and manage your saved bucks',
}

const PAGE_SIZE = 12

async function getUserLibraryStats(userId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('predictions')
    .select('predicted_gross, buck_id, bucks!inner(user_id, status)')
    .eq('bucks.user_id', userId)
    .eq('bucks.status', 'completed')
  const scores = (data ?? []).map((r: any) => r.predicted_gross as number).filter(Boolean)
  return {
    totalScored: scores.length,
    avgScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
    highestScore: scores.length > 0 ? Math.max(...scores) : 0,
  }
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const user = await getUser()

  if (!user) {
    redirect('/auth/login?redirect=/library')
  }

  const params = await searchParams
  const page = Math.max(1, Number(params.page) || 1)
  const offset = (page - 1) * PAGE_SIZE

  const [profile, bucksResult, stats] = await Promise.all([
    getProfile(),
    listUserBucks(user.id, { limit: PAGE_SIZE, offset }),
    getUserLibraryStats(user.id),
  ])

  const { data: bucks, count: totalCount } = bucksResult
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  const completedBucks = bucks.filter((b) => b.status === 'completed')
  const pendingBucks = bucks.filter(
    (b) => b.status === 'pending' || b.status === 'processing',
  )

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container max-w-4xl mx-auto px-4 py-6 pb-24">
        {/* Welcome header */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                <Library className="h-6 w-6" />
                My Library
              </h1>
              <p className="text-muted-foreground">
                Welcome back,{' '}
                {profile?.display_name || user.email?.split('@')[0]}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" asChild>
                <Link href="/library/collections" className="flex items-center gap-2">
                  <FolderOpen className="h-4 w-4" />
                  <span className="hidden sm:inline">Collections</span>
                </Link>
              </Button>
              <Button asChild>
                <Link href="/score" className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">Score Buck</span>
                </Link>
              </Button>
            </div>
          </div>
        </div>

        {/* Stats cards — derived from aggregate query, not the paginated list */}
        {stats.totalScored > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-primary">{stats.totalScored}</div>
                <div className="text-xs text-muted-foreground">Bucks Scored</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-primary">
                  {stats.avgScore.toFixed(1)}&quot;
                </div>
                <div className="text-xs text-muted-foreground">Avg Score</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-accent">
                  {stats.highestScore.toFixed(1)}&quot;
                </div>
                <div className="text-xs text-muted-foreground">Best Score</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Pending submissions — only shown on page 1 */}
        {page === 1 && pendingBucks.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Badge variant="secondary" className="animate-pulse">
                Processing
              </Badge>
              {pendingBucks.length} buck{pendingBucks.length > 1 ? 's' : ''} in progress
            </h2>
            <div className="space-y-3">
              {pendingBucks.map((buck) => {
                const thumbnail = buck.buck_images?.find((img) => img.public_url)?.public_url
                return (
                  <Link key={buck.id} href={`/results/${buck.id}`}>
                    <Card className="transition-colors hover:bg-accent/50 border-dashed">
                      <CardContent className="flex items-center gap-4 p-4">
                        <div className="relative h-14 w-14 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                          {thumbnail ? (
                            <Image src={thumbnail} alt="Buck" fill className="object-cover" />
                          ) : (
                            <div className="flex items-center justify-center h-full">
                              <Camera className="h-5 w-5 text-muted-foreground" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <Badge variant="secondary" className="text-xs mb-1 capitalize">
                            {buck.status}
                          </Badge>
                          <p className="text-sm text-muted-foreground">
                            Submitted {new Date(buck.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <ArrowRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        {/* Completed bucks grid */}
        {completedBucks.length > 0 ? (
          <div>
            <h2 className="text-lg font-semibold mb-3">Your Scored Bucks</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {completedBucks.map((buck) => {
                const prediction = buck.predictions?.[0]
                const thumbnail = buck.buck_images?.find((img) => img.public_url)?.public_url
                return (
                  <Link key={buck.id} href={`/results/${buck.id}`}>
                    <Card className="transition-all hover:bg-accent/50 hover:shadow-md h-full">
                      <CardContent className="p-0">
                        <div className="relative aspect-[4/3] bg-muted">
                          {thumbnail ? (
                            <Image
                              src={thumbnail}
                              alt="Buck"
                              fill
                              className="object-cover rounded-t-lg"
                            />
                          ) : (
                            <div className="flex items-center justify-center h-full">
                              <Camera className="h-8 w-8 text-muted-foreground" />
                            </div>
                          )}
                          {prediction && (
                            <div className="absolute bottom-2 left-2 bg-background/90 backdrop-blur-sm rounded-lg px-3 py-1.5 shadow-lg">
                              <div className="flex items-baseline gap-1">
                                <span className="text-xl font-bold">
                                  {prediction.predicted_gross?.toFixed(1)}
                                </span>
                                <span className="text-sm text-muted-foreground">&quot; gross</span>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="p-3">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            {buck.state && (
                              <Badge variant="secondary" className="text-xs">
                                {buck.state}
                              </Badge>
                            )}
                            {buck.rack_type && (
                              <Badge variant="outline" className="text-xs capitalize">
                                {buck.rack_type}
                              </Badge>
                            )}
                            {prediction?.confidence_percent && (
                              <Badge
                                variant="outline"
                                className={`text-xs ${
                                  prediction.confidence_percent >= 80
                                    ? 'border-success text-success'
                                    : prediction.confidence_percent >= 60
                                      ? 'border-warning text-warning'
                                      : ''
                                }`}
                              >
                                {prediction.confidence_percent.toFixed(0)}% conf
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {new Date(buck.created_at).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>
          </div>
        ) : totalCount === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="rounded-full bg-muted p-4 mb-4">
                <Camera className="h-10 w-10 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Your library is empty</h3>
              <p className="text-muted-foreground text-sm mb-6 max-w-sm">
                Score your first buck to start building your personal trophy collection
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button asChild size="lg">
                  <Link href="/score" className="flex items-center gap-2">
                    <Camera className="h-4 w-4" />
                    Score Your First Buck
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
            <p className="text-sm text-muted-foreground">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalCount)} of{' '}
              {totalCount}
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

        {/* Quick actions */}
        {totalCount > 0 && (
          <div className="mt-8 pt-6 border-t">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Quick Actions</h3>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href="/score" className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Score Another Buck
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/history">View All History</Link>
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
