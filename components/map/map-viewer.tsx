'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
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

// Deer terrain zones
interface TerrainZone {
  name: string
  hint: string
  color: string
}

function getTerrainZone(elevationFeet: number): TerrainZone {
  if (elevationFeet < 200) {
    return { name: 'Bottom / Creek', hint: 'Primary travel & water. Bucks use creek bottoms at night.', color: '#3b82f6' }
  } else if (elevationFeet < 600) {
    return { name: 'Low Bench', hint: 'Primary feeding zones. Food plots and ag field edges thrive here.', color: '#22c55e' }
  } else if (elevationFeet < 1200) {
    return { name: 'Mid Slope', hint: 'Primary travel corridors. Set stands on converging draws.', color: '#eab308' }
  } else if (elevationFeet < 2000) {
    return { name: 'Upper Bench', hint: 'Bedding on north-facing slopes. Look for thermal cover.', color: '#f97316' }
  } else if (elevationFeet < 3500) {
    return { name: 'Ridgeline', hint: 'Saddles between ridges = major rut movement highways.', color: '#ef4444' }
  } else {
    return { name: 'High Country', hint: 'Escape cover. Bucks retreat here under heavy post-season pressure.', color: '#8b5cf6' }
  }
}

// Base layer URLs
const BASE_LAYERS = {
  satellite: {
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'ESRI World Imagery',
  },
  satelliteLabels: {
    name: 'Satellite + Labels',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    labelsUrl: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    attribution: 'ESRI World Imagery + Labels',
  },
  elevationHeat: {
    name: 'Elevation Heat',
    url: 'https://tiles.stadiamaps.com/tiles/stamen_terrain_background/{z}/{x}/{y}.png',
    attribution: '&copy; Stamen Design &copy; Stadia Maps',
  },
  topo: {
    name: 'Topo',
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: 'OpenTopoMap',
  },
  terrain: {
    name: 'Terrain',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: 'ESRI World Terrain',
  },
}

const ELEVATION_OVERLAYS = {
  hillshade: {
    name: 'Hillshade',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
    opacity: 0.45,
  },
  slopeShadow: {
    name: 'Slope Shadow',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade_Dark/MapServer/tile/{z}/{y}/{x}',
    opacity: 0.50,
  },
  off: {
    name: 'Off',
    url: null,
    opacity: 0,
  },
}

// Leaflet CSS injected inline
const LEAFLET_CSS = `
.leaflet-container{height:100%;width:100%;background:#1a1612;font-family:inherit}
.leaflet-control-attribution{background:rgba(20,16,12,0.85)!important;color:rgba(180,163,145,0.6)!important;font-size:9px!important;padding:2px 6px!important;border-radius:4px 0 0 0!important}
.leaflet-control-attribution a{color:rgba(251,191,36,0.7)!important}
.leaflet-popup-content-wrapper{background:rgba(20,16,12,0.98);border:1px solid rgba(107,93,82,0.32);border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.5)}
.leaflet-popup-content{margin:10px 12px;color:rgba(245,235,220,0.95);font-size:13px}
.leaflet-popup-tip{background:rgba(20,16,12,0.98);border:1px solid rgba(107,93,82,0.32)}
.leaflet-marker-icon{transition:transform 0.15s ease}
@keyframes raxPulse{0%,100%{transform:scale(1);opacity:0.9}50%{transform:scale(1.15);opacity:1}}
.rax-pending-marker{animation:raxPulse 1.2s ease-in-out infinite}
@keyframes raxFadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.rax-panel{animation:raxFadeUp 0.15s ease-out}
`

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface MapViewerProps {
  pins: MapPinType[]
  onPinClick?: (pin: MapPinType) => void
  onMapClick?: (lat: number, lng: number) => void
  selectedPinId?: string
}

interface ElevationData {
  feet: number
  meters: number
  lat: number
  lng: number
  zone: TerrainZone
}

type BaseLayerKey = keyof typeof BASE_LAYERS
type OverlayKey = keyof typeof ELEVATION_OVERLAYS

export function MapViewer({ pins, onPinClick, onMapClick, selectedPinId }: MapViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<unknown>(null)
  const baseLayerRef = useRef<unknown>(null)
  const labelsLayerRef = useRef<unknown>(null)
  const overlayLayerRef = useRef<unknown>(null)
  const markersRef = useRef<Map<string, unknown>>(new Map())
  const pendingMarkerRef = useRef<unknown>(null)
  
  const [isMapReady, setIsMapReady] = useState(false)
  const [activeBaseLayer, setActiveBaseLayer] = useState<BaseLayerKey>('satellite')
  const [activeOverlay, setActiveOverlay] = useState<OverlayKey>('hillshade')
  const [layerPanelOpen, setLayerPanelOpen] = useState(false)
  
  const [elevation, setElevation] = useState<ElevationData | null>(null)
  const [elevationLoading, setElevationLoading] = useState(false)
  const [elevationError, setElevationError] = useState(false)
  
  const [pendingPin, setPendingPin] = useState<{ lat: number; lng: number } | null>(null)

  // Initialize Leaflet map
  useEffect(() => {
    if (!containerRef.current) return

    let map: unknown
    let L: typeof import('leaflet')

    const initMap = async () => {
      // Dynamic import of Leaflet
      L = (await import('leaflet')).default

      // Create map
      map = L.map(containerRef.current!, {
        center: [39, -98],
        zoom: 5,
        minZoom: 3,
        maxZoom: 19,
        zoomControl: false,
        attributionControl: true,
      })
      mapRef.current = map

      // Add initial base layer
      const baseConfig = BASE_LAYERS[activeBaseLayer]
      const baseLayer = L.tileLayer(baseConfig.url, {
        attribution: baseConfig.attribution,
        maxZoom: 19,
      })
      baseLayer.addTo(map as L.Map)
      baseLayerRef.current = baseLayer

      // Add labels layer if satellite+labels
      if (activeBaseLayer === 'satelliteLabels') {
        const labelsLayer = L.tileLayer(BASE_LAYERS.satelliteLabels.labelsUrl!, { maxZoom: 19 })
        labelsLayer.addTo(map as L.Map)
        labelsLayerRef.current = labelsLayer
      }

      // Add initial overlay (hillshade by default)
      if (activeOverlay !== 'off') {
        const overlayConfig = ELEVATION_OVERLAYS[activeOverlay]
        if (overlayConfig.url) {
          const overlayLayer = L.tileLayer(overlayConfig.url, {
            opacity: overlayConfig.opacity,
            maxZoom: 19,
          })
          overlayLayer.addTo(map as L.Map)
          overlayLayerRef.current = overlayLayer
        }
      }

      // Map click handler for elevation + pending pin
      ;(map as L.Map).on('click', async (e: L.LeafletMouseEvent) => {
        const { lat, lng } = e.latlng
        
        // Set pending pin location
        setPendingPin({ lat, lng })
        
        // Fetch elevation
        setElevationLoading(true)
        setElevationError(false)
        
        try {
          const res = await fetch(
            `https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&wkid=4326&includeDate=false`
          )
          const data = await res.json()
          const meters = data.value
          if (meters === -1000000 || meters === null || meters === undefined) {
            throw new Error('No elevation data')
          }
          const feet = meters * 3.28084
          setElevation({
            feet,
            meters,
            lat,
            lng,
            zone: getTerrainZone(feet),
          })
        } catch {
          setElevationError(true)
          setElevation(null)
        } finally {
          setElevationLoading(false)
        }

        // Add pending marker with pulse animation
        if (pendingMarkerRef.current) {
          ;(map as L.Map).removeLayer(pendingMarkerRef.current as L.Layer)
        }
        
        const pendingIcon = L.divIcon({
          className: 'rax-pending-marker',
          html: `<svg width="32" height="40" viewBox="0 0 24 32">
            <ellipse cx="12" cy="30" rx="5" ry="2" fill="rgba(251,191,36,0.3)"/>
            <path d="M12 0C7.58 0 4 3.58 4 8c0 5.25 8 16 8 16s8-10.75 8-16c0-4.42-3.58-8-8-8z" 
                  fill="rgba(251,191,36,0.95)" stroke="rgba(255,255,255,0.9)" stroke-width="1.5"/>
            <circle cx="12" cy="8" r="4" fill="rgba(255,255,255,0.95)"/>
          </svg>`,
          iconSize: [32, 40],
          iconAnchor: [16, 40],
        })
        
        const pendingMarker = L.marker([lat, lng], { icon: pendingIcon })
        pendingMarker.addTo(map as L.Map)
        pendingMarkerRef.current = pendingMarker
      })

      setIsMapReady(true)
    }

    initMap()

    return () => {
      if (map) {
        ;(map as L.Map).remove()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update base layer when changed
  useEffect(() => {
    if (!isMapReady || !mapRef.current) return

    const updateLayers = async () => {
      const L = (await import('leaflet')).default
      const map = mapRef.current as L.Map

      // Remove old base layer
      if (baseLayerRef.current) {
        map.removeLayer(baseLayerRef.current as L.Layer)
      }
      if (labelsLayerRef.current) {
        map.removeLayer(labelsLayerRef.current as L.Layer)
        labelsLayerRef.current = null
      }

      // Add new base layer
      const baseConfig = BASE_LAYERS[activeBaseLayer]
      const baseLayer = L.tileLayer(baseConfig.url, {
        attribution: baseConfig.attribution,
        maxZoom: 19,
      })
      baseLayer.addTo(map)
      baseLayerRef.current = baseLayer

      // Add labels if satellite+labels
      if (activeBaseLayer === 'satelliteLabels') {
        const labelsLayer = L.tileLayer(BASE_LAYERS.satelliteLabels.labelsUrl!, { maxZoom: 19 })
        labelsLayer.addTo(map)
        labelsLayerRef.current = labelsLayer
      }

      // Re-add overlay on top
      if (overlayLayerRef.current) {
        ;(overlayLayerRef.current as L.Layer).bringToFront()
      }
    }

    updateLayers()
  }, [activeBaseLayer, isMapReady])

  // Update overlay when changed
  useEffect(() => {
    if (!isMapReady || !mapRef.current) return

    const updateOverlay = async () => {
      const L = (await import('leaflet')).default
      const map = mapRef.current as L.Map

      // Remove old overlay
      if (overlayLayerRef.current) {
        map.removeLayer(overlayLayerRef.current as L.Layer)
        overlayLayerRef.current = null
      }

      // Add new overlay
      if (activeOverlay !== 'off') {
        const overlayConfig = ELEVATION_OVERLAYS[activeOverlay]
        if (overlayConfig.url) {
          const overlayLayer = L.tileLayer(overlayConfig.url, {
            opacity: overlayConfig.opacity,
            maxZoom: 19,
          })
          overlayLayer.addTo(map)
          overlayLayerRef.current = overlayLayer
        }
      }
    }

    updateOverlay()
  }, [activeOverlay, isMapReady])

  // Update pin markers when pins change
  useEffect(() => {
    if (!isMapReady || !mapRef.current) return

    const updateMarkers = async () => {
      const L = (await import('leaflet')).default
      const map = mapRef.current as L.Map

      // Remove old markers not in current pins
      const currentPinIds = new Set(pins.map(p => p.id))
      markersRef.current.forEach((marker, id) => {
        if (!currentPinIds.has(id)) {
          map.removeLayer(marker as L.Layer)
          markersRef.current.delete(id)
        }
      })

      // Add/update markers for each pin
      pins.forEach(pin => {
        if (pin.latitude == null || pin.longitude == null) return

        const isSelected = selectedPinId === pin.id
        const color = LOCATION_TYPE_COLORS[pin.location_type]
        const label = pin.label || LOCATION_TYPE_LABELS[pin.location_type]

        // Create custom SVG icon
        const iconHtml = `<svg width="28" height="36" viewBox="0 0 24 32">
          <ellipse cx="12" cy="30" rx="4" ry="2" fill="rgba(0,0,0,0.3)"/>
          <path d="M12 0C7.58 0 4 3.58 4 8c0 5.25 8 16 8 16s8-10.75 8-16c0-4.42-3.58-8-8-8z" 
                fill="${color}" 
                stroke="${isSelected ? '#fff' : 'rgba(255,255,255,0.4)'}" 
                stroke-width="${isSelected ? 2.5 : 1}"/>
          <circle cx="12" cy="8" r="3.5" fill="rgba(255,255,255,0.95)"/>
        </svg>`

        const icon = L.divIcon({
          className: '',
          html: iconHtml,
          iconSize: [28, 36],
          iconAnchor: [14, 36],
        })

        // Check if marker exists
        const existingMarker = markersRef.current.get(pin.id) as L.Marker | undefined
        if (existingMarker) {
          existingMarker.setIcon(icon)
        } else {
          const marker = L.marker([pin.latitude, pin.longitude], { icon })
          marker.bindTooltip(label, {
            direction: 'top',
            offset: [0, -36],
            className: 'rax-tooltip',
          })
          marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e)
            onPinClick?.(pin)
          })
          marker.addTo(map)
          markersRef.current.set(pin.id, marker)
        }
      })
    }

    updateMarkers()
  }, [pins, selectedPinId, isMapReady, onPinClick])

  // Zoom controls
  const handleZoomIn = useCallback(async () => {
    if (!mapRef.current) return
    ;(mapRef.current as L.Map).zoomIn()
  }, [])

  const handleZoomOut = useCallback(async () => {
    if (!mapRef.current) return
    ;(mapRef.current as L.Map).zoomOut()
  }, [])

  const handleReset = useCallback(async () => {
    if (!mapRef.current) return
    ;(mapRef.current as L.Map).setView([39, -98], 5)
    setPendingPin(null)
    setElevation(null)
    if (pendingMarkerRef.current) {
      ;(mapRef.current as L.Map).removeLayer(pendingMarkerRef.current as L.Layer)
      pendingMarkerRef.current = null
    }
  }, [])

  // Pin confirmation handlers
  const handleConfirmPin = useCallback(() => {
    if (pendingPin && onMapClick) {
      onMapClick(pendingPin.lat, pendingPin.lng)
    }
    setPendingPin(null)
    setElevation(null)
    if (pendingMarkerRef.current && mapRef.current) {
      ;(mapRef.current as L.Map).removeLayer(pendingMarkerRef.current as L.Layer)
      pendingMarkerRef.current = null
    }
  }, [pendingPin, onMapClick])

  const handleCancelPin = useCallback(() => {
    setPendingPin(null)
    setElevation(null)
    if (pendingMarkerRef.current && mapRef.current) {
      ;(mapRef.current as L.Map).removeLayer(pendingMarkerRef.current as L.Layer)
      pendingMarkerRef.current = null
    }
  }, [])

  return (
    <div
      className="relative w-full h-full min-h-[400px] rounded-lg overflow-hidden"
      style={{ backgroundColor: '#1a1612' }}
    >
      {/* Inject Leaflet CSS */}
      <style dangerouslySetInnerHTML={{ __html: LEAFLET_CSS }} />

      {/* Map container */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Layer switcher panel - top left */}
      <div className="absolute top-4 left-4 z-[1000]">
        <button
          onClick={() => setLayerPanelOpen(!layerPanelOpen)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg transition-all"
          style={{
            background: 'rgba(20,16,12,0.98)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(107,93,82,0.32)',
            color: 'rgba(245,235,220,0.95)',
            fontSize: '11px',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          Layers
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ transform: layerPanelOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {layerPanelOpen && (
          <div
            className="rax-panel mt-2 p-3 rounded-lg"
            style={{
              background: 'rgba(20,16,12,0.98)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(107,93,82,0.32)',
              minWidth: '180px',
            }}
          >
            {/* Base layers */}
            <div className="mb-3">
              <div
                className="text-[9px] font-semibold mb-2"
                style={{ color: 'rgba(180,163,145,0.6)', letterSpacing: '0.1em', textTransform: 'uppercase' }}
              >
                Base Map
              </div>
              <div className="space-y-1">
                {(Object.keys(BASE_LAYERS) as BaseLayerKey[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => setActiveBaseLayer(key)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded transition-colors text-left"
                    style={{
                      background: activeBaseLayer === key ? 'rgba(251,191,36,0.15)' : 'transparent',
                      color: activeBaseLayer === key ? 'rgba(251,191,36,0.95)' : 'rgba(245,235,220,0.8)',
                      fontSize: '11px',
                    }}
                  >
                    <span
                      className="w-3 h-3 rounded-full border-2"
                      style={{
                        borderColor: activeBaseLayer === key ? 'rgba(251,191,36,0.95)' : 'rgba(107,93,82,0.5)',
                        background: activeBaseLayer === key ? 'rgba(251,191,36,0.95)' : 'transparent',
                      }}
                    />
                    {BASE_LAYERS[key].name}
                  </button>
                ))}
              </div>
            </div>

            {/* Elevation overlays */}
            <div>
              <div
                className="text-[9px] font-semibold mb-2"
                style={{ color: 'rgba(180,163,145,0.6)', letterSpacing: '0.1em', textTransform: 'uppercase' }}
              >
                Elevation Overlay
              </div>
              <div className="space-y-1">
                {(Object.keys(ELEVATION_OVERLAYS) as OverlayKey[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => setActiveOverlay(key)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded transition-colors text-left"
                    style={{
                      background: activeOverlay === key ? 'rgba(251,191,36,0.15)' : 'transparent',
                      color: activeOverlay === key ? 'rgba(251,191,36,0.95)' : 'rgba(245,235,220,0.8)',
                      fontSize: '11px',
                    }}
                  >
                    <span
                      className="w-3 h-3 rounded-full border-2"
                      style={{
                        borderColor: activeOverlay === key ? 'rgba(251,191,36,0.95)' : 'rgba(107,93,82,0.5)',
                        background: activeOverlay === key ? 'rgba(251,191,36,0.95)' : 'transparent',
                      }}
                    />
                    {ELEVATION_OVERLAYS[key].name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Zoom controls - top right */}
      <div className="absolute top-4 right-4 z-[1000] flex flex-col gap-1">
        <button
          onClick={handleZoomIn}
          className="w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:scale-105"
          style={{
            background: 'rgba(20,16,12,0.98)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(107,93,82,0.32)',
            color: 'rgba(245,235,220,0.95)',
          }}
          title="Zoom in"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <button
          onClick={handleZoomOut}
          className="w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:scale-105"
          style={{
            background: 'rgba(20,16,12,0.98)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(107,93,82,0.32)',
            color: 'rgba(245,235,220,0.95)',
          }}
          title="Zoom out"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <button
          onClick={handleReset}
          className="w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:scale-105"
          style={{
            background: 'rgba(20,16,12,0.98)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(107,93,82,0.32)',
            color: 'rgba(245,235,220,0.95)',
          }}
          title="Reset view"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
      </div>

      {/* Elevation panel - bottom left */}
      <div className="absolute bottom-14 left-4 z-[1000]">
        {elevationLoading && (
          <div
            className="rax-panel px-4 py-3 rounded-lg"
            style={{
              background: 'rgba(20,16,12,0.98)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(107,93,82,0.32)',
            }}
          >
            <div className="flex items-center gap-2">
              <div
                className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: 'rgba(251,191,36,0.6)', borderTopColor: 'transparent' }}
              />
              <span style={{ color: 'rgba(180,163,145,0.75)', fontSize: '12px' }}>Loading elevation...</span>
            </div>
          </div>
        )}

        {elevationError && !elevationLoading && (
          <div
            className="rax-panel px-4 py-3 rounded-lg"
            style={{
              background: 'rgba(20,16,12,0.98)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(107,93,82,0.32)',
            }}
          >
            <span style={{ color: 'rgba(239,68,68,0.9)', fontSize: '12px' }}>Elevation unavailable</span>
          </div>
        )}

        {elevation && !elevationLoading && (
          <div
            className="rax-panel rounded-lg overflow-hidden"
            style={{
              background: 'rgba(20,16,12,0.98)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(107,93,82,0.32)',
              minWidth: '200px',
            }}
          >
            <div className="px-4 py-3">
              {/* Elevation */}
              <div className="flex items-baseline gap-2 mb-1">
                <span
                  className="text-2xl font-bold tabular-nums"
                  style={{ color: 'rgba(251,191,36,0.95)' }}
                >
                  {Math.round(elevation.feet).toLocaleString()}
                </span>
                <span style={{ color: 'rgba(180,163,145,0.6)', fontSize: '12px' }}>ft</span>
              </div>
              <div style={{ color: 'rgba(180,163,145,0.6)', fontSize: '11px' }}>
                {Math.round(elevation.meters).toLocaleString()} m
              </div>

              {/* Coordinates */}
              <div
                className="mt-2 pt-2 font-mono"
                style={{
                  borderTop: '1px solid rgba(107,93,82,0.2)',
                  color: 'rgba(180,163,145,0.5)',
                  fontSize: '10px',
                }}
              >
                {elevation.lat.toFixed(5)}, {elevation.lng.toFixed(5)}
              </div>
            </div>

            {/* Terrain zone badge */}
            <div
              className="px-4 py-2.5"
              style={{
                background: `${elevation.zone.color}15`,
                borderTop: `1px solid ${elevation.zone.color}30`,
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: elevation.zone.color }}
                />
                <span
                  className="font-semibold"
                  style={{ color: elevation.zone.color, fontSize: '12px' }}
                >
                  {elevation.zone.name}
                </span>
              </div>
              <div style={{ color: 'rgba(180,163,145,0.7)', fontSize: '10px', lineHeight: 1.4 }}>
                {elevation.zone.hint}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Pin confirmation panel - bottom right */}
      {pendingPin && (
        <div className="absolute bottom-14 right-4 z-[1000]">
          <div
            className="rax-panel rounded-lg p-4"
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
              className="font-mono mb-1"
              style={{ color: 'rgba(180,163,145,0.7)', fontSize: '11px' }}
            >
              {pendingPin.lat.toFixed(5)}, {pendingPin.lng.toFixed(5)}
            </div>
            {elevation && (
              <div
                className="flex items-center gap-1.5 mb-3"
                style={{ color: elevation.zone.color, fontSize: '10px' }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: elevation.zone.color }}
                />
                {elevation.zone.name}
              </div>
            )}
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

      {/* Pin legend - bottom bar */}
      <div
        className="absolute bottom-0 left-0 right-0 z-[1000] flex items-center justify-evenly py-2.5 pointer-events-none"
        style={{
          background: 'linear-gradient(145deg, rgba(18,14,11,0.96), rgba(28,22,17,0.94))',
          borderTop: '1px solid rgba(107,93,82,0.25)',
          boxShadow: 'inset 0 1px 0 rgba(107,93,82,0.12)',
        }}
      >
        {(Object.keys(LOCATION_TYPE_LABELS) as LocationType[]).map(type => (
          <div key={type} className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: LOCATION_TYPE_COLORS[type], boxShadow: `0 0 4px ${LOCATION_TYPE_COLORS[type]}60` }}
            />
            <span
              className="whitespace-nowrap"
              style={{
                fontSize: '9px',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: 'rgba(180,163,145,0.75)',
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
