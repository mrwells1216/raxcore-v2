import Link from 'next/link'
import Image from 'next/image'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Header } from '@/components/header'
import { 
  ArrowLeft, 
  ArrowRight,
  Camera,
  Lock,
  Globe,
  Share2,
  Settings,
  Plus
} from 'lucide-react'
import { getCollection, getCollectionBucks } from '@/lib/collections/service'
import { getUser } from '@/lib/auth/actions'
import { redirect, notFound } from 'next/navigation'
import { ShareCollectionButton } from './share-collection-button'

interface CollectionPageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: CollectionPageProps) {
  const { id } = await params
  const collection = await getCollection(id)
  return {
    title: collection ? `${collection.name} | RAXcore` : 'Collection | RAXcore',
    description: collection?.description || 'View collection details',
  }
}

export default async function CollectionPage({ params }: CollectionPageProps) {
  const { id } = await params
  const user = await getUser()
  
  if (!user) {
    redirect('/auth/login?redirect=/library/collections/' + id)
  }

  const collection = await getCollection(id)
  
  if (!collection) {
    notFound()
  }

  // Check if user owns the collection
  if (collection.user_id !== user.id && !collection.is_public) {
    notFound()
  }

  const collectionBucks = await getCollectionBucks(id)
  const isOwner = collection.user_id === user.id

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-4xl mx-auto px-4 py-6 pb-24">
        {/* Header */}
        <div className="mb-6">
          <Link 
            href="/library/collections" 
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Collections
          </Link>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl font-bold tracking-tight truncate">
                  {collection.name}
                </h1>
                <Badge variant={collection.is_public ? 'default' : 'secondary'} className="flex-shrink-0">
                  {collection.is_public ? (
                    <>
                      <Globe className="h-3 w-3 mr-1" />
                      Public
                    </>
                  ) : (
                    <>
                      <Lock className="h-3 w-3 mr-1" />
                      Private
                    </>
                  )}
                </Badge>
              </div>
              {collection.description && (
                <p className="text-muted-foreground">{collection.description}</p>
              )}
              <p className="text-sm text-muted-foreground mt-1">
                {collectionBucks.length} buck{collectionBucks.length !== 1 ? 's' : ''}
              </p>
            </div>
            {isOwner && (
              <div className="flex items-center gap-2 flex-shrink-0">
                <ShareCollectionButton 
                  collectionId={collection.id} 
                  shareToken={collection.share_token}
                  isPublic={collection.is_public}
                />
                <Button variant="outline" size="icon" asChild>
                  <Link href={`/library/collections/${collection.id}/settings`}>
                    <Settings className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Bucks grid */}
        {collectionBucks.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {collectionBucks.map((item) => {
              const buck = item.bucks
              const prediction = buck?.predictions?.[0]
              const thumbnail = buck?.buck_images?.find((img: { public_url?: string }) => img.public_url)?.public_url
              
              if (!buck) return null

              return (
                <Link key={item.id} href={`/results/${buck.id}`}>
                  <Card className="transition-all hover:bg-accent/50 hover:shadow-md h-full">
                    <CardContent className="p-0">
                      <div className="relative aspect-[4/3] bg-muted">
                        {thumbnail ? (
                          <Image src={thumbnail} alt="Buck" fill className="object-cover rounded-t-lg" />
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
                              <span className="text-sm text-muted-foreground">&quot; gross</span>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="p-3">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {buck.state && (
                            <Badge variant="secondary" className="text-xs">{buck.state}</Badge>
                          )}
                          {buck.rack_type && (
                            <Badge variant="outline" className="text-xs capitalize">{buck.rack_type}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {new Date(buck.created_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="rounded-full bg-muted p-4 mb-4">
                <Camera className="h-10 w-10 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Collection is empty</h3>
              <p className="text-muted-foreground text-sm mb-6 max-w-sm">
                Add bucks from your library to this collection
              </p>
              <Button asChild>
                <Link href="/library" className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Go to Library
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
