'use client'

/**

- components/map/map-viewer.tsx
- 
- RAX CORE — Field Intelligence Map
- 
- Replaces the previous react-simple-maps SVG viewer with a full
- Leaflet-based map supporting:
- - Real satellite / topo / terrain tile layers  (ESRI + OpenTopoMap — free, no API key)
- - Hillshade / slope-shadow elevation overlays  (ESRI — free, no API key)
- - Live elevation readout on click              (USGS 3DEP Point Query — free, no API key)
- - Deer terrain intelligence hints keyed to elevation zone
- - All existing pin types, colors, and placement workflow
- 
- ─── ARCHITECTURE NOTES FOR CLAUDE CODE ──────────────────────────────────────
- 
- 1. LEAFLET IS DYNAMICALLY IMPORTED inside useEffect.
- Leaflet requires `window` and breaks SSR. map/page.tsx wraps this
- component in next/dynamic with { ssr: false }, so Leaflet never runs
- server-side. Do NOT add a top-level `import L from 'leaflet'`.
- 
- 1. react-leaflet IS NOT INSTALLED. All Leaflet usage is imperative.
- Do not add react-leaflet without confirming React 19 compatibility.
- 
- 1. Mutable Leaflet objects (map, layers, markers) live in useRefs typed as
- `unknown`. They are cast to the correct Leaflet types inside the dynamic
- import block where those types are available.
- 
- 1. EXTENSION POINTS are marked: // ── EXTEND ──
- Look for those comments when adding new layers, overlays, or behaviors.
- 
- 1. All tuneable values (URLs, opacity, elevation thresholds, deer hints)
- are in SECTION 2 — CONFIG. Change them there, not inline.
- 
- ─── PROPS CONTRACT (map/page.tsx depends on this exact shape) ───────────────
- pins          MapPinType[]
- onPinClick    (pin: MapPinType) => void
- onMapClick    (lat: number, lng: number) => void
- selectedPinId string | undefined
- 
- ─── EXPORTS (map/page.tsx imports both — do not rename) ────────────────────
- MapViewer               named export
- LOCATION_TYPE_COLORS    Record<LocationType, string>
- LOCATION_TYPE_LABELS    Record<LocationType, string>
  */

import { useEffect, useRef, useState, useCallback } from 'react'
import type { MapPin as MapPinType, LocationType } from '@/lib/types'

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface MapViewerProps {
pins: MapPinType[]
center?: { lat: number; lng: number }
zoom?: number
onPinClick?: (pin: MapPinType) => void
onMapClick?: (lat: number, lng: number) => void
selectedPinId?: string
showPropertyBoundaries?: boolean
}

export type LayerMode = 'satellite' | 'satellite_labels' | 'topo' | 'terrain' | 'elevation_heat'
export type OverlayMode = 'none' | 'hillshade' | 'slope'

interface ElevationState {
elevationFt: number
elevationM:  number
lat:         number
lng:         number
loading:     boolean
error:       boolean
}

interface TerrainZone {
minElFt: number
maxElFt: number
label:   string
hint:    string
color:   string
}

interface TileLayerConfig {
url:         string
attribution: string
maxZoom:     number
label:       string
labelsUrl?:  string
}

interface ElevationLayerConfig {
url:         string
attribution: string
label:       string
opacity:     number
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const MAP_DEFAULTS = {
center:  [39, -98] as [number, number],
zoom:    5,
minZoom: 3,
maxZoom: 19,
} as const

// ── EXTEND ── Add new base layers here + to LayerMode union above
const TILE_LAYERS: Record<LayerMode, TileLayerConfig> = {
satellite: {
url:         'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
attribution: '© <a href="https://www.esri.com">Esri</a> World Imagery',
maxZoom:     19,
label:       'Satellite',
},
satellite_labels: {
url:         'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
attribution: '© <a href="https://www.esri.com">Esri</a> World Imagery',
maxZoom:     19,
label:       'Satellite + Labels',
labelsUrl:   'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
},
topo: {
url:         'https://tile.opentopomap.org/{z}/{x}/{y}.png',
attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
maxZoom:     17,
label:       'Topo',
},
terrain: {
url:         'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}',
attribution: '© <a href="https://www.esri.com">Esri</a> World Terrain',
maxZoom:     13,
label:       'Terrain',
},
elevation_heat: {
// ESRI World Physical Map — true hypsometric tint (green lowlands → brown highlands → white peaks)
// Free, no API key. maxZoom 8 is correct — tiles only exist to zoom 8.
// Combine with Hillshade overlay for best visual depth.
url:         'https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}',
attribution: '© <a href="https://www.esri.com">Esri</a>, US National Park Service',
maxZoom:     8,
label:       'Elevation Heat',
},
}

// ── EXTEND ── Add new overlays here + to OverlayMode union above
const OVERLAY_LAYERS: Record<Exclude<OverlayMode, 'none'>, ElevationLayerConfig> = {
hillshade: {
url:         'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
attribution: '© Esri World Hillshade',
label:       'Hillshade',
opacity:     0.45,
},
slope: {
url:         'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade_Dark/MapServer/tile/{z}/{y}/{x}',
attribution: '© Esri Hillshade Dark',
label:       'Slope Shadow',
opacity:     0.50,
},
}

// ── EXTEND ── Adjust ranges or add zones. Keep ranges contiguous (no gaps/overlaps).
const TERRAIN_ZONES: TerrainZone[] = [
{ minElFt: 0,    maxElFt: 200,      label: 'Bottom / Creek',  hint: 'Primary travel & water. Bucks use creek bottoms at night.',                         color: '#2e7a5e' },
{ minElFt: 200,  maxElFt: 600,      label: 'Low Bench',       hint: 'Primary feeding zones. Food plots and ag field edges thrive here.',                  color: '#3a6e35' },
{ minElFt: 600,  maxElFt: 1200,     label: 'Mid Slope',       hint: 'Primary travel corridors. Set stands on converging draws.',                          color: '#8a6a2a' },
{ minElFt: 1200, maxElFt: 2000,     label: 'Upper Bench',     hint: 'Bedding on north-facing slopes. Look for thermal cover.',                            color: '#6b5b93' },
{ minElFt: 2000, maxElFt: 3500,     label: 'Ridgeline',       hint: 'Saddles between ridges = major rut movement highways.',                              color: '#7a5030' },
{ minElFt: 3500, maxElFt: Infinity, label: 'High Country',    hint: 'Escape cover. Bucks retreat here under heavy post-season pressure.',                 color: '#4a4f58' },
]

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — PIN COLORS + LABELS  (exported — map/page.tsx imports these)
// ─────────────────────────────────────────────────────────────────────────────

// ── EXTEND ── Add new LocationType values here AND in lib/types.ts
export const LOCATION_TYPE_COLORS: Record<LocationType, string> = {
sighting:        '#4a7fa5',
trailcam:        '#6b5b93',
harvest:         '#8b3a3a',
shed:            '#8a6a2a',
scoring_source:  '#2e7a5e',
stand:           '#3a4a8b',
blind:           '#5a4a7a',
scrape:          '#7a5030',
rub:             '#6b5520',
food_plot:       '#3a6e35',
bedding:         '#6b3a7a',
travel_corridor: '#445060',
unknown:         '#4a4f58',
}

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
sighting:        'Sighting',
trailcam:        'Trail Cam',
harvest:         'Harvest',
shed:            'Shed',
scoring_source:  'Scoring Source',
stand:           'Stand',
blind:           'Blind',
scrape:          'Scrape',
rub:             'Rub',
food_plot:       'Food Plot',
bedding:         'Bedding',
travel_corridor: 'Travel Corridor',
unknown:         'Unknown',
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — PURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getTerrainZone(elevFt: number): TerrainZone {
return (
TERRAIN_ZONES.find(z => elevFt >= z.minElFt && elevFt < z.maxElFt) ??
TERRAIN_ZONES[TERRAIN_ZONES.length - 1]
)
}

function buildPinSvg(color: string, selected: boolean, size = 28): string {
const stroke = selected ? '#ffffff' : 'rgba(255,255,255,0.35)'
const sw     = selected ? 2 : 1
const h      = Math.round(size * 1.25)
return (
`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${h}" viewBox="0 0 24 30">` +
`<ellipse cx="12" cy="28" rx="4" ry="2" fill="rgba(0,0,0,0.35)"/>` +
`<path d="M12 0C7.58 0 4 3.58 4 8c0 5.25 8 16 8 16s8-10.75 8-16c0-4.42-3.58-8-8-8z"` +
` fill="${color}" stroke="${stroke}" stroke-width="${sw}"/>` +
`<circle cx="12" cy="8" r="3" fill="rgba(255,255,255,0.9)"/>` +
`</svg>`
)
}

// ── EXTEND ── To swap elevation providers, replace only this function.
// Keep return shape { elevFt, elevM } | null identical.
async function fetchElevation(lat: number, lng: number): Promise<{ elevFt: number; elevM: number } | null> {
try {
const url = `https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&wkid=4326&includeDate=false`
const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
if (!res.ok) return null
const data: unknown = await res.json()
const meters =
data !== null &&
typeof data === 'object' &&
'value' in data &&
typeof (data as Record<string, unknown>).value === 'number'
? ((data as Record<string, unknown>).value as number)
: null
if (meters === null || meters < -500) return null
return { elevM: Math.round(meters), elevFt: Math.round(meters * 3.28084) }
} catch {
return null
}
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function MapViewer({ pins, onPinClick, onMapClick, selectedPinId }: MapViewerProps) {
const containerRef   = useRef<HTMLDivElement>(null)
const mapRef         = useRef<unknown>(null)
const baseTileRef    = useRef<unknown>(null)
const labelsLayerRef = useRef<unknown>(null)
const elevLayerRef   = useRef<unknown>(null)
const pinGroupRef    = useRef<unknown>(null)
const pendingPinRef  = useRef<unknown>(null)

const [layerMode,   setLayerMode]   = useState<LayerMode>('satellite')
const [overlayMode, setOverlayMode] = useState<OverlayMode>('hillshade')
const [elevation,   setElevation]   = useState<ElevationState | null>(null)
const [pendingPin,  setPendingPin]  = useState<{ lat: number; lng: number } | null>(null)
const [mapReady,    setMapReady]    = useState(false)
const [showLayers,  setShowLayers]  = useState(false)

const terrainZone =
elevation && !elevation.loading && !elevation.error
? getTerrainZone(elevation.elevationFt)
: null

// ── 5.1 Initialize Leaflet once on mount ─────────────────────────────────
useEffect(() => {
if (!containerRef.current || mapRef.current) return
let cancelled = false

import('leaflet').then((L) => {
  if (cancelled || !containerRef.current || mapRef.current) return
  
  // Check if container already has a map (React Strict Mode protection)
  if ((containerRef.current as HTMLElement & { _leaflet_id?: number })._leaflet_id) return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (L.Icon.Default.prototype as any)._getIconUrl
  L.Icon.Default.mergeOptions({
    iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  })

  const map = L.map(containerRef.current!, {
    center:       MAP_DEFAULTS.center,
    zoom:         MAP_DEFAULTS.zoom,
    minZoom:      MAP_DEFAULTS.minZoom,
    maxZoom:      MAP_DEFAULTS.maxZoom,
    zoomControl:  false,
    attributionControl: true,
  })
  map.attributionControl.setPrefix('')

  const baseTile = L.tileLayer(TILE_LAYERS.satellite.url, {
    attribution: TILE_LAYERS.satellite.attribution,
    maxZoom:     TILE_LAYERS.satellite.maxZoom,
  }).addTo(map)

  const labelsLayer = L.tileLayer(TILE_LAYERS.satellite_labels.labelsUrl!, {
    maxZoom: 19, opacity: 1, zIndex: 5,
  })

  const elevLayer = L.tileLayer(OVERLAY_LAYERS.hillshade.url, {
    attribution: OVERLAY_LAYERS.hillshade.attribution,
    maxZoom:     19,
    opacity:     OVERLAY_LAYERS.hillshade.opacity,
    zIndex:      4,
  }).addTo(map)

  const pinGroup = L.layerGroup().addTo(map)

  mapRef.current         = map
  baseTileRef.current    = baseTile
  labelsLayerRef.current = labelsLayer
  elevLayerRef.current   = elevLayer
  pinGroupRef.current    = pinGroup
  setMapReady(true)

  map.on('click', async (e: L.LeafletMouseEvent) => {
    const { lat, lng } = e.latlng
    setPendingPin({ lat, lng })

    if (pendingPinRef.current) {
      ;(pendingPinRef.current as L.Marker).remove()
      pendingPinRef.current = null
    }

    const pendingIcon = L.divIcon({
      html: `<div style="animation:raxPendingPulse 0.8s ease-in-out infinite alternate">${buildPinSvg('#f59e0b', false, 32)}</div>`,
      iconSize: [32, 40], iconAnchor: [16, 40], className: '',
    })
    pendingPinRef.current = L.marker([lat, lng], {
      icon: pendingIcon, zIndexOffset: 1000,
    }).addTo(map)

    setElevation({ elevationFt: 0, elevationM: 0, lat, lng, loading: true, error: false })
    const result = await fetchElevation(lat, lng)
    if (cancelled) return
    if (result) {
      setElevation({ elevationFt: result.elevFt, elevationM: result.elevM, lat, lng, loading: false, error: false })
    } else {
      setElevation(prev => prev ? { ...prev, loading: false, error: true } : null)
    }
  })
})

  return () => {
    cancelled = true
    if (mapRef.current) {
      ;(mapRef.current as import('leaflet').Map).remove()
      mapRef.current = baseTileRef.current = labelsLayerRef.current =
        elevLayerRef.current = pinGroupRef.current = pendingPinRef.current = null
    }
  }
}, [])

// ── 5.2 Sync base tile layer ──────────────────────────────────────────────
useEffect(() => {
if (!mapReady || !mapRef.current) return
import('leaflet').then(() => {
const map    = mapRef.current    as import('leaflet').Map
const tile   = baseTileRef.current   as import('leaflet').TileLayer
const labels = labelsLayerRef.current as import('leaflet').TileLayer
const cfg    = TILE_LAYERS[layerMode]
tile.setUrl(cfg.url)
tile.options.maxZoom = cfg.maxZoom
const needLabels = layerMode === 'satellite_labels'
if (needLabels  && !map.hasLayer(labels)) labels.addTo(map)
if (!needLabels &&  map.hasLayer(labels)) labels.remove()
})
}, [layerMode, mapReady])

// ── 5.3 Sync elevation overlay ────────────────────────────────────────────
useEffect(() => {
if (!mapReady || !mapRef.current) return
import('leaflet').then(() => {
const map       = mapRef.current       as import('leaflet').Map
const elevLayer = elevLayerRef.current as import('leaflet').TileLayer
if (overlayMode === 'none') {
if (map.hasLayer(elevLayer)) elevLayer.remove()
return
}
const cfg = OVERLAY_LAYERS[overlayMode]
elevLayer.setUrl(cfg.url)
elevLayer.setOpacity(cfg.opacity)
if (!map.hasLayer(elevLayer)) elevLayer.addTo(map)
})
}, [overlayMode, mapReady])

// ── 5.4 Sync saved pins ───────────────────────────────────────────────────
useEffect(() => {
if (!mapReady || !pinGroupRef.current) return
import('leaflet').then((L) => {
const group = pinGroupRef.current as import('leaflet').LayerGroup
group.clearLayers()
for (const pin of pins) {
if (pin.latitude == null || pin.longitude == null) continue
const color      = LOCATION_TYPE_COLORS[pin.location_type] ?? '#4a4f58'
const isSelected = pin.id === selectedPinId
const icon = L.divIcon({
html:       buildPinSvg(color, isSelected),
iconSize:   [28, 35],
iconAnchor: [14, 35],
className:  '',
})
const marker = L.marker([pin.latitude, pin.longitude], {
icon, zIndexOffset: isSelected ? 500 : 0,
})
marker.on('click', (e: L.LeafletMouseEvent) => {
e.originalEvent?.stopPropagation()
onPinClick?.(pin)
})
marker.bindTooltip(
`<div style="font-size:12px;font-weight:600;color:#1a1a1a">${pin.label ?? LOCATION_TYPE_LABELS[pin.location_type]}</div>`,
{ direction: 'top', offset: [0, -38], className: 'rax-map-tooltip' },
)
group.addLayer(marker)
}
})
}, [pins, selectedPinId, onPinClick, mapReady])

// ── 5.5 Pin placement ─────────────────────────────────────────────────────
const handleConfirmPin = useCallback(() => {
if (!pendingPin) return
onMapClick?.(pendingPin.lat, pendingPin.lng)
if (pendingPinRef.current) {
;(pendingPinRef.current as import('leaflet').Marker).remove()
pendingPinRef.current = null
}
setPendingPin(null)
}, [pendingPin, onMapClick])

const handleCancelPin = useCallback(() => {
if (pendingPinRef.current) {
;(pendingPinRef.current as import('leaflet').Marker).remove()
pendingPinRef.current = null
}
setPendingPin(null)
setElevation(null)
}, [])

const zoomIn    = useCallback(() => (mapRef.current as import('leaflet').Map | null)?.zoomIn(), [])
const zoomOut   = useCallback(() => (mapRef.current as import('leaflet').Map | null)?.zoomOut(), [])
const resetView = useCallback(() => (mapRef.current as import('leaflet').Map | null)?.setView(MAP_DEFAULTS.center, MAP_DEFAULTS.zoom), [])

// ─────────────────────────────────────────────────────────────────────────
// SECTION 6 — RENDER
// ─────────────────────────────────────────────────────────────────────────

return (
<div className="relative w-full h-full min-h-[400px] rounded-lg overflow-hidden bg-[#1a1612]">

  {/* eslint-disable-next-line react/no-danger */}
  <style dangerouslySetInnerHTML={{ __html: LEAFLET_INLINE_CSS }} />
  <div ref={containerRef} className="absolute inset-0" style={{ zIndex: 1 }} />

  {/* ── Layer switcher (top-left) */}
  <div className="absolute top-4 left-4 z-[500] flex flex-col gap-2">
    <button
      onClick={() => setShowLayers(p => !p)}
      className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold uppercase transition-all duration-150"
      style={showLayers ? STYLES.layerBtnActive : STYLES.layerBtn}
    >
      <LayerIcon />
      Layers
    </button>

    {showLayers && (
      <div className="rounded-xl p-3 flex flex-col gap-3 min-w-[215px]" style={STYLES.panel}>
        <div>
          <SectionLabel>Base Layer</SectionLabel>
          <div className="flex flex-col gap-1">
            {(Object.entries(TILE_LAYERS) as [LayerMode, TileLayerConfig][]).map(([key, cfg]) => (
              <LayerButton key={key} active={layerMode === key} onClick={() => setLayerMode(key)} accent="amber">
                {cfg.label}
              </LayerButton>
            ))}
          </div>
        </div>
        <Divider />
        <div>
          <SectionLabel>Elevation Overlay</SectionLabel>
          <div className="flex flex-col gap-1">
            {([['none', 'Off'], ['hillshade', 'Hillshade'], ['slope', 'Slope Shadow']] as [OverlayMode, string][]).map(([key, label]) => (
              <LayerButton key={key} active={overlayMode === key} onClick={() => setOverlayMode(key)} accent="bronze">
                {label}
              </LayerButton>
            ))}
          </div>
        </div>
        <Divider />
        <p style={{ fontSize: '9px', color: 'rgba(107,93,82,0.65)', lineHeight: 1.5 }}>
          Hillshade reveals valleys, ridges, and saddles — key terrain features for deer movement.
        </p>
      </div>
    )}
  </div>

  {/* ── Zoom controls (top-right) */}
  <div className="absolute top-4 right-4 z-[500] flex flex-col gap-1">
    <ZoomBtn title="Zoom in"    onClick={zoomIn}>+</ZoomBtn>
    <ZoomBtn title="Zoom out"   onClick={zoomOut}>−</ZoomBtn>
    <ZoomBtn title="Reset view" onClick={resetView}>⌖</ZoomBtn>
  </div>

  {/* ── Terrain intelligence (bottom-left) */}
  {elevation && (
    <div className="absolute bottom-20 left-4 z-[500] rounded-xl overflow-hidden min-w-[220px] max-w-[265px]" style={STYLES.panel}>
      <PanelHeader icon={<ElevIcon />} label="Terrain Intel" />
      <div className="px-3 py-3 flex flex-col gap-2.5">
        {elevation.loading ? (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'rgba(251,191,36,0.55)' }} />
            <span className="text-xs" style={{ color: 'rgba(107,93,82,0.75)' }}>Fetching elevation…</span>
          </div>
        ) : elevation.error ? (
          <p className="text-xs" style={{ color: 'rgba(139,90,43,0.75)' }}>Elevation unavailable for this area</p>
        ) : (
          <>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-bold tabular-nums" style={{ color: 'rgba(251,191,36,0.95)', lineHeight: 1 }}>
                {elevation.elevationFt.toLocaleString()}
              </span>
              <span className="text-xs pb-0.5" style={{ color: 'rgba(180,163,145,0.5)' }}>ft</span>
              <span className="text-xs pb-0.5" style={{ color: 'rgba(107,93,82,0.55)' }}>({elevation.elevationM.toLocaleString()} m)</span>
            </div>
            <div className="font-mono text-[10px]" style={{ color: 'rgba(107,93,82,0.65)' }}>
              {elevation.lat.toFixed(5)}, {elevation.lng.toFixed(5)}
            </div>
            {terrainZone && (
              <div className="rounded-lg px-2.5 py-2" style={{ background: `${terrainZone.color}16`, border: `1px solid ${terrainZone.color}38` }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: terrainZone.color, boxShadow: `0 0 6px ${terrainZone.color}80` }} />
                  <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: terrainZone.color }}>{terrainZone.label}</span>
                </div>
                <p className="text-[10px] leading-relaxed" style={{ color: 'rgba(180,163,145,0.72)' }}>{terrainZone.hint}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )}

  {/* ── Pending pin confirmation (bottom-right) */}
  {pendingPin && !elevation?.loading && (
    <div className="absolute bottom-20 right-4 z-[500] rounded-xl overflow-hidden min-w-[190px]" style={STYLES.panel}>
      <PanelHeader icon={<PinIcon />} label="Drop pin here?" accentAmber />
      <div className="px-3 py-3 flex flex-col gap-2">
        <div className="font-mono text-[10px]" style={{ color: 'rgba(107,93,82,0.65)' }}>
          {pendingPin.lat.toFixed(5)}, {pendingPin.lng.toFixed(5)}
        </div>
        {terrainZone && elevation && !elevation.error && (
          <div className="text-[10px]" style={{ color: 'rgba(180,163,145,0.55)' }}>
            {terrainZone.label} · {elevation.elevationFt.toLocaleString()} ft
          </div>
        )}
        <div className="flex gap-2 mt-1">
          <button onClick={handleConfirmPin} style={STYLES.confirmBtn}>Confirm</button>
          <button onClick={handleCancelPin}  style={STYLES.cancelBtn}>Cancel</button>
        </div>
      </div>
    </div>
  )}

  {/* ── Pin legend (bottom bar) */}
  <div
    className="absolute bottom-0 left-0 right-0 z-[500] flex items-center justify-evenly py-2.5 flex-wrap gap-y-1 pointer-events-none"
    style={{ background: 'linear-gradient(145deg, rgba(18,14,11,0.96), rgba(28,22,17,0.94))', borderTop: '1px solid rgba(107,93,82,0.25)' }}
  >
    {(Object.keys(LOCATION_TYPE_LABELS) as LocationType[]).map(type => (
      <div key={type} className="flex items-center gap-1.5">
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: LOCATION_TYPE_COLORS[type], boxShadow: `0 0 4px ${LOCATION_TYPE_COLORS[type]}60` }} />
        <span style={{ fontSize: '9px', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'rgba(180,163,145,0.75)', fontWeight: 500, whiteSpace: 'nowrap' }}>
          {LOCATION_TYPE_LABELS[type]}
        </span>
      </div>
    ))}
  </div>
</div>

)
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
return <div className="text-[9px] font-bold uppercase tracking-[0.12em] mb-2" style={{ color: 'rgba(180,163,145,0.45)' }}>{children}</div>
}

function Divider() {
return <div style={{ height: 1, background: 'rgba(107,93,82,0.22)' }} />
}

function PanelHeader({ icon, label, accentAmber }: { icon: React.ReactNode; label: string; accentAmber?: boolean }) {
return (
<div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(107,93,82,0.2)', background: accentAmber ? 'rgba(251,191,36,0.05)' : 'rgba(107,93,82,0.07)' }}>
{icon}
<span className="text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: accentAmber ? 'rgba(251,191,36,0.65)' : 'rgba(180,163,145,0.55)' }}>{label}</span>
</div>
)
}

function LayerButton({ active, onClick, children, accent }: { active: boolean; onClick: () => void; children: React.ReactNode; accent: 'amber' | 'bronze' }) {
const isAmber = accent === 'amber'
return (
<button onClick={onClick} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-xs transition-all duration-100" style={{
background: active ? (isAmber ? 'rgba(251,191,36,0.1)' : 'rgba(139,90,43,0.14)') : 'transparent',
border:     active ? (isAmber ? '1px solid rgba(251,191,36,0.28)' : '1px solid rgba(139,90,43,0.35)') : '1px solid transparent',
color:      active ? (isAmber ? 'rgba(251,191,36,0.95)' : 'rgba(210,170,110,0.95)') : 'rgba(180,163,145,0.7)',
}}>
<span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: active ? (isAmber ? 'rgba(251,191,36,0.9)' : 'rgba(139,90,43,0.9)') : 'rgba(107,93,82,0.45)' }} />
{children}
</button>
)
}

function ZoomBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
return <button title={title} onClick={onClick} style={STYLES.zoomBtn}>{children}</button>
}

function LayerIcon() {
return (
<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
<polygon points="12 2 2 7 12 12 22 7 12 2"/>
<polyline points="2 17 12 22 22 17"/>
<polyline points="2 12 12 17 22 12"/>
</svg>
)
}
function ElevIcon() {
return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(210,170,110,0.75)" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
}
function PinIcon() {
return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(251,191,36,0.65)" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — STYLES
// ─────────────────────────────────────────────────────────────────────────────

const PANEL_BASE: React.CSSProperties = {
background:     'linear-gradient(145deg, rgba(20,16,12,0.98), rgba(32,26,20,0.96))',
border:         '1px solid rgba(107,93,82,0.32)',
boxShadow:      '0 8px 32px rgba(0,0,0,0.65)',
backdropFilter: 'blur(12px)',
animation:      'raxFadeUp 0.15s ease-out',
}

const STYLES = {
panel: PANEL_BASE,
layerBtn: {
background: 'linear-gradient(145deg, rgba(26,22,18,0.96), rgba(40,34,28,0.92))',
border: '1px solid rgba(107,93,82,0.38)', color: 'rgba(180,163,145,0.82)',
boxShadow: '0 4px 16px rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', letterSpacing: '0.08em',
} as React.CSSProperties,
layerBtnActive: {
background: 'rgba(251,191,36,0.14)', border: '1px solid rgba(251,191,36,0.45)',
color: 'rgba(251,191,36,1)', boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
backdropFilter: 'blur(8px)', letterSpacing: '0.08em',
} as React.CSSProperties,
zoomBtn: {
width: '36px', height: '36px', display: 'flex', alignItems: 'center',
justifyContent: 'center', borderRadius: '8px', fontSize: '16px', fontWeight: 700,
cursor: 'pointer', background: 'linear-gradient(145deg, rgba(26,22,18,0.96), rgba(40,34,28,0.92))',
border: '1px solid rgba(107,93,82,0.38)', color: 'rgba(180,163,145,0.82)',
boxShadow: '0 4px 16px rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', transition: 'all 0.1s',
} as React.CSSProperties,
confirmBtn: {
flex: 1, padding: '6px 0', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
cursor: 'pointer', background: 'rgba(251,191,36,0.13)', border: '1px solid rgba(251,191,36,0.38)',
color: 'rgba(251,191,36,0.95)', transition: 'all 0.1s',
} as React.CSSProperties,
cancelBtn: {
flex: 1, padding: '6px 0', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
cursor: 'pointer', background: 'transparent', border: '1px solid rgba(107,93,82,0.32)',
color: 'rgba(107,93,82,0.78)', transition: 'all 0.1s',
} as React.CSSProperties,
} as const

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — LEAFLET CSS (inline — do not move to globals.css)
// ─────────────────────────────────────────────────────────────────────────────

const LEAFLET_INLINE_CSS = `.leaflet-container { background: #1a1612 !important; font-family: inherit; } .leaflet-pane, .leaflet-tile, .leaflet-marker-icon, .leaflet-marker-shadow, .leaflet-tile-container, .leaflet-map-pane svg, .leaflet-map-pane canvas, .leaflet-zoom-box, .leaflet-image-layer, .leaflet-layer { position: absolute; left: 0; top: 0; } .leaflet-container { overflow: hidden; } .leaflet-tile, .leaflet-marker-icon, .leaflet-marker-shadow { -webkit-user-select: none; user-select: none; -webkit-user-drag: none; } .leaflet-tile-pane { z-index: 2; } .leaflet-overlay-pane { z-index: 4; } .leaflet-shadow-pane { z-index: 5; } .leaflet-marker-pane { z-index: 6; } .leaflet-tooltip-pane { z-index: 650; } .leaflet-popup-pane { z-index: 700; } .leaflet-map-pane canvas { z-index: 1; } .leaflet-map-pane svg { z-index: 2; } .leaflet-control { position: relative; z-index: 800; pointer-events: visiblePainted; pointer-events: auto; } .leaflet-top, .leaflet-bottom { position: absolute; z-index: 1000; pointer-events: none; } .leaflet-top { top: 0; } .leaflet-right { right: 0; } .leaflet-bottom { bottom: 0; } .leaflet-left { left: 0; } .leaflet-control { float: left; clear: both; } .leaflet-right .leaflet-control { float: right; } .leaflet-top .leaflet-control { margin-top: 10px; } .leaflet-bottom .leaflet-control { margin-bottom: 10px; } .leaflet-left .leaflet-control { margin-left: 10px; } .leaflet-right .leaflet-control { margin-right: 10px; } .leaflet-fade-anim .leaflet-popup { opacity: 0; transition: opacity 0.2s linear; } .leaflet-fade-anim .leaflet-map-pane .leaflet-popup { opacity: 1; } .leaflet-zoom-animated { transform-origin: 0 0; } .leaflet-zoom-anim .leaflet-zoom-animated { transition: transform 0.25s cubic-bezier(0,0,0.25,1); } .leaflet-zoom-anim .leaflet-tile, .leaflet-pan-anim .leaflet-tile { transition: none; } .leaflet-interactive { cursor: pointer; } .leaflet-grab { cursor: grab; } .leaflet-dragging .leaflet-grab { cursor: grabbing; } .leaflet-marker-icon, .leaflet-marker-shadow, .leaflet-image-layer, .leaflet-pane > svg path, .leaflet-tile-container { pointer-events: none; } .leaflet-marker-icon.leaflet-interactive, .leaflet-pane > svg path.leaflet-interactive { pointer-events: auto; } .leaflet-attribution-flag { display: none !important; } .leaflet-control-attribution { font-size: 9px !important; background: rgba(0,0,0,0.52) !important; color: rgba(180,163,145,0.65) !important; backdrop-filter: blur(4px); border-radius: 4px 0 0 0; padding: 2px 6px !important; } .leaflet-control-attribution a { color: rgba(180,163,145,0.8) !important; } .rax-map-tooltip { background: rgba(255,255,255,0.95) !important; border: 1px solid rgba(0,0,0,0.1) !important; border-radius: 6px !important; box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important; padding: 4px 8px !important; } .rax-map-tooltip::before { border-top-color: rgba(255,255,255,0.95) !important; } @keyframes raxPendingPulse { from { opacity: 0.65; transform: scale(0.93); } to { opacity: 1; transform: scale(1.06); } } @keyframes raxFadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`
