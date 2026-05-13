import type {
  MapBounds,
  TerrainMeshDescriptor,
  TerrainSample,
} from '@/lib/mapping/types'

export interface TerrainProvider {
  getElevationSamples(
    bounds: MapBounds,
    resolutionMeters: number,
  ): Promise<TerrainSample[]>
}

export interface TerrainMeshBuilder {
  buildMesh(samples: TerrainSample[]): Promise<TerrainMeshDescriptor>
}

export class NoopTerrainProvider implements TerrainProvider {
  async getElevationSamples(): Promise<TerrainSample[]> {
    return []
  }
}

export function createNoopTerrainMeshDescriptor(input: {
  propertyId: string
  bounds: MapBounds
  resolutionMeters: number
}): TerrainMeshDescriptor {
  return {
    propertyId: input.propertyId,
    bounds: input.bounds,
    resolutionMeters: input.resolutionMeters,
    elevationSource: 'none',
    status: 'not_started',
  }
}
