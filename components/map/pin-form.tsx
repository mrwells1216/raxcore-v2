'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
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
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { MapPin, AlertCircle } from 'lucide-react'
import type { LocationType, MapPinFormData, Property } from '@/lib/types'

interface PinFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: MapPinFormData) => Promise<void>
  initialData?: Partial<MapPinFormData>
  properties?: Property[]
  isEditing?: boolean
  clickedLocation?: { lat: number; lng: number } | null
}

const LOCATION_TYPES: { value: LocationType; label: string; description: string }[] = [
  { value: 'harvest', label: 'Harvest', description: 'Where a buck was harvested' },
  { value: 'sighting', label: 'Sighting', description: 'Visual sighting of a buck' },
  { value: 'trailcam', label: 'Trail Cam', description: 'Trail camera location' },
  { value: 'shed', label: 'Shed', description: 'Where a shed was found' },
  { value: 'scoring_source', label: 'Scoring Source', description: 'Where scoring photos were taken' },
  { value: 'stand', label: 'Stand', description: 'Tree stand location' },
  { value: 'blind', label: 'Blind', description: 'Ground blind location' },
  { value: 'scrape', label: 'Scrape', description: 'Buck scrape location' },
  { value: 'rub', label: 'Rub', description: 'Rub line or tree' },
  { value: 'food_plot', label: 'Food Plot', description: 'Food plot area' },
  { value: 'bedding', label: 'Bedding', description: 'Bedding area' },
  { value: 'travel_corridor', label: 'Travel Corridor', description: 'Travel route' },
  { value: 'unknown', label: 'Other', description: 'Other location type' }
]

export function PinForm({
  open,
  onOpenChange,
  onSubmit,
  initialData,
  properties = [],
  isEditing = false,
  clickedLocation
}: PinFormProps) {
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState<MapPinFormData>({
    property_id: initialData?.property_id || '',
    buck_id: initialData?.buck_id || '',
    label: initialData?.label || '',
    location_type: initialData?.location_type || 'sighting',
    latitude: initialData?.latitude,
    longitude: initialData?.longitude,
    is_approximate: initialData?.is_approximate || false,
    confidence_radius_meters: initialData?.confidence_radius_meters || 100,
    pin_date: initialData?.pin_date || '',
    notes: initialData?.notes || ''
  })

  // Update coordinates when map is clicked
  useEffect(() => {
    if (clickedLocation) {
      setFormData(prev => ({
        ...prev,
        latitude: clickedLocation.lat,
        longitude: clickedLocation.lng
      }))
    }
  }, [clickedLocation])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await onSubmit(formData)
      onOpenChange(false)
      // Reset form
      setFormData({
        property_id: '',
        buck_id: '',
        label: '',
        location_type: 'sighting',
        latitude: undefined,
        longitude: undefined,
        is_approximate: false,
        confidence_radius_meters: 100,
        pin_date: '',
        notes: ''
      })
    } catch (error) {
      console.error('Error submitting pin:', error)
    } finally {
      setLoading(false)
    }
  }

  const hasCoordinates = formData.latitude != null && formData.longitude != null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            {isEditing ? 'Edit Location Pin' : 'Add Location Pin'}
          </DialogTitle>
          <DialogDescription>
            {isEditing 
              ? 'Update the location details below.'
              : 'Add a new location pin to the map. Click on the map to set coordinates.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Coordinates display */}
          {hasCoordinates ? (
            <div className="p-3 bg-muted rounded-lg">
              <div className="text-sm font-medium mb-1">Location Coordinates</div>
              <div className="text-xs text-muted-foreground font-mono">
                {formData.latitude?.toFixed(6)}, {formData.longitude?.toFixed(6)}
              </div>
            </div>
          ) : (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Click on the map to set the location coordinates, or enter them manually below.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="location_type">Location Type *</Label>
            <Select
              value={formData.location_type}
              onValueChange={(value: LocationType) => 
                setFormData({ ...formData, location_type: value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCATION_TYPES.map(type => (
                  <SelectItem key={type.value} value={type.value}>
                    <div>
                      <div>{type.label}</div>
                      <div className="text-xs text-muted-foreground">{type.description}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="label">Label</Label>
            <Input
              id="label"
              value={formData.label || ''}
              onChange={(e) => setFormData({ ...formData, label: e.target.value })}
              placeholder="e.g., North Stand, Big Buck Sighting"
            />
          </div>

          {properties.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="property_id">Property</Label>
              <Select
                value={formData.property_id || ''}
                onValueChange={(value) => setFormData({ ...formData, property_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a property (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No property</SelectItem>
                  {properties.map(prop => (
                    <SelectItem key={prop.id} value={prop.id}>
                      {prop.name} {prop.state && `(${prop.state})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="latitude">Latitude</Label>
              <Input
                id="latitude"
                type="number"
                step="0.000001"
                value={formData.latitude || ''}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  latitude: e.target.value ? parseFloat(e.target.value) : undefined 
                })}
                placeholder="e.g., 39.8283"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="longitude">Longitude</Label>
              <Input
                id="longitude"
                type="number"
                step="0.000001"
                value={formData.longitude || ''}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  longitude: e.target.value ? parseFloat(e.target.value) : undefined 
                })}
                placeholder="e.g., -98.5795"
              />
            </div>
          </div>

          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <Label htmlFor="is_approximate" className="font-medium">Approximate Location</Label>
              <p className="text-xs text-muted-foreground">
                Enable if this is not an exact GPS coordinate
              </p>
            </div>
            <Switch
              id="is_approximate"
              checked={formData.is_approximate}
              onCheckedChange={(checked) => 
                setFormData({ ...formData, is_approximate: checked })
              }
            />
          </div>

          {formData.is_approximate && (
            <div className="space-y-2">
              <Label htmlFor="confidence_radius">Confidence Radius (meters)</Label>
              <Input
                id="confidence_radius"
                type="number"
                value={formData.confidence_radius_meters || 100}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  confidence_radius_meters: parseInt(e.target.value) || 100 
                })}
                placeholder="100"
              />
              <p className="text-xs text-muted-foreground">
                The approximate accuracy radius will be shown on the map
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="pin_date">Date</Label>
            <Input
              id="pin_date"
              type="date"
              value={formData.pin_date || ''}
              onChange={(e) => setFormData({ ...formData, pin_date: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes || ''}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Any additional notes about this location..."
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving...' : isEditing ? 'Update Pin' : 'Add Pin'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
