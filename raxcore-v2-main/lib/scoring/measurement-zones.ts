import { FIELD_DEFS, type FieldId, type Measurement2D, type Measurement3D } from '@/components/measure/measure-store'
import type { MeasurementMethod } from '@/lib/advanced-scoring/types'

export interface MeasurementZone {
  zoneId: FieldId
  type: 'beam' | 'tine' | 'circumference' | 'spread'
  color: string
  provenance: 'ai' | 'heuristic' | 'human'
  /** Exact badge text: 'AI', 'Heuristic', or 'Human' */
  badgeText: 'AI' | 'Heuristic' | 'Human'
  source: string
  points2D?: Array<{ x: number; y: number }>
  points3D?: Array<{ x: number; y: number; z: number }>
}

function methodToProvenance(method: MeasurementMethod): 'ai' | 'heuristic' | 'human' {
  if (method === 'quick_ai') return 'ai'
  if (method === 'photo_polyline' || method === 'three_d_point_cloud' || method === 'manual_entry') return 'human'
  return 'heuristic'
}

export function buildMeasurementZones(
  measurements2D: Record<FieldId, Measurement2D>,
  measurements3D: Record<FieldId, Measurement3D>,
): MeasurementZone[] {
  return FIELD_DEFS.map(fd => {
    const m2 = measurements2D[fd.id]
    const m3 = measurements3D[fd.id]

    // Prefer 3D method for provenance if it has measurements; fall back to 2D
    const activeMethod: MeasurementMethod =
      m3 && m3.points.length > 0 ? m3.method :
      m2 && m2.points.length > 0 ? m2.method :
      'three_d_mesh_fallback'

    const provenance = methodToProvenance(activeMethod)

    return {
      zoneId: fd.id,
      type: fd.type,
      color: fd.color,
      provenance,
      badgeText: provenance === 'ai' ? 'AI' : provenance === 'human' ? 'Human' : 'Heuristic',
      source: activeMethod,
      points2D: m2 && m2.points.length >= 2 ? m2.points : undefined,
      points3D: m3 && m3.points.length >= 2 ? m3.points : undefined,
    }
  })
}
