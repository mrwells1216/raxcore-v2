declare module 'react-simple-maps' {
  import type { ReactNode, SVGProps, MouseEvent } from 'react'

  export interface ComposableMapProps {
    projection?: string
    projectionConfig?: Record<string, unknown>
    width?: number
    height?: number
    style?: React.CSSProperties
    className?: string
    onClick?: (event: MouseEvent<SVGElement>) => void
    children?: ReactNode
    [key: string]: unknown
  }

  export interface ZoomableGroupProps {
    zoom?: number
    center?: [number, number]
    onMoveStart?: (data: unknown) => void
    onMove?: (data: unknown) => void
    onMoveEnd?: (data: unknown) => void
    translateExtent?: [[number, number], [number, number]]
    filterZoomEvent?: () => boolean
    minZoom?: number
    maxZoom?: number
    children?: ReactNode
    [key: string]: unknown
  }

  export interface GeographyFeature {
    rsmKey: string
    geometry: Record<string, unknown>
    properties: Record<string, string | number | boolean | null>
    [key: string]: unknown
  }

  export interface GeoProjection {
    (coords: [number, number]): [number, number] | null
    invert?: (point: [number, number]) => [number, number] | null
  }

  export interface GeographiesProps {
    geography: string | Record<string, unknown>
    children: (props: {
      geographies: GeographyFeature[]
      projection: GeoProjection
      path: (geo: unknown) => string | null
      outline: GeographyFeature
      borders: GeographyFeature
    }) => ReactNode
    parseGeographies?: (data: unknown) => GeographyFeature[]
  }

  export interface GeographyProps extends Omit<SVGProps<SVGPathElement>, 'ref'> {
    geography: GeographyFeature
    style?: {
      default?: Record<string, unknown>
      hover?: Record<string, unknown>
      pressed?: Record<string, unknown>
    }
    [key: string]: unknown
  }

  export interface MarkerProps extends Omit<SVGProps<SVGGElement>, 'ref'> {
    coordinates: [number, number]
    children?: ReactNode
  }

  export const ComposableMap: React.FC<ComposableMapProps>
  export const ZoomableGroup: React.FC<ZoomableGroupProps>
  export const Geographies: React.FC<GeographiesProps>
  export const Geography: React.FC<GeographyProps>
  export const Marker: React.FC<MarkerProps>
}
