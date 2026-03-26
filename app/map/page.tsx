'use client'

import { useState, useEffect, useCallback } from 'react'
import useSWR, { mutate } from 'swr'
import dynamic from 'next/dynamic'
import { Header } from '@/components/header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { PropertyForm } from '@/components/map/property-form'
import { PinForm } from '@/components/map/pin-form'
import { FilterPanel } from '@/components/map/filter-panel'
import { PropertyList } from '@/components/map/property-list'
import { 
  MapPin, 
  Plus, 
  Building2, 
  TreePine,
  Target,
  Calendar,
  ChevronRight
} from 'lucide-react'
import Link from 'next/link'
import type { Property, MapPin as MapPinType, LocationType, PropertyFormData, MapPinFormData } from '@/lib/types'
import { LOCATION_TYPE_LABELS, LOCATION_TYPE_COLORS } from '@/components/map/map-viewer'

// Dynamic import for map to avoid SSR issues with Leaflet
const MapViewer = dynamic(
  () => import('@/components/map/map-viewer').then(mod => mod.MapViewer),
  { 
    ssr: false,
    loading: () => (
      <div className="w-full h-full min-h-[400px] flex items-center justify-center bg-muted rounded-lg">
        <div className="text-center">
          <Skeleton className="h-8 w-8 rounded-full mx-auto mb-2" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
    )
  }
)

const fetcher = (url: string) => fetch(url).then(res => res.json())

interface MapFilters {
  state?: string
  property_id?: string
  location_type?: LocationType
  year?: number
}

export default function MapPage() {
  const [filters, setFilters] = useState<MapFilters>({})
  const [showPropertyForm, setShowPropertyForm] = useState(false)
  const [showPinForm, setShowPinForm] = useState(false)
  const [clickedLocation, setClickedLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [selectedPinId, setSelectedPinId] = useState<string>()
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>()
  const [activeTab, setActiveTab] = useState<'properties' | 'pins'>('properties')

  // Fetch data
  const { data: propertiesData, isLoading: loadingProperties } = useSWR<{ properties: Property[] }>(
    '/api/map/properties',
    fetcher
  )
  const { data: pinsData, isLoading: loadingPins } = useSWR<{ pins: MapPinType[] }>(
    `/api/map/pins${filters.property_id ? `?property_id=${filters.property_id}` : ''}`,
    fetcher
  )
  const { data: statsData } = useSWR<{ totalProperties: number; totalPins: number; mappedBucks: number }>(
    '/api/map/stats',
    fetcher
  )

  const properties = propertiesData?.properties || []
  const pins = pinsData?.pins || []

  // Filter pins
  const filteredPins = pins.filter(pin => {
    if (filters.location_type && pin.location_type !== filters.location_type) return false
    if (filters.year && pin.pin_date) {
      const pinYear = new Date(pin.pin_date).getFullYear()
      if (pinYear !== filters.year) return false
    }
    return true
  })

  const handleMapClick = useCallback((lat: number, lng: number) => {
    setClickedLocation({ lat, lng })
    setShowPinForm(true)
  }, [])

  const handlePinClick = useCallback((pin: MapPinType) => {
    setSelectedPinId(pin.id)
  }, [])

  const handleCreateProperty = async (data: PropertyFormData) => {
    const res = await fetch('/api/map/properties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    if (res.ok) {
      mutate('/api/map/properties')
      mutate('/api/map/stats')
    }
  }

  const handleCreatePin = async (data: MapPinFormData) => {
    const res = await fetch('/api/map/pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    if (res.ok) {
      mutate('/api/map/pins')
      mutate('/api/map/stats')
      setClickedLocation(null)
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      
      <main className="flex-1 container mx-auto px-4 py-6">
        {/* Stats Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold">Map</h1>
            <p className="text-muted-foreground text-sm">
              Track properties, sightings, and buck locations
            </p>
          </div>
          
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2 text-sm">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{statsData?.totalProperties || 0}</span>
              <span className="text-muted-foreground">Properties</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{statsData?.totalPins || 0}</span>
              <span className="text-muted-foreground">Pins</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Target className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{statsData?.mappedBucks || 0}</span>
              <span className="text-muted-foreground">Mapped Bucks</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left Panel */}
          <div className="lg:col-span-1 space-y-4">
            <FilterPanel
              filters={filters}
              onFiltersChange={setFilters}
              properties={properties}
              onClearFilters={() => setFilters({})}
            />

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'properties' | 'pins')}>
              <TabsList className="w-full">
                <TabsTrigger value="properties" className="flex-1">
                  <Building2 className="h-4 w-4 mr-1.5" />
                  Properties
                </TabsTrigger>
                <TabsTrigger value="pins" className="flex-1">
                  <MapPin className="h-4 w-4 mr-1.5" />
                  Pins
                </TabsTrigger>
              </TabsList>

              <TabsContent value="properties" className="mt-4">
                <PropertyList
                  properties={properties}
                  onAddProperty={() => setShowPropertyForm(true)}
                  selectedPropertyId={selectedPropertyId}
                  onSelectProperty={(p) => {
                    setSelectedPropertyId(p.id)
                    setFilters({ ...filters, property_id: p.id })
                  }}
                />
              </TabsContent>

              <TabsContent value="pins" className="mt-4">
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        Recent Pins
                        <Badge variant="secondary">{filteredPins.length}</Badge>
                      </CardTitle>
                      <Button size="sm" onClick={() => setShowPinForm(true)}>
                        <Plus className="h-4 w-4 mr-1" />
                        Add
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[300px] px-4 pb-4">
                      {loadingPins ? (
                        <div className="space-y-2">
                          {[1, 2, 3].map(i => (
                            <Skeleton key={i} className="h-16 w-full" />
                          ))}
                        </div>
                      ) : filteredPins.length === 0 ? (
                        <div className="py-8 text-center text-muted-foreground">
                          <MapPin className="h-10 w-10 mx-auto mb-3 opacity-50" />
                          <p className="text-sm">No pins yet</p>
                          <p className="text-xs mt-1">Click on the map to add a pin</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {filteredPins.slice(0, 20).map(pin => (
                            <div
                              key={pin.id}
                              className={`
                                p-3 rounded-lg border cursor-pointer transition-colors
                                ${selectedPinId === pin.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}
                              `}
                              onClick={() => setSelectedPinId(pin.id)}
                            >
                              <div className="flex items-start gap-3">
                                <div 
                                  className="w-3 h-3 rounded-full mt-1 shrink-0"
                                  style={{ backgroundColor: LOCATION_TYPE_COLORS[pin.location_type] }}
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm truncate">
                                    {pin.label || LOCATION_TYPE_LABELS[pin.location_type]}
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                                    <span>{LOCATION_TYPE_LABELS[pin.location_type]}</span>
                                    {pin.is_approximate && (
                                      <Badge variant="outline" className="text-xs py-0">
                                        Approx
                                      </Badge>
                                    )}
                                  </div>
                                  {pin.pin_date && (
                                    <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                                      <Calendar className="h-3 w-3" />
                                      {new Date(pin.pin_date).toLocaleDateString()}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Map Area */}
          <div className="lg:col-span-3">
            <Card className="h-[600px] lg:h-[700px]">
              <CardContent className="p-0 h-full">
                <MapViewer
                  pins={filteredPins}
                  onMapClick={handleMapClick}
                  onPinClick={handlePinClick}
                  selectedPinId={selectedPinId}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Forms */}
      <PropertyForm
        open={showPropertyForm}
        onOpenChange={setShowPropertyForm}
        onSubmit={handleCreateProperty}
      />

      <PinForm
        open={showPinForm}
        onOpenChange={(open) => {
          setShowPinForm(open)
          if (!open) setClickedLocation(null)
        }}
        onSubmit={handleCreatePin}
        properties={properties}
        clickedLocation={clickedLocation}
      />
    </div>
  )
}
