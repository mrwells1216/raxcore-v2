'use client'

import { useState, useCallback, useMemo, useRef } from 'react'
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  ZoomableGroup,
} from 'react-simple-maps'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { MapPin, ZoomIn, ZoomOut, RotateCcw, X } from 'lucide-react'
import type { MapPin as MapPinType, LocationType } from '@/lib/types'

const US_TOPO_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json'

const STATE_CENTERS: Record<string, { lat: number; lng: number }> = {
  'Alabama': { lat: 32.806671, lng: -86.791130 },
  'Alaska': { lat: 61.370716, lng: -152.404419 },
  'Arizona': { lat: 33.729759, lng: -111.431221 },
  'Arkansas': { lat: 34.969704, lng: -92.373123 },
  'California': { lat: 36.116203, lng: -119.681564 },
  'Colorado': { lat: 39.059811, lng: -105.311104 },
  'Connecticut': { lat: 41.597782, lng: -72.755371 },
  'Delaware': { lat: 39.318523, lng: -75.507141 },
  'Florida': { lat: 27.766279, lng: -81.686783 },
  'Georgia': { lat: 33.040619, lng: -83.643074 },
  'Hawaii': { lat: 21.094318, lng: -157.498337 },
  'Idaho': { lat: 44.240459, lng: -114.478828 },
  'Illinois': { lat: 40.349457, lng: -88.986137 },
  'Indiana': { lat: 39.849426, lng: -86.258278 },
  'Iowa': { lat: 42.011539, lng: -93.210526 },
  'Kansas': { lat: 38.526600, lng: -96.726486 },
  'Kentucky': { lat: 37.668140, lng: -84.670067 },
  'Louisiana': { lat: 31.169546, lng: -91.867805 },
  'Maine': { lat: 44.693947, lng: -69.381927 },
  'Maryland': { lat: 39.063946, lng: -76.802101 },
  'Massachusetts': { lat: 42.230171, lng: -71.530106 },
  'Michigan': { lat: 43.326618, lng: -84.536095 },
  'Minnesota': { lat: 45.694454, lng: -93.900192 },
  'Mississippi': { lat: 32.741646, lng: -89.678696 },
  'Missouri': { lat: 38.456085, lng: -92.288368 },
  'Montana': { lat: 46.921925, lng: -110.454353 },
  'Nebraska': { lat: 41.125370, lng: -98.268082 },
  'Nevada': { lat: 38.313515, lng: -117.055374 },
  'New Hampshire': { lat: 43.452492, lng: -71.563896 },
  'New Jersey': { lat: 40.298904, lng: -74.521011 },
  'New Mexico': { lat: 34.840515, lng: -106.248482 },
  'New York': { lat: 42.165726, lng: -74.948051 },
  'North Carolina': { lat: 35.630066, lng: -79.806419 },
  'North Dakota': { lat: 47.528912, lng: -99.784012 },
  'Ohio': { lat: 40.388783, lng: -82.764915 },
  'Oklahoma': { lat: 35.565342, lng: -96.928917 },
  'Oregon': { lat: 44.572021, lng: -122.070938 },
  'Pennsylvania': { lat: 40.590752, lng: -77.209755 },
  'Rhode Island': { lat: 41.680893, lng: -71.511780 },
  'South Carolina': { lat: 33.856892, lng: -80.945007 },
  'South Dakota': { lat: 44.299782, lng: -99.438828 },
  'Tennessee': { lat: 35.747845, lng: -86.692345 },
  'Texas': { lat: 31.054487, lng: -97.563461 },
  'Utah': { lat: 40.150032, lng: -111.862434 },
  'Vermont': { lat: 44.045876, lng: -72.710686 },
  'Virginia': { lat: 37.769337, lng: -78.169968 },
  'Washington': { lat: 47.400902, lng: -121.490494 },
  'West Virginia': { lat: 38.491226, lng: -80.954453 },
  'Wisconsin': { lat: 44.268543, lng: -89.616508 },
  'Wyoming': { lat: 42.755966, lng: -107.302490 },
  'District of Columbia': { lat: 38.897438, lng: -77.026817 },
  'Puerto Rico': { lat: 18.220833, lng: -66.590149 },
}

interface MapViewerProps {
  pins: MapPinType[]
  center?: { lat: number; lng: number }
  zoom?: number
  onPinClick?: (pin: MapPinType) => void
  onMapClick?: (lat: number, lng: number) => void
  selectedPinId?: string
  showPropertyBoundaries?: boolean
}

const LOCATION_TYPE_COLORS: Record<LocationType, string> = {
  sighting: '#3b82f6',
  trailcam: '#8b5cf6',
  harvest: '#ef4444',
  shed: '#f59e0b',
  scoring_source: '#10b981',
  stand: '#6366f1',
  blind: '#8b5cf6',
  scrape: '#d97706',
  rub: '#ca8a04',
  food_plot: '#22c55e',
  bedding: '#a855f7',
  travel_corridor: '#64748b',
  unknown: '#9ca3af',
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

const MAP_COLORS = {
  background: '#1a1612',
  stateDefault: '#2d2520',
  stateHover: '#3d332a',
  stateFocused: '#4a3f35',
  stateBorder: '#6b5d52',
  stateBorderFocused: '#8b7d6b',
  landGradientStart: '#2a2318',
  landGradientEnd: '#3d3428',
}

export function MapViewer({ pins, onPinClick, onMapClick, selectedPinId }: MapViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // Always start (and reset) to the full US view; never allow it to drift
  const US_CENTER: [number, number] = [-98, 39]
  const [zoom, setZoom] = useState(1)
  const [center, setCenter] = useState<[number, number]>(US_CENTER)
  const [focusedState, setFocusedState] = useState<string | null>(null)
  const [hoveredState, setHoveredState] = useState<string | null>(null)
  // After zooming to a state the user must click a second time to place a pin
  const [readyForPin, setReadyForPin] = useState(false)
  const [clickPosition, setClickPosition] = useState<{ x: number; y: number } | null>(null)
  const [pendingPin, setPendingPin] = useState<{ lat: number; lng: number } | null>(null)

  const handleZoomIn = useCallback(() => {
    setZoom(z => Math.min(z * 1.5, 8))
  }, [])

  const handleZoomOut = useCallback(() => {
    setZoom(z => Math.max(z / 1.5, 1))
  }, [])

  const handleReset = useCallback(() => {
    setZoom(1)
    setCenter(US_CENTER)
    setFocusedState(null)
    setReadyForPin(false)
    setPendingPin(null)
    setClickPosition(null)
  }, [])

  // First click on a state: zoom to that state. Does NOT place a pin yet.
  const handleStateClick = useCallback((geo: any) => {
    const stateName: string = geo.properties.name
    const stateCenter = STATE_CENTERS[stateName]
    if (stateCenter) {
      setFocusedState(stateName)
      setCenter([stateCenter.lng, stateCenter.lat])
      setZoom(5)
      setReadyForPin(false) // arm — next click on the map body will place pin
      setPendingPin(null)
      setClickPosition(null)
    }
  }, [])

  // Second click: anywhere on the map after focusing a state creates the pending pin
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleMapAreaClick = useCallback((event: any) => {
    if (!focusedState || !onMapClick) return
    if (!readyForPin) {
      // The first "background" click after zooming just arms pin-placement mode
      setReadyForPin(true)
      return
    }
    const svg = event.currentTarget
    const svgRect = svg.getBoundingClientRect()
    const containerRect = containerRef.current?.getBoundingClientRect()
    const xInSvg = event.clientX - svgRect.left
    const yInSvg = event.clientY - svgRect.top
    const [centerLng, centerLat] = center
    const scale = zoom
    const lng = centerLng + ((xInSvg - svgRect.width / 2) / (svgRect.width / 2)) * (180 / scale)
    const lat = centerLat - ((yInSvg - svgRect.height / 2) / (svgRect.height / 2)) * (90 / scale)
    const relX = containerRect ? event.clientX - containerRect.left : xInSvg
    const relY = containerRect ? event.clientY - containerRect.top : yInSvg
    setClickPosition({ x: relX, y: relY })
    setPendingPin({ lat, lng })
  }, [focusedState, onMapClick, readyForPin, center, zoom])

  const handleConfirmPin = useCallback(() => {
    if (pendingPin && onMapClick) {
      onMapClick(pendingPin.lat, pendingPin.lng)
      setPendingPin(null)
      setClickPosition(null)
    }
  }, [pendingPin, onMapClick])

  const handleCancelPin = useCallback(() => {
    setPendingPin(null)
    setClickPosition(null)
  }, [])

  const getStateFill = useCallback((stateName: string) => {
    if (focusedState === stateName) return 'url(#landGradient)'
    if (hoveredState === stateName) return MAP_COLORS.stateHover
    return MAP_COLORS.stateDefault
  }, [focusedState, hoveredState])

  const visiblePins = useMemo(() => {
    if (!focusedState) return []
    return pins.filter(p => p.latitude != null && p.longitude != null)
  }, [pins, focusedState])

  // Instruction shown inside the state focus card — changes after first click arms pin mode
  const pinInstruction = !focusedState
    ? null
    : !readyForPin
      ? 'Click anywhere on the map to enter pin-placement mode'
      : 'Now click to place a pin'

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-[400px] rounded-lg overflow-hidden"
      style={{ backgroundColor: MAP_COLORS.background }}
    >
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <linearGradient id="landGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={MAP_COLORS.landGradientStart} />
            <stop offset="50%" stopColor={MAP_COLORS.landGradientEnd} />
            <stop offset="100%" stopColor={MAP_COLORS.landGradientStart} />
          </linearGradient>
        </defs>
      </svg>

      <ComposableMap
        projection="geoAlbersUsa"
        projectionConfig={{ scale: 1000 }}
        style={{ width: '100%', height: '100%' }}
        onClick={focusedState ? handleMapAreaClick : undefined}
      >
        <ZoomableGroup
          center={center}
          zoom={zoom}
          // Disable drag panning — position is controlled programmatically only
          // so the map cannot be dragged off the US view
          filterZoomEvent={() => false}
          minZoom={1}
          maxZoom={8}
        >
          <Geographies geography={US_TOPO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const stateName: string = geo.properties.name
                const isFocused = focusedState === stateName
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={getStateFill(stateName)}
                    stroke={isFocused ? MAP_COLORS.stateBorderFocused : MAP_COLORS.stateBorder}
                    strokeWidth={isFocused ? 1.5 : 0.5}
                    style={{
                      default: { outline: 'none', transition: 'all 0.2s ease-in-out' },
                      hover: {
                        fill: isFocused ? undefined : MAP_COLORS.stateHover,
                        outline: 'none',
                        cursor: 'pointer',
                      },
                      pressed: { fill: MAP_COLORS.stateFocused, outline: 'none' },
                    }}
                    onMouseEnter={() => setHoveredState(stateName)}
                    onMouseLeave={() => setHoveredState(null)}
                    onClick={() => handleStateClick(geo)}
                  />
                )
              })
            }
          </Geographies>

          {/* Existing location pins — these are safe because pin.latitude/longitude are persisted values */}
          {visiblePins.map((pin) => (
            <Marker
              key={pin.id}
              coordinates={[pin.longitude!, pin.latitude!] as [number, number]}
              onClick={(e) => { e.stopPropagation(); onPinClick?.(pin) }}
            >
              <g style={{ cursor: 'pointer' }} transform="translate(-12, -24)">
                <ellipse cx="12" cy="26" rx="4" ry="2" fill="rgba(0,0,0,0.3)" />
                <path
                  d="M12 0C7.58 0 4 3.58 4 8c0 5.25 8 16 8 16s8-10.75 8-16c0-4.42-3.58-8-8-8z"
                  fill={LOCATION_TYPE_COLORS[pin.location_type]}
                  stroke={selectedPinId === pin.id ? '#fff' : 'rgba(255,255,255,0.3)'}
                  strokeWidth={selectedPinId === pin.id ? 2 : 1}
                />
                <circle cx="12" cy="8" r="3" fill="rgba(255,255,255,0.9)" />
              </g>
            </Marker>
          ))}
        </ZoomableGroup>
      </ComposableMap>

      {/*
        PENDING PIN — rendered as a CSS-positioned div overlay, NOT as a <Marker>.

        react-simple-maps Marker internally calls useMapContext() which throws
        "non-iterable instance" the first render after a click because the
        ZoomableGroup projection context hasn't updated yet. Using a plain div
        positioned by click screen-coords avoids the crash entirely.
      */}
      {pendingPin && clickPosition && (
        <div
          aria-hidden="true"
          className="absolute pointer-events-none z-40"
          style={{
            left: clickPosition.x,
            top: clickPosition.y,
            transform: 'translate(-12px, -28px)',
          }}
        >
          <svg width="24" height="28" viewBox="0 0 24 24">
            <path
              d="M12 0C7.58 0 4 3.58 4 8c0 5.25 8 16 8 16s8-10.75 8-16c0-4.42-3.58-8-8-8z"
              fill="#10b981"
              stroke="#fff"
              strokeWidth={2}
              strokeDasharray="4,2"
              opacity={0.9}
            />
            <circle cx="12" cy="8" r="3" fill="#fff" />
          </svg>
        </div>
      )}

      {/* Zoom Controls */}
      <div className="absolute top-4 right-4 flex flex-col gap-2 z-50">
        <Button size="icon" variant="secondary" onClick={handleZoomIn} className="bg-card/95 backdrop-blur hover:bg-card">
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="secondary" onClick={handleZoomOut} className="bg-card/95 backdrop-blur hover:bg-card">
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="secondary" onClick={handleReset} className="bg-card/95 backdrop-blur hover:bg-card">
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>

      {/* State Focus Indicator */}
      {focusedState && (
        <div className="absolute top-4 left-4 z-50">
          <Card className="p-3 bg-card/95 backdrop-blur">
            <div className="flex items-center gap-3">
              <div>
                <div className="text-sm font-medium">{focusedState}</div>
                <div className={`text-xs transition-colors ${readyForPin ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                  {pinInstruction}
                </div>
              </div>
              <Button size="icon" variant="ghost" onClick={handleReset} className="h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Pin Placement Confirmation */}
      {pendingPin && clickPosition && (
        <div
          className="absolute z-[9999] pointer-events-auto"
          style={{
            left: Math.min(clickPosition.x + 16, (containerRef.current?.offsetWidth ?? 400) - 200),
            top: Math.max(clickPosition.y - 120, 8),
          }}
        >
          <Card className="p-3 bg-card/95 backdrop-blur shadow-xl border-2 border-primary/20">
            <div className="text-sm font-medium mb-2">Add pin here?</div>
            <div className="text-xs text-muted-foreground mb-3 font-mono">
              {pendingPin.lat.toFixed(5)}, {pendingPin.lng.toFixed(5)}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleConfirmPin} className="flex-1">Confirm</Button>
              <Button size="sm" variant="outline" onClick={handleCancelPin}>Cancel</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-50">
        <Card className="p-3 bg-card/95 backdrop-blur">
          <div className="text-xs font-medium mb-2">Location Types</div>
          <div className="grid grid-cols-2 gap-1">
            {(['harvest', 'trailcam', 'sighting', 'stand'] as LocationType[]).map(type => (
              <div key={type} className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: LOCATION_TYPE_COLORS[type] }} />
                <span className="text-xs">{LOCATION_TYPE_LABELS[type]}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Instructions when empty */}
      {!focusedState && pins.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40">
          <Card className="p-4 bg-card/95 backdrop-blur">
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-5 w-5" />
              <span>Click on a state to focus and add pins</span>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

export { LOCATION_TYPE_COLORS, LOCATION_TYPE_LABELS }
