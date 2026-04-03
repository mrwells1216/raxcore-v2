'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { 
  MapPin, 
  Building2, 
  Plus, 
  Check, 
  ChevronRight,
  TreePine,
  ExternalLink
} from 'lucide-react'
import { PropertyForm } from './property-form'
import { PinForm } from './pin-form'
import { toast } from 'sonner'
import type { Property, MapPin as MapPinType, PropertyFormData, MapPinFormData } from '@/lib/types'
import { LOCATION_TYPE_LABELS } from './map-viewer'

interface BuckLocationLinkProps {
  buckId: string
  currentPropertyId?: string | null
  currentPinId?: string | null
  compact?: boolean
}

export function BuckLocationLink({ 
  buckId, 
  currentPropertyId, 
  currentPinId,
  compact = false 
}: BuckLocationLinkProps) {
  const [properties, setProperties] = useState<Property[]>([])
  const [pins, setPins] = useState<MapPinType[]>([])
  const [selectedPropertyId, setSelectedPropertyId] = useState(currentPropertyId || '')
  const [isLoading, setIsLoading] = useState(false)
  const [isLinking, setIsLinking] = useState(false)
  const [showPropertyForm, setShowPropertyForm] = useState(false)
  const [showPinForm, setShowPinForm] = useState(false)
  const [showDialog, setShowDialog] = useState(false)
  const [linked, setLinked] = useState(!!currentPropertyId)

  const currentProperty = properties.find(p => p.id === currentPropertyId)

  // Fetch properties
  useEffect(() => {
    async function fetchProperties() {
      setIsLoading(true)
      try {
        const res = await fetch('/api/map/properties')
        if (!res.ok) {
          // Non-critical - properties table may not exist
          setProperties([])
          return
        }
        const data = await res.json()
        setProperties(data.properties || [])
      } catch {
        // Silently fail - properties are optional
        setProperties([])
      } finally {
        setIsLoading(false)
      }
    }
    fetchProperties()
  }, [])

  // Fetch pins for selected property
  useEffect(() => {
    async function fetchPins() {
      if (!selectedPropertyId) {
        setPins([])
        return
      }
      try {
        const res = await fetch(`/api/map/pins?property_id=${selectedPropertyId}`)
        const data = await res.json()
        setPins(data.pins || [])
      } catch (error) {
        console.error('Failed to fetch pins:', error)
      }
    }
    fetchPins()
  }, [selectedPropertyId])

  const handleLinkToProperty = async () => {
    if (!selectedPropertyId) return
    setIsLinking(true)
    try {
      const res = await fetch(`/api/map/bucks/${buckId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: selectedPropertyId })
      })
      if (res.ok) {
        setLinked(true)
        toast.success('Buck linked to property')
        setShowDialog(false)
      }
    } catch (error) {
      console.error('Failed to link buck:', error)
      toast.error('Failed to link buck')
    } finally {
      setIsLinking(false)
    }
  }

  const handleCreateProperty = async (data: PropertyFormData) => {
    const res = await fetch('/api/map/properties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    if (res.ok) {
      const { id } = await res.json()
      // Refresh properties
      const propsRes = await fetch('/api/map/properties')
      const propsData = await propsRes.json()
      setProperties(propsData.properties || [])
      setSelectedPropertyId(id)
      toast.success('Property created')
    }
  }

  const handleCreatePin = async (data: MapPinFormData) => {
    const res = await fetch('/api/map/pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, buck_id: buckId, property_id: selectedPropertyId })
    })
    if (res.ok) {
      toast.success('Pin created and linked to buck')
      // Refresh pins
      if (selectedPropertyId) {
        const pinsRes = await fetch(`/api/map/pins?property_id=${selectedPropertyId}`)
        const pinsData = await pinsRes.json()
        setPins(pinsData.pins || [])
      }
    }
  }

  // Compact display for results page
  if (compact) {
    if (linked && currentProperty) {
      return (
        <Link href={`/map/properties/${currentProperty.id}`}>
          <div className="flex items-center gap-2 p-3 rounded-lg border hover:bg-secondary/50 cursor-pointer transition-colors">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{currentProperty.name}</p>
              {currentProperty.state && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <TreePine className="h-3 w-3" />
                  {currentProperty.state}
                </p>
              )}
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
        </Link>
      )
    }

    return (
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogTrigger asChild>
          <Button variant="outline" className="w-full justify-start gap-2">
            <MapPin className="h-4 w-4" />
            Link to Property
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link Buck to Property</DialogTitle>
            <DialogDescription>
              Connect this buck to a property for location tracking.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Property</label>
              <Select
                value={selectedPropertyId}
                onValueChange={setSelectedPropertyId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a property" />
                </SelectTrigger>
                <SelectContent>
                  {properties.map(prop => (
                    <SelectItem key={prop.id} value={prop.id}>
                      {prop.name} {prop.state && `(${prop.state})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setShowDialog(false)
                setShowPropertyForm(true)
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create New Property
            </Button>

            <div className="flex gap-2 pt-4">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowDialog(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleLinkToProperty}
                disabled={!selectedPropertyId || isLinking}
              >
                {isLinking ? 'Linking...' : 'Link Buck'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  // Full card display
  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            Location
          </CardTitle>
          <CardDescription>
            Track where this buck was seen or harvested
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {linked && currentProperty ? (
            <div className="space-y-3">
              <Link href={`/map/properties/${currentProperty.id}`}>
                <div className="flex items-center gap-3 p-3 rounded-lg border hover:bg-secondary/50 cursor-pointer transition-colors">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{currentProperty.name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {currentProperty.state && (
                        <span className="flex items-center gap-1">
                          <TreePine className="h-3 w-3" />
                          {currentProperty.state}
                        </span>
                      )}
                      <Badge variant="secondary" className="text-xs">
                        {currentProperty.property_type}
                      </Badge>
                    </div>
                  </div>
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                </div>
              </Link>

              {pins.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Location Pins</p>
                  {pins.slice(0, 3).map(pin => (
                    <div key={pin.id} className="flex items-center gap-2 text-sm p-2 rounded bg-secondary/30">
                      <MapPin className="h-3 w-3 text-muted-foreground" />
                      <span>{pin.label || LOCATION_TYPE_LABELS[pin.location_type]}</span>
                      {pin.is_approximate && (
                        <Badge variant="outline" className="text-xs py-0">Approx</Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setShowPinForm(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Location Pin
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">Property</label>
                <Select
                  value={selectedPropertyId}
                  onValueChange={setSelectedPropertyId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a property" />
                  </SelectTrigger>
                  <SelectContent>
                    {properties.map(prop => (
                      <SelectItem key={prop.id} value={prop.id}>
                        {prop.name} {prop.state && `(${prop.state})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => setShowPropertyForm(true)}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  New Property
                </Button>
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={handleLinkToProperty}
                  disabled={!selectedPropertyId || isLinking}
                >
                  {isLinking ? 'Linking...' : 'Link Buck'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <PropertyForm
        open={showPropertyForm}
        onOpenChange={setShowPropertyForm}
        onSubmit={handleCreateProperty}
      />

      <PinForm
        open={showPinForm}
        onOpenChange={setShowPinForm}
        onSubmit={handleCreatePin}
        properties={properties}
        initialData={{ property_id: selectedPropertyId, buck_id: buckId }}
      />
    </>
  )
}
