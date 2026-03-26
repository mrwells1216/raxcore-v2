import Link from 'next/link'
import Image from 'next/image'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Header } from '@/components/header'
import { ArrowRight, Camera } from 'lucide-react'
import { listHistory } from '@/lib/storage/service'

export default async function HistoryPage() {
  const bucks = await listHistory()

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-2xl mx-auto px-4 py-6 pb-24">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Scoring History</h1>
          <p className="text-muted-foreground">View your past AI antler score estimates</p>
        </div>

        {bucks.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Camera className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No scores yet</h3>
              <p className="text-muted-foreground text-sm mb-4">Submit your first buck to get an AI-powered antler score estimate</p>
              <Button asChild>
                <Link href="/score">Start Scoring<ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {bucks.map((buck) => {
              const prediction = buck.predictions?.[0]
              const thumbnail = buck.buck_images?.find((img) => img.public_url)?.public_url
              return (
                <Link key={buck.id} href={`/results/${buck.id}`}>
                  <Card className="transition-colors hover:bg-accent/50">
                    <CardContent className="flex items-center gap-4 p-4">
                      <div className="relative h-16 w-16 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                        {thumbnail ? (
                          <Image src={thumbnail} alt="Buck" fill className="object-cover" />
                        ) : (
                          <div className="flex items-center justify-center h-full"><Camera className="h-6 w-6 text-muted-foreground" /></div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="secondary" className="text-xs">{buck.state}</Badge>
                          <Badge variant="outline" className="text-xs capitalize">{buck.rack_type}</Badge>
                        </div>
                        {prediction && buck.status === 'completed' ? (
                          <div className="flex items-baseline gap-2">
                            <span className="text-lg font-bold">{prediction.predicted_gross?.toFixed(1)}&quot;</span>
                            <span className="text-sm text-muted-foreground">gross</span>
                            <span className="text-sm text-muted-foreground">({prediction.confidence_percent?.toFixed(0)}% conf)</span>
                          </div>
                        ) : (
                          <Badge variant={buck.status === 'failed' ? 'destructive' : 'secondary'}>{buck.status}</Badge>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">{new Date(buck.created_at).toLocaleDateString()}</p>
                      </div>
                      <ArrowRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
