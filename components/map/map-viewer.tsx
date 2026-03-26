'use client'

import { useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MapPin, Circle, AlertCircle } from 'lucide-react'
import type { MapPin as MapPinType, Property, LocationType } from '@/lib/types'

interface MapViewerProps {
  pins: MapPinType[]
  properties?: Property[]
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
  unknown: '#9ca3af'
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
  unknown: 'Unknown'
}

export function MapViewer({
  pins,
  center = { lat: 39.8283, lng: -98.5795 }, // Center of US
  zoom = 4,
  onPinClick,
  onMapClick,
  selectedPinId,
  showPropertyBoundaries = false
}: MapViewerProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const [mapInstance, setMapInstance] = useState<any>(null)
  const [leaflet, setLeaflet] = useState<any>(null)
  const markersRef = useRef<any[]>([])

  // Load Leaflet dynamically
  useEffect(() => {
    const loadLeaflet = async () => {
      if (typeof window !== 'undefined') {
        const L = await import('leaflet')
        await import('leaflet/dist/leaflet.css')
        setLeaflet(L.default)
      }
    }
    loadLeaflet()
  }, [])

  // Initialize map
  useEffect(() => {
    if (!leaflet || !mapRef.current || mapInstance) return

    const map = leaflet.map(mapRef.current).setView([center.lat, center.lng], zoom)

    leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map)

    if (onMapClick) {
      map.on('click', (e: any) => {
        onMapClick(e.latlng.lat, e.latlng.lng)
      })
    }

    setMapInstance(map)

    return () => {
      map.remove()
    }
  }, [leaflet, center.lat, center.lng, zoom, onMapClick])

  // Update markers when pins change
  useEffect(() => {
    if (!mapInstance || !leaflet) return

    // Clear existing markers
    markersRef.current.forEach(marker => marker.remove())
    markersRef.current = []

    // Add new markers
    pins.forEach(pin => {
      if (pin.latitude == null || pin.longitude == null) return

      const color = LOCATION_TYPE_COLORS[pin.location_type]
      const isSelected = pin.id === selectedPinId

      // Create custom icon
      const iconHtml = `
        <div style="
          width: ${isSelected ? '32px' : '24px'};
          height: ${isSelected ? '32px' : '24px'};
          background-color: ${color};
          border: 2px solid ${isSelected ? '#000' : '#fff'};
          border-radius: 50%;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          ${pin.is_approximate ? 'opacity: 0.7;' : ''}
        "></div>
      `

      const icon = leaflet.divIcon({
        html: iconHtml,
        className: 'custom-marker',
        iconSize: isSelected ? [32, 32] : [24, 24],
        iconAnchor: isSelected ? [16, 16] : [12, 12]
      })

      const marker = leaflet.marker([pin.latitude, pin.longitude], { icon })
        .addTo(mapInstance)

      // Add popup
      const popupContent = `
        <div style="min-width: 150px;">
          <strong>${pin.label || LOCATION_TYPE_LABELS[pin.location_type]}</strong>
          <br/>
          <span style="color: ${color};">${LOCATION_TYPE_LABELS[pin.location_type]}</span>
          ${pin.is_approximate ? '<br/><em style="color: #666;">Approximate location</em>' : ''}
          ${pin.pin_date ? `<br/><small>${new Date(pin.pin_date).toLocaleDateString()}</small>` : ''}
        </div>
      `
      marker.bindPopup(popupContent)

      if (onPinClick) {
        marker.on('click', () => onPinClick(pin))
      }

      // Add confidence radius circle for approximate locations
      if (pin.is_approximate && pin.confidence_radius_meters) {
        const circle = leaflet.circle([pin.latitude, pin.longitude], {
          radius: pin.confidence_radius_meters,
          color: color,
          fillColor: color,
          fillOpacity: 0.1,
          weight: 1,
          dashArray: '5, 5'
        }).addTo(mapInstance)
        markersRef.current.push(circle)
      }

      markersRef.current.push(marker)
    })

    // Fit bounds to show all markers if we have pins
    if (pins.length > 0) {
      const validPins = pins.filter(p => p.latitude != null && p.longitude != null)
      if (validPins.length > 0) {
        const bounds = leaflet.latLngBounds(
          validPins.map(p => [p.latitude!, p.longitude!])
        )
        mapInstance.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 })
      }
    }
  }, [mapInstance, leaflet, pins, selectedPinId, onPinClick])

  return (
    <div className="relative w-full h-full min-h-[400px]">
      <div ref={mapRef} className="absolute inset-0 rounded-lg" />
      
      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-[1000]">
        <Card className="p-3 bg-background/95 backdrop-blur">
          <div className="text-xs font-medium mb-2">Location Types</div>
          <div className="grid grid-cols-2 gap-1">
            {(['harvest', 'trailcam', 'sighting', 'stand'] as LocationType[]).map(type => (
              <div key={type} className="flex items-center gap-1.5">
                <div 
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: LOCATION_TYPE_COLORS[type] }}
                />
                <span className="text-xs">{LOCATION_TYPE_LABELS[type]}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* No pins message */}
      {pins.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Card className="p-4 bg-background/95 backdrop-blur">
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-5 w-5" />
              <span>No pins to display. Click the map to add a location.</span>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

export { LOCATION_TYPE_COLORS, LOCATION_TYPE_LABELS }
