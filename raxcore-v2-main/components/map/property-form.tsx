'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import { US_STATES } from '@/lib/constants'
import type { PropertyType, PropertyFormData } from '@/lib/types'

interface PropertyFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: PropertyFormData) => Promise<void>
  initialData?: Partial<PropertyFormData>
  isEditing?: boolean
}

const PROPERTY_TYPES: { value: PropertyType; label: string }[] = [
  { value: 'private', label: 'Private Land' },
  { value: 'lease', label: 'Lease' },
  { value: 'public', label: 'Public Land' },
  { value: 'unknown', label: 'Unknown' }
]

export function PropertyForm({
  open,
  onOpenChange,
  onSubmit,
  initialData,
  isEditing = false
}: PropertyFormProps) {
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState<PropertyFormData>({
    name: initialData?.name || '',
    owner_label: initialData?.owner_label || '',
    state: initialData?.state || '',
    county: initialData?.county || '',
    property_type: initialData?.property_type || 'private',
    acreage: initialData?.acreage,
    notes: initialData?.notes || ''
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await onSubmit(formData)
      onOpenChange(false)
      // Reset form
      setFormData({
        name: '',
        owner_label: '',
        state: '',
        county: '',
        property_type: 'private',
        acreage: undefined,
        notes: ''
      })
    } catch (error) {
      console.error('Error submitting property:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Property' : 'Add Property'}</DialogTitle>
          <DialogDescription>
            {isEditing 
              ? 'Update the property details below.'
              : 'Add a new property or land parcel to track your hunting locations.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Property Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Smith Farm, Oak Ridge Lease"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="property_type">Property Type</Label>
              <Select
                value={formData.property_type}
                onValueChange={(value: PropertyType) => 
                  setFormData({ ...formData, property_type: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROPERTY_TYPES.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="acreage">Acreage</Label>
              <Input
                id="acreage"
                type="number"
                step="0.01"
                value={formData.acreage || ''}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  acreage: e.target.value ? parseFloat(e.target.value) : undefined 
                })}
                placeholder="e.g., 150"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Select
                value={formData.state || ''}
                onValueChange={(value) => setFormData({ ...formData, state: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select state" />
                </SelectTrigger>
                <SelectContent>
                  {US_STATES.map((stateOption) => (
                    <SelectItem key={stateOption.value} value={stateOption.value}>
                      {stateOption.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="county">County</Label>
              <Input
                id="county"
                value={formData.county || ''}
                onChange={(e) => setFormData({ ...formData, county: e.target.value })}
                placeholder="e.g., Pike County"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="owner_label">Owner / Label</Label>
            <Input
              id="owner_label"
              value={formData.owner_label || ''}
              onChange={(e) => setFormData({ ...formData, owner_label: e.target.value })}
              placeholder="e.g., Personal, John&apos;s lease"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes || ''}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Any additional notes about this property..."
              rows={3}
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
            <Button type="submit" disabled={loading || !formData.name}>
              {loading ? 'Saving...' : isEditing ? 'Update Property' : 'Add Property'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
