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
      <CardHeader className="py-2 px-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Filter className="h-3 w-3" />
            Filters
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 text-[10px] px-1">
                {activeFilterCount}
              </Badge>
            )}
          </CardTitle>
          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearFilters}
              className="h-6 px-2 text-xs"
            >
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <div className="grid grid-cols-2 gap-2">
          {/* Property */}
          <Select
            value={filters.property_id || 'all'}
            onValueChange={(value) =>
              onFiltersChange({ ...filters, property_id: value === 'all' ? undefined : value })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <Building2 className="h-3 w-3 mr-1 shrink-0 text-muted-foreground" />
              <SelectValue placeholder="Property" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All properties</SelectItem>
              {properties.map(prop => (
                <SelectItem key={prop.id} value={prop.id}>{prop.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* State */}
          <Select
            value={filters.state || 'all'}
            onValueChange={(value) =>
              onFiltersChange({ ...filters, state: value === 'all' ? undefined : value })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <Trees className="h-3 w-3 mr-1 shrink-0 text-muted-foreground" />
              <SelectValue placeholder="State" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              {US_STATES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Pin Type */}
          <Select
            value={filters.location_type || 'all'}
            onValueChange={(value) =>
              onFiltersChange({
                ...filters,
                location_type: value === 'all' ? undefined : value as LocationType,
              })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <MapPin className="h-3 w-3 mr-1 shrink-0 text-muted-foreground" />
              <SelectValue placeholder="Pin type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {Object.entries(LOCATION_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: LOCATION_TYPE_COLORS[value as LocationType] }}
                    />
                    {label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Year */}
          <Select
            value={filters.year?.toString() || 'all'}
            onValueChange={(value) =>
              onFiltersChange({
                ...filters,
                year: value === 'all' ? undefined : parseInt(value),
              })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Year" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All years</SelectItem>
              {YEARS.map(year => (
                <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  )
}
