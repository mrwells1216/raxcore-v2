'use client'

// Filter panel for map view - filters by property, state, pin type, and year
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { X, Filter, MapPin, Building2, Trees } from 'lucide-react'
import { US_STATES } from '@/lib/constants'
import type { LocationType, Property } from '@/lib/types'
import { LOCATION_TYPE_LABELS, LOCATION_TYPE_COLORS } from './map-viewer'

interface MapFilters {
  state?: string
  property_id?: string
  location_type?: LocationType
  year?: number
}

interface FilterPanelProps {
  filters: MapFilters
  onFiltersChange: (filters: MapFilters) => void
  properties: Property[]
  onClearFilters: () => void
}

const YEARS = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i)

export function FilterPanel({
  filters,
  onFiltersChange,
  properties,
  onClearFilters
}: FilterPanelProps) {
  const activeFilterCount = Object.values(filters).filter(Boolean).length

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filters
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="ml-1">
                {activeFilterCount}
              </Badge>
            )}
          </CardTitle>
          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearFilters}
              className="h-8 px-2"
            >
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground flex items-center gap-1.5">
            <Building2 className="h-3 w-3" />
            Property
          </Label>
          <Select
            value={filters.property_id || 'all'}
            onValueChange={(value) => 
              onFiltersChange({ ...filters, property_id: value === 'all' ? undefined : value })
            }
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="All properties" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All properties</SelectItem>
              {properties.map(prop => (
                <SelectItem key={prop.id} value={prop.id}>
                  {prop.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground flex items-center gap-1.5">
            <Trees className="h-3 w-3" />
            State
          </Label>
          <Select
            value={filters.state || 'all'}
            onValueChange={(value) => 
              onFiltersChange({ ...filters, state: value === 'all' ? undefined : value })
            }
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="All states" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              {US_STATES.map((stateOption) => (
                <SelectItem key={stateOption.value} value={stateOption.value}>
                  {stateOption.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground flex items-center gap-1.5">
            <MapPin className="h-3 w-3" />
            Pin Type
          </Label>
          <Select
            value={filters.location_type || 'all'}
            onValueChange={(value) => 
              onFiltersChange({ 
                ...filters, 
                location_type: value === 'all' ? undefined : value as LocationType 
              })
            }
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {Object.entries(LOCATION_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: LOCATION_TYPE_COLORS[value as LocationType] }}
                    />
                    {label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground">Year</Label>
          <Select
            value={filters.year?.toString() || 'all'}
            onValueChange={(value) => 
              onFiltersChange({ 
                ...filters, 
                year: value === 'all' ? undefined : parseInt(value) 
              })
            }
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="All years" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All years</SelectItem>
              {YEARS.map(year => (
                <SelectItem key={year} value={year.toString()}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  )
}
