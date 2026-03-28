import Link from 'next/link'
import Image from 'next/image'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  FolderOpen, 
  Camera, 
  Target,
  ExternalLink
} from 'lucide-react'
import { getCollectionByShareToken, getCollectionBucks } from '@/lib/collections/service'
import { notFound } from 'next/navigation'

interface ShareCollectionPageProps {
  params: Promise<{ token: string }>
}

export async function generateMetadata({ params }: ShareCollectionPageProps) {
  const { token } = await params
  const collection = await getCollectionByShareToken(token)
  
  if (!collection) {
    return { title: 'Shared Collection | RAXcore' }
  }
  
  return {
    title: `${collection.name} - Shared from RAXcore`,
    description: collection.description || `View this shared collection of scored bucks from RAXcore`,
  }
}

export default async function ShareCollectionPage({ params }: ShareCollectionPageProps) {
  const { token } = await params
  const collection = await getCollectionByShareToken(token)
  
  if (!collection) {
    notFound()
  }

  const collectionBucks = await getCollectionBucks(collection.id)

  return (
    <div className="min-h-screen bg-background">
      {/* Simple header */}
      <header className="border-b border-border/40 bg-background/95 backdrop-blur">
        <div className="container flex h-14 max-w-screen-xl items-center px-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
              Rx
            </div>
            <span className="font-semibold text-lg tracking-tight">RAXcore</span>
          </Link>
          <div className="flex-1" />
          <Button asChild size="sm">
            <Link href="/score">
              Score Your Buck
            </Link>
          </Button>
        </div>
      </header>

      <main className="container max-w-4xl mx-auto px-4 py-8 pb-24">
        {/* Shared badge */}
        <div className="flex justify-center mb-6">
          <Badge variant="secondary" className="gap-2">
            <ExternalLink className="h-3 w-3" />
            Shared Collection
          </Badge>
        </div>

        {/* Collection header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
              <FolderOpen className="h-8 w-8" />
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-2">
            {collection.name}
          </h1>
          {collection.description && (
            <p className="text-muted-foreground max-w-md mx-auto">
              {collection.description}
            </p>
          )}
          <p className="text-sm text-muted-foreground mt-2">
            {collectionBucks.length} buck{collectionBucks.length !== 1 ? 's' : ''} in this collection
          </p>
        </div>

        {/* Bucks grid */}
        {collectionBucks.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {collectionBucks.map((item) => {
              const buck = item.bucks
              const prediction = buck?.predictions?.[0]
              const thumbnail = buck?.buck_images?.find((img: { public_url?: string }) => img.public_url)?.public_url
              
              if (!buck) return null

              // Link to the individual share page if the buck is public
              const buckLink = buck.share_token 
                ? `/share/${buck.share_token}` 
                : '#'

              return (
                <Card key={item.id} className="overflow-hidden">
                  <CardContent className="p-0">
                    <div className="relative aspect-[4/3] bg-muted">
                      {thumbnail ? (
                        <Image src={thumbnail} alt="Buck" fill className="object-cover" />
                      ) : (
                        <div className="flex items-center justify-center h-full">
                          <Camera className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                      {/* Score badge overlay */}
                      {prediction && (
                        <div className="absolute bottom-2 left-2 bg-background/90 backdrop-blur-sm rounded-lg px-3 py-1.5 shadow-lg">
                          <div className="flex items-baseline gap-1">
                            <span className="text-xl font-bold">{prediction.predicted_gross?.toFixed(1)}</span>
                            <span className="text-sm text-muted-foreground">&quot;</span>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        {buck.state && (
                          <Badge variant="secondary" className="text-xs">{buck.state}</Badge>
                        )}
                        {buck.rack_type && (
                          <Badge variant="outline" className="text-xs capitalize">{buck.rack_type}</Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Camera className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Collection is empty</h3>
              <p className="text-muted-foreground text-sm">
                No bucks have been added to this collection yet
              </p>
            </CardContent>
          </Card>
        )}

        {/* CTA */}
        <Card className="mt-8 bg-primary/5 border-primary/20">
          <CardContent className="flex flex-col items-center py-8 text-center">
            <h3 className="text-lg font-semibold mb-2">Want to score your own buck?</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Get an AI-powered score estimate in seconds
            </p>
            <Button asChild size="lg">
              <Link href="/score">
                <Target className="mr-2 h-4 w-4" />
                Start Scoring
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Disclaimer */}
        <div className="mt-8 text-center text-xs text-muted-foreground">
          <p>
            All scores are AI-generated estimates and should not be used as official measurements.
          </p>
        </div>
      </main>
    </div>
  )
}
