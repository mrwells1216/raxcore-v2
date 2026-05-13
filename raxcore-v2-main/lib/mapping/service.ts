import type {
  MapBounds,
  MapCoordinate,
  MapFeature,
  MapFeatureType,
  TerrainMeshDescriptor,
  TerrainSample,
} from '@/lib/mapping/types'

const VALID_FEATURE_TYPES = new Set<MapFeatureType>([
  'property_boundary',
  'trail',
  'stand',
  'blind',
  'camera',
  'bedding_area',
  'feeding_area',
  'water',
  'scrape',
  'rub',
  'harvest_location',
  'access_route',
  'terrain_note',
])

export function validateCoordinate(coordinate: unknown): coordinate is MapCoordinate {
  if (!coordinate || typeof coordinate !== 'object') return false
  const c = coordinate as MapCoordinate
  const elevationValid =
    c.elevationMeters === undefined ||
    c.elevationMeters === null ||
    (typeof c.elevationMeters === 'number' && Number.isFinite(c.elevationMeters))

  return (
    typeof c.lat === 'number' &&
    Number.isFinite(c.lat) &&
    c.lat >= -90 &&
    c.lat <= 90 &&
    typeof c.lng === 'number' &&
    Number.isFinite(c.lng) &&
    c.lng >= -180 &&
    c.lng <= 180 &&
    elevationValid
  )
}

export function calculateBounds(coordinates: MapCoordinate[]): MapBounds | null {
  const valid = coordinates.filter(validateCoordinate)
  if (valid.length === 0) return null

  return valid.reduce<MapBounds>(
    (bounds, coordinate) => ({
      north: Math.max(bounds.north, coordinate.lat),
      south: Math.min(bounds.south, coordinate.lat),
      east: Math.max(bounds.east, coordinate.lng),
      west: Math.min(bounds.west, coordinate.lng),
    }),
    {
      north: valid[0].lat,
      south: valid[0].lat,
      east: valid[0].lng,
      west: valid[0].lng,
    },
  )
}

export function normalizeMapFeature(input: Partial<MapFeature>): MapFeature | null {
  if (!input.id || !input.propertyId || !input.type || !VALID_FEATURE_TYPES.has(input.type)) {
    return null
  }

  const coordinates = Array.isArray(input.coordinates)
    ? input.coordinates.filter(validateCoordinate)
    : []

  if (coordinates.length === 0) return null

  return {
    id: input.id,
    propertyId: input.propertyId,
    type: input.type,
    name: input.name ?? null,
    coordinates,
    metadata:
      input.metadata && typeof input.metadata === 'object'
        ? input.metadata
        : undefined,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  }
}

export function estimateTerrainReadiness(input: {
  bounds?: MapBounds | null
  samples?: TerrainSample[] | null
  requiredSampleCount?: number
}): TerrainMeshDescriptor['status'] {
  if (!input.bounds) return 'not_started'

  const requiredSampleCount = Math.max(1, input.requiredSampleCount ?? 4)
  const validSamples = (input.samples ?? []).filter(
    (sample) =>
      validateCoordinate(sample.coordinate) &&
      typeof sample.elevationMeters === 'number' &&
      Number.isFinite(sample.elevationMeters),
  )

  if (validSamples.length === 0) return 'not_started'
  if (validSamples.length < requiredSampleCount) return 'sampling'
  return 'ready'
}

export function createEmptyTerrainMeshDescriptor(input: {
  propertyId: string
  bounds: MapBounds
  resolutionMeters?: number
}): TerrainMeshDescriptor {
  return {
    propertyId: input.propertyId,
    bounds: input.bounds,
    resolutionMeters: input.resolutionMeters ?? 10,
    elevationSource: 'none',
    status: 'not_started',
  }
}
