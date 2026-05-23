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

// CDN-hosted world country outlines (~80KB). We filter to North America below.
const WORLD_TOPO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

// ISO numeric codes for North American countries we want to render.
const NORTH_AMERICA_ISO_CODES = new Set([
  '840', // United States
  '124', // Canada
  '484', // Mexico
  '320', // Guatemala
  '084', // Belize
  '188', // Costa Rica
  '222', // El Salvador
  '340', // Honduras
  '558', // Nicaragua
  '591', // Panama
  '044', // Bahamas
  '192', // Cuba
  '214', // Dominican Republic
  '332', // Haiti
  '388', // Jamaica
  '630', // Puerto Rico
  '304', // Greenland
])

const MAP_COLORS = {
  background: '#1a1612',
  landFill: '#2d2520',
  landFillHover: '#3a3026',
  landStroke: '#6b5d52',
  ocean: '#0e0a07',
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
          scale: 520,
          center: [-95, 48],
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

        <Geographies geography={WORLD_TOPO_URL}>
          {({ geographies, projection }) => {
            projectionRef.current = projection as typeof projectionRef.current
            return geographies
              .filter(geo => NORTH_AMERICA_ISO_CODES.has(geo.id as string))
              .map(geo => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  style={{
                    default: {
                      fill: MAP_COLORS.landFill,
                      stroke: MAP_COLORS.landStroke,
                      strokeWidth: 0.5,
                      outline: 'none',
                    },
                    hover: {
                      fill: MAP_COLORS.landFillHover,
                      stroke: MAP_COLORS.landStroke,
                      strokeWidth: 0.5,
                      outline: 'none',
                      cursor: 'crosshair',
                    },
                    pressed: {
                      fill: MAP_COLORS.landFillHover,
                      outline: 'none',
                    },
                  }}
                />
              ))
          }}
        </Geographies>

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

        {/* Pending pin */}
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
              <circle cx="7" cy="7" r="2.4" fill="rgba(255,255,255,0.95)">
                <animate attributeName="r" values="2.4;3.4;2.4" dur="1.2s" repeatCount="indefinite" />
              </circle>
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

      {/* Hint — bottom left */}
      <div
        className="absolute bottom-12 left-3 pointer-events-none"
        style={{
          color: 'rgba(180,163,145,0.6)',
          fontSize: '10px',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
        }}
      >
        {pendingPin ? 'Confirm or cancel to place pin' : 'Click the map to mark a harvest'}
      </div>

      {/* Pending-pin confirmation panel */}
      {pendingPin && (
        <div className="absolute bottom-12 right-3 z-10">
          <div
            className="rounded-lg p-3"
            style={{
              background: 'rgba(20,16,12,0.98)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(107,93,82,0.32)',
              minWidth: '200px',
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
