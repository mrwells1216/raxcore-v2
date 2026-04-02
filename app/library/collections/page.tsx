export const dynamic = 'force-dynamic'

import Link from 'next/link'
import Image from 'next/image'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Header } from '@/components/header'
import { 
  FolderOpen, 
  Plus, 
  ArrowLeft,
  Lock,
  Globe,
  Image as ImageIcon
} from 'lucide-react'
import { getUserCollections } from '@/lib/collections/service'
import { getUser } from '@/lib/auth/actions'
import { redirect } from 'next/navigation'
import { CreateCollectionDialog } from './create-collection-dialog'

export const metadata = {
  title: 'Collections | RAXcore',
  description: 'Organize your bucks into collections',
}

export default async function CollectionsPage() {
  const user = await getUser()
  
  if (!user) {
    redirect('/auth/login?redirect=/library/collections')
  }

  const collections = await getUserCollections(user.id)

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-4xl mx-auto px-4 py-6 pb-24">
        {/* Header */}
        <div className="mb-6">
          <Link 
            href="/library" 
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Library
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                <FolderOpen className="h-6 w-6" />
                Collections
              </h1>
              <p className="text-muted-foreground">
                Organize your bucks into collections
              </p>
            </div>
            <CreateCollectionDialog userId={user.id} />
          </div>
        </div>

        {/* Collections grid */}
        {collections.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {collections.map((collection) => (
              <Link key={collection.id} href={`/library/collections/${collection.id}`}>
                <Card className="transition-all hover:bg-accent/50 hover:shadow-md h-full">
                  <CardContent className="p-0">
                    <div className="relative aspect-[4/3] bg-muted rounded-t-lg overflow-hidden">
                      {collection.cover_thumbnail ? (
                        <Image 
                          src={collection.cover_thumbnail} 
                          alt={collection.name} 
                          fill 
                          className="object-cover" 
                        />
                      ) : (
                        <div className="flex items-center justify-center h-full">
                          <ImageIcon className="h-10 w-10 text-muted-foreground/50" />
                        </div>
                      )}
                      {/* Privacy badge */}
                      <div className="absolute top-2 right-2">
                        <Badge 
                          variant={collection.is_public ? 'default' : 'secondary'} 
                          className="text-xs gap-1"
                        >
                          {collection.is_public ? (
                            <>
                              <Globe className="h-3 w-3" />
                              Public
                            </>
                          ) : (
                            <>
                              <Lock className="h-3 w-3" />
                              Private
                            </>
                          )}
                        </Badge>
                      </div>
                    </div>
                    <div className="p-4">
                      <h3 className="font-semibold truncate">{collection.name}</h3>
                      {collection.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                          {collection.description}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-2">
                        {collection.bucks_count} buck{collection.bucks_count !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="rounded-full bg-muted p-4 mb-4">
                <FolderOpen className="h-10 w-10 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold mb-2">No collections yet</h3>
              <p className="text-muted-foreground text-sm mb-6 max-w-sm">
                Create your first collection to organize your scored bucks
              </p>
              <CreateCollectionDialog userId={user.id} />
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
