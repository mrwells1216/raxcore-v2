import { createClient } from '@/lib/supabase/server'

// ============================================================================
// TYPES
// ============================================================================

export interface Collection {
  id: string
  user_id: string
  name: string
  description: string | null
  is_public: boolean
  share_token: string | null
  cover_image_url: string | null
  created_at: string
  updated_at: string
}

export interface CollectionBuck {
  id: string
  collection_id: string
  buck_id: string
  added_at: string
  sort_order: number
}

export interface CollectionWithBucks extends Collection {
  bucks_count: number
  cover_thumbnail?: string
}

// ============================================================================
// COLLECTION CRUD
// ============================================================================

export async function createCollection(params: {
  userId: string
  name: string
  description?: string
  isPublic?: boolean
}): Promise<Collection> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('collections')
    .insert({
      user_id: params.userId,
      name: params.name,
      description: params.description || null,
      is_public: params.isPublic || false,
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create collection: ${error.message}`)
  return data
}

export async function getUserCollections(userId: string): Promise<CollectionWithBucks[]> {
  const supabase = await createClient()
  
  // Get collections with buck count
  const { data: collections, error } = await supabase
    .from('collections')
    .select(`
      *,
      collection_bucks(count)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to get collections: ${error.message}`)
  
  // Get cover thumbnails for each collection
  const collectionsWithCovers = await Promise.all(
    (collections || []).map(async (collection) => {
      // Get first buck image as cover
      const { data: coverBuck } = await supabase
        .from('collection_bucks')
        .select(`
          buck_id,
          bucks!inner(
            buck_images(public_url)
          )
        `)
        .eq('collection_id', collection.id)
        .order('sort_order', { ascending: true })
        .limit(1)
        .single()

      const coverThumbnail = coverBuck?.bucks?.buck_images?.[0]?.public_url || null

      return {
        ...collection,
        bucks_count: collection.collection_bucks?.[0]?.count || 0,
        cover_thumbnail: coverThumbnail || collection.cover_image_url,
      }
    })
  )

  return collectionsWithCovers
}

export async function getCollection(collectionId: string): Promise<Collection | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('collections')
    .select('*')
    .eq('id', collectionId)
    .single()

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get collection: ${error.message}`)
  }
  return data
}

export async function updateCollection(
  collectionId: string,
  updates: {
    name?: string
    description?: string
    is_public?: boolean
    cover_image_url?: string
  }
): Promise<Collection> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('collections')
    .update(updates)
    .eq('id', collectionId)
    .select()
    .single()

  if (error) throw new Error(`Failed to update collection: ${error.message}`)
  return data
}

export async function deleteCollection(collectionId: string): Promise<void> {
  const supabase = await createClient()
  
  const { error } = await supabase
    .from('collections')
    .delete()
    .eq('id', collectionId)

  if (error) throw new Error(`Failed to delete collection: ${error.message}`)
}

// ============================================================================
// COLLECTION BUCKS
// ============================================================================

export async function addBuckToCollection(
  collectionId: string,
  buckId: string
): Promise<CollectionBuck> {
  const supabase = await createClient()
  
  // Get current max sort order
  const { data: maxOrder } = await supabase
    .from('collection_bucks')
    .select('sort_order')
    .eq('collection_id', collectionId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .single()

  const nextOrder = (maxOrder?.sort_order || 0) + 1

  const { data, error } = await supabase
    .from('collection_bucks')
    .insert({
      collection_id: collectionId,
      buck_id: buckId,
      sort_order: nextOrder,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new Error('Buck already in collection')
    }
    throw new Error(`Failed to add buck to collection: ${error.message}`)
  }
  return data
}

export async function removeBuckFromCollection(
  collectionId: string,
  buckId: string
): Promise<void> {
  const supabase = await createClient()
  
  const { error } = await supabase
    .from('collection_bucks')
    .delete()
    .eq('collection_id', collectionId)
    .eq('buck_id', buckId)

  if (error) throw new Error(`Failed to remove buck from collection: ${error.message}`)
}

export async function getCollectionBucks(collectionId: string) {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('collection_bucks')
    .select(`
      *,
      bucks(
        *,
        buck_images(*),
        predictions(*)
      )
    `)
    .eq('collection_id', collectionId)
    .order('sort_order', { ascending: true })

  if (error) throw new Error(`Failed to get collection bucks: ${error.message}`)
  return data || []
}

// ============================================================================
// SHARING
// ============================================================================

export async function generateCollectionShareToken(collectionId: string): Promise<string> {
  const supabase = await createClient()
  
  // Generate a random token
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  
  const { error } = await supabase
    .from('collections')
    .update({ 
      share_token: token,
      is_public: true 
    })
    .eq('id', collectionId)

  if (error) throw new Error(`Failed to generate share token: ${error.message}`)
  return token
}

export async function getCollectionByShareToken(token: string): Promise<Collection | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('collections')
    .select('*')
    .eq('share_token', token)
    .eq('is_public', true)
    .single()

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get shared collection: ${error.message}`)
  }
  return data
}
