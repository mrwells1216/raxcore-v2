'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps'
import type { MapPin as MapPinType, LocationType } from '@/lib/types'

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const LOCATION_TYPE_COLORS: Record<LocationType, string> = {
  sighting:         '#4a7fa5',
  trailcam:         '#6b5b93',
  harvest:          '#8b3a3a',
  shed:             '#8a6a2a',
  scoring_source:   '#2e7a5e',
  stand:            '#3a4a8b',
  blind:            '#5a4a7a',
  scrape:           '#7a5030',
  rub:              '#6b5520',
  food_plot:        '#3a6e35',
  bedding:          '#6b3a7a',
  travel_corridor:  '#445060',
  unknown:          '#4a4f58',
}

const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  sighting: 'Sighting',
  trailcam: 'Trail Cam',
  harvest: 'Harvest',
  shed: 'Shed',
  scoring_source: 'Scoring Source',
  stand: 'Stand',
  blind: 'Blind',
  scrape: 'Scrape',
  rub: 'Rub',
  food_plot: 'Food Plot',
  bedding: 'Bedding',
  travel_corridor: 'Travel Corridor',
  unknown: 'Unknown',
}

// Switch to heat-map visualization once total pin count reaches this.
const HEAT_PIN_THRESHOLD = 20

// Admin-1 boundaries (state / province lines) for the two countries we render.
// Both are GeoJSON FeatureCollections keyed by `properties.name`, served with
// permissive CORS by jsdelivr. Using GeoJSON (not TopoJSON) avoids any
// object-selection ambiguity in react-simple-maps.
const US_STATES_URL =
  'https://cdn.jsdelivr.net/gh/codeforamerica/click_that_hood@master/public/data/united-states.geojson'
const CANADA_PROVINCES_URL =
  'https://cdn.jsdelivr.net/gh/codeforamerica/click_that_hood@master/public/data/canada.geojson'

const MAP_COLORS = {
  background: '#16110d',
  // Land fills sit a touch darker than the borders so state/province lines
  // clearly stand out (the old 0.4px low-contrast stroke read as invisible).
  landFill: '#231d18',
  landFillHover: '#36291d',
  // Bright, warm border so internal state/province lines are unmistakable.
  landStroke: '#9c8568',
  ocean: '#0b0805',
  // Highlight for the state/province under a pending pin.
  highlightFill: 'rgba(251,191,36,0.20)',
  highlightStroke: 'rgba(251,191,36,0.95)',
}

// Border stroke widths. Kept as non-scaling strokes so lines stay crisp.
const STROKE = {
  border: 0.7,
  hover: 1.1,
  highlight: 1.4,
}

// ─────────────────────────────────────────────────────────────────────────────
// GEOMETRY — self-contained point-in-polygon (lng/lat ray casting). Kept local
// so we don't need d3-geo as a direct dependency (it's only a transitive dep of
// react-simple-maps and isn't resolvable from app code under pnpm).
// ─────────────────────────────────────────────────────────────────────────────

type Ring = [number, number][]

function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

// Handles GeoJSON Polygon ([ring0, holes...]) and MultiPolygon ([polygon...]).
// A point counts as contained when it is inside an outer ring and not inside a
// hole of that same polygon.
function geometryContains(
  lng: number,
  lat: number,
  geometry: { type?: string; coordinates?: unknown } | null | undefined
): boolean {
  if (!geometry || !Array.isArray(geometry.coordinates)) return false
  const polys =
    geometry.type === 'Polygon'
      ? [geometry.coordinates as Ring[]]
      : geometry.type === 'MultiPolygon'
        ? (geometry.coordinates as Ring[][])
        : []
  for (const poly of polys) {
    if (!poly.length) continue
    if (pointInRing(lng, lat, poly[0])) {
      let inHole = false
      for (let k = 1; k < poly.length; k++) {
        if (pointInRing(lng, lat, poly[k])) {
          inHole = true
          break
        }
      }
      if (!inHole) return true
    }
  }
  return false
}

interface MapViewerProps {
  pins: MapPinType[]
  onPinClick?: (pin: MapPinType) => void
  onMapClick?: (lat: number, lng: number) => void
  selectedPinId?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function MapViewer({ pins, onPinClick, onMapClick, selectedPinId }: MapViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // We capture the d3 projection function from <Geographies> so we can invert
  // mouse clicks back into [lng, lat] coordinates.
  type GeoProjection = ((coords: [number, number]) => [number, number] | null) & {
    invert?: (point: [number, number]) => [number, number] | null
  }
  const projectionRef = useRef<GeoProjection | null>(null)

  const [pendingPin, setPendingPin] = useState<{ lat: number; lng: number } | null>(null)
  const [hoveredPinId, setHoveredPinId] = useState<string | null>(null)

  const placedPins = pins.filter(p => p.latitude != null && p.longitude != null)
  const isHeatMode = placedPins.length >= HEAT_PIN_THRESHOLD

  const handleSvgClick = useCallback((event: React.MouseEvent<SVGElement>) => {
    const target = event.target as Element
    // Ignore clicks on existing pin markers (their own handlers will fire).
    if (target.closest('[data-rax-pin]')) return

    const svg = event.currentTarget.ownerSVGElement ?? (event.currentTarget as unknown as SVGSVGElement)
    const pt = svg.createSVGPoint()
    pt.x = event.clientX
    pt.y = event.clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return
    const cursor = pt.matrixTransform(ctm.inverse())

    const projection = projectionRef.current
    if (!projection?.invert) return
    const lngLat = projection.invert([cursor.x, cursor.y])
    if (!lngLat) return
    const [lng, lat] = lngLat
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return

    setPendingPin({ lat, lng })
  }, [])

  const handleConfirmPin = useCallback(() => {
    if (pendingPin && onMapClick) {
      onMapClick(pendingPin.lat, pendingPin.lng)
    }
    setPendingPin(null)
  }, [pendingPin, onMapClick])

  const handleCancelPin = useCallback(() => {
    setPendingPin(null)
  }, [])

  // Dismiss pending pin on Escape.
  useEffect(() => {
    if (!pendingPin) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingPin(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingPin])

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-[400px] rounded-lg overflow-hidden"
      style={{ background: MAP_COLORS.ocean }}
    >
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{
          // Framed to fit the contiguous US through southern/central Canada.
          // Mercator stretches the far north, so center sits a bit above the US.
          scale: 430,
          center: [-96, 53],
        }}
        width={980}
        height={620}
        style={{ width: '100%', height: '100%' }}
        onClick={handleSvgClick}
      >
        <defs>
          {/* Heat-map blur + radial gradient for harvest density */}
          <filter id="rax-heat-blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
          <radialGradient id="rax-heat-gradient">
            <stop offset="0%" stopColor="rgba(239,68,68,0.85)" />
            <stop offset="60%" stopColor="rgba(239,68,68,0.35)" />
            <stop offset="100%" stopColor="rgba(239,68,68,0)" />
          </radialGradient>
        </defs>

        {/* Admin-1 boundaries: US states + Canadian provinces. Each region is
            its own polygon, so internal state/province lines render naturally.
            The province/state under a pending pin gets a minimal amber wash. */}
        {[US_STATES_URL, CANADA_PROVINCES_URL].map((geoUrl, layerIndex) => (
          <Geographies key={geoUrl} geography={geoUrl}>
            {({ geographies, projection }) => {
              // Capture the shared d3 projection once (for click → lng/lat).
              if (layerIndex === 0) {
                projectionRef.current = projection as typeof projectionRef.current
              }
              return geographies.map(geo => {
                const isHighlighted =
                  !!pendingPin &&
                  geometryContains(
                    pendingPin.lng,
                    pendingPin.lat,
                    geo.geometry as { type?: string; coordinates?: unknown }
                  )
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    vectorEffect="non-scaling-stroke"
                    style={{
                      default: {
                        fill: isHighlighted ? MAP_COLORS.highlightFill : MAP_COLORS.landFill,
                        stroke: isHighlighted ? MAP_COLORS.highlightStroke : MAP_COLORS.landStroke,
                        strokeWidth: isHighlighted ? STROKE.highlight : STROKE.border,
                        vectorEffect: 'non-scaling-stroke',
                        outline: 'none',
                        transition: 'fill 120ms ease',
                      },
                      hover: {
                        fill: MAP_COLORS.landFillHover,
                        stroke: MAP_COLORS.highlightStroke,
                        strokeWidth: STROKE.hover,
                        vectorEffect: 'non-scaling-stroke',
                        outline: 'none',
                        cursor: 'crosshair',
                      },
                      pressed: {
                        fill: MAP_COLORS.landFillHover,
                        stroke: MAP_COLORS.highlightStroke,
                        strokeWidth: STROKE.hover,
                        vectorEffect: 'non-scaling-stroke',
                        outline: 'none',
                      },
                    }}
                  />
                )
              })
            }}
          </Geographies>
        ))}

        {/* Heat layer — additive blurred blobs at harvest densities */}
        {isHeatMode && (
          <g filter="url(#rax-heat-blur)" style={{ pointerEvents: 'none' }}>
            {placedPins.map(pin => (
              <Marker
                key={`heat-${pin.id}`}
                coordinates={[pin.longitude!, pin.latitude!]}
              >
                <circle r={14} fill="url(#rax-heat-gradient)" />
              </Marker>
            ))}
          </g>
        )}

        {/* Pin markers — full size in pin-mode, shrunken dots in heat-mode */}
        {placedPins.map(pin => {
          const isSelected = selectedPinId === pin.id
          const isHovered = hoveredPinId === pin.id
          const color = LOCATION_TYPE_COLORS[pin.location_type]
          if (isHeatMode) {
            return (
              <Marker
                key={pin.id}
                coordinates={[pin.longitude!, pin.latitude!]}
                onClick={(e) => {
                  e.stopPropagation()
                  onPinClick?.(pin)
                }}
                onMouseEnter={() => setHoveredPinId(pin.id)}
                onMouseLeave={() => setHoveredPinId(null)}
                style={{ cursor: 'pointer' }}
              >
                <circle
                  data-rax-pin="true"
                  r={isSelected || isHovered ? 4 : 2.5}
                  fill={color}
                  stroke="rgba(255,255,255,0.85)"
                  strokeWidth={isSelected ? 1.2 : 0.6}
                />
              </Marker>
            )
          }
          return (
            <Marker
              key={pin.id}
              coordinates={[pin.longitude!, pin.latitude!]}
              onClick={(e) => {
                e.stopPropagation()
                onPinClick?.(pin)
              }}
              onMouseEnter={() => setHoveredPinId(pin.id)}
              onMouseLeave={() => setHoveredPinId(null)}
              style={{ cursor: 'pointer' }}
            >
              <g data-rax-pin="true" transform="translate(-7, -18)">
                <ellipse cx="7" cy="18" rx="3" ry="1.2" fill="rgba(0,0,0,0.35)" />
                <path
                  d="M7 0C3.13 0 0 3.13 0 7c0 4.6 7 11 7 11s7-6.4 7-11c0-3.87-3.13-7-7-7z"
                  fill={color}
                  stroke={isSelected || isHovered ? '#fff' : 'rgba(255,255,255,0.45)'}
                  strokeWidth={isSelected ? 1.6 : 0.8}
                />
                <circle cx="7" cy="7" r="2.4" fill="rgba(255,255,255,0.95)" />
              </g>
            </Marker>
          )
        })}

        {/* Pending pin — pulse honors prefers-reduced-motion via a CSS media query.
            CSS transform scale is used (works cross-browser; SMIL `r` animation
            does not respect reduced-motion). */}
        {pendingPin && (
          <Marker coordinates={[pendingPin.lng, pendingPin.lat]}>
            <g transform="translate(-7, -18)" style={{ pointerEvents: 'none' }}>
              <ellipse cx="7" cy="18" rx="3" ry="1.2" fill="rgba(0,0,0,0.35)" />
              <path
                d="M7 0C3.13 0 0 3.13 0 7c0 4.6 7 11 7 11s7-6.4 7-11c0-3.87-3.13-7-7-7z"
                fill="rgba(251,191,36,0.95)"
                stroke="rgba(255,255,255,0.9)"
                strokeWidth={1}
              />
              <circle cx="7" cy="7" r="2.4" fill="rgba(255,255,255,0.95)" className="rax-pending-pin-core" />
              <style>{`
                .rax-pending-pin-core {
                  transform-box: fill-box;
                  transform-origin: center;
                  animation: rax-pending-pulse 1.2s ease-in-out infinite;
                }
                @keyframes rax-pending-pulse {
                  0%, 100% { transform: scale(1); }
                  50% { transform: scale(1.42); }
                }
                @media (prefers-reduced-motion: reduce) {
                  .rax-pending-pin-core { animation: none; }
                }
              `}</style>
            </g>
          </Marker>
        )}
      </ComposableMap>

      {/* Mode badge — top left */}
      <div className="absolute top-3 left-3 pointer-events-none">
        <div
          className="px-2.5 py-1 rounded-md text-[10px] font-semibold flex items-center gap-1.5"
          style={{
            background: 'rgba(20,16,12,0.85)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(107,93,82,0.32)',
            color: isHeatMode ? 'rgba(239,68,68,0.95)' : 'rgba(180,163,145,0.85)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: isHeatMode ? '#ef4444' : '#7d8b6f' }}
          />
          {isHeatMode ? 'Heat Map' : 'Pin View'}
          <span style={{ color: 'rgba(180,163,145,0.5)', fontWeight: 500, marginLeft: 4 }}>
            {placedPins.length}{!isHeatMode && ` / ${HEAT_PIN_THRESHOLD}`}
          </span>
        </div>
      </div>

      {/* Hint — bottom left. Hidden while the confirmation panel is showing
          so the two pieces of guidance don't compete on narrow screens. */}
      {!pendingPin && (
        <div
          className="absolute bottom-12 left-3 pointer-events-none"
          style={{
            color: 'rgba(180,163,145,0.6)',
            fontSize: '10px',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          Click the map to mark a harvest
        </div>
      )}

      {/* Pending-pin confirmation panel. Spans the full width above the legend
          on narrow screens, anchored bottom-right on tablet+ to leave the map
          breathing room. */}
      {pendingPin && (
        <div className="absolute bottom-12 left-3 right-3 sm:left-auto sm:right-3 z-10">
          <div
            className="rounded-lg p-3 sm:min-w-[200px]"
            style={{
              background: 'rgba(20,16,12,0.98)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(107,93,82,0.32)',
            }}
          >
            <div
              className="text-xs font-semibold mb-2"
              style={{ color: 'rgba(245,235,220,0.95)', letterSpacing: '0.03em' }}
            >
              Add pin here?
            </div>
            <div
              className="font-mono mb-3"
              style={{ color: 'rgba(180,163,145,0.7)', fontSize: '11px' }}
            >
              {pendingPin.lat.toFixed(4)}, {pendingPin.lng.toFixed(4)}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleConfirmPin}
                className="flex-1 py-1.5 rounded-md font-medium transition-all hover:scale-[1.02]"
                style={{
                  background: 'rgba(251,191,36,0.95)',
                  color: '#1a1612',
                  fontSize: '11px',
                }}
              >
                Confirm
              </button>
              <button
                onClick={handleCancelPin}
                className="px-3 py-1.5 rounded-md font-medium transition-all hover:scale-[1.02]"
                style={{
                  background: 'rgba(107,93,82,0.3)',
                  color: 'rgba(245,235,220,0.8)',
                  fontSize: '11px',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pin legend — bottom bar */}
      <div
        className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-evenly py-2 pointer-events-none flex-wrap"
        style={{
          background: 'linear-gradient(145deg, rgba(18,14,11,0.96), rgba(28,22,17,0.94))',
          borderTop: '1px solid rgba(107,93,82,0.25)',
          boxShadow: 'inset 0 1px 0 rgba(107,93,82,0.12)',
        }}
      >
        {(Object.keys(LOCATION_TYPE_LABELS) as LocationType[]).map(type => (
          <div key={type} className="flex items-center gap-1.5">
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{
                backgroundColor: LOCATION_TYPE_COLORS[type],
                boxShadow: `0 0 4px ${LOCATION_TYPE_COLORS[type]}60`,
              }}
            />
            <span
              className="whitespace-nowrap"
              style={{
                fontSize: '9px',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: 'rgba(180,163,145,0.7)',
                fontWeight: 500,
              }}
            >
              {LOCATION_TYPE_LABELS[type]}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export { LOCATION_TYPE_COLORS, LOCATION_TYPE_LABELS }
