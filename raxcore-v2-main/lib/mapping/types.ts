export interface MapCoordinate {
  lat: number
  lng: number
  elevationMeters?: number | null
}

export interface MapBounds {
  north: number
  south: number
  east: number
  west: number
}

export type MapFeatureType =
  | 'property_boundary'
  | 'trail'
  | 'stand'
  | 'blind'
  | 'camera'
  | 'bedding_area'
  | 'feeding_area'
  | 'water'
  | 'scrape'
  | 'rub'
  | 'harvest_location'
  | 'access_route'
  | 'terrain_note'

export interface MapFeature {
  id: string
  propertyId: string
  type: MapFeatureType
  name?: string | null
  coordinates: MapCoordinate[]
  metadata?: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

export interface TerrainSample {
  coordinate: MapCoordinate
  elevationMeters: number
  source?: 'manual' | 'provider' | 'derived'
}

export interface TerrainMeshDescriptor {
  propertyId: string
  bounds: MapBounds
  resolutionMeters: number
  elevationSource: 'none' | 'manual' | 'provider' | 'derived'
  status: 'not_started' | 'sampling' | 'ready' | 'failed'
}
