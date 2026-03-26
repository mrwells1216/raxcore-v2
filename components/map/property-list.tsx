'use client'

import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Building2, MapPin, TreePine, Plus, ChevronRight } from 'lucide-react'
import type { Property } from '@/lib/types'

interface PropertyListProps {
  properties: Property[]
  onAddProperty: () => void
  selectedPropertyId?: string
  onSelectProperty?: (property: Property) => void
}

const PROPERTY_TYPE_COLORS: Record<string, string> = {
  private: 'bg-primary/10 text-primary',
  lease: 'bg-amber-500/10 text-amber-600',
  public: 'bg-blue-500/10 text-blue-600',
  unknown: 'bg-muted text-muted-foreground'
}

export function PropertyList({
  properties,
  onAddProperty,
  selectedPropertyId,
  onSelectProperty
}: PropertyListProps) {
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Properties
            <Badge variant="secondary" className="ml-1">
              {properties.length}
            </Badge>
          </CardTitle>
          <Button size="sm" onClick={onAddProperty}>
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        <ScrollArea className="h-full px-4 pb-4">
          {properties.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Building2 className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No properties yet</p>
              <p className="text-xs mt-1">Add a property to start mapping</p>
            </div>
          ) : (
            <div className="space-y-2">
              {properties.map(property => (
                <div
                  key={property.id}
                  className={`
                    p-3 rounded-lg border cursor-pointer transition-colors
                    ${selectedPropertyId === property.id 
                      ? 'border-primary bg-primary/5' 
                      : 'hover:bg-muted/50'}
                  `}
                  onClick={() => onSelectProperty?.(property)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-sm truncate">{property.name}</h4>
                        <Badge 
                          variant="secondary" 
                          className={`text-xs shrink-0 ${PROPERTY_TYPE_COLORS[property.property_type]}`}
                        >
                          {property.property_type}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        {property.state && (
                          <span className="flex items-center gap-1">
                            <TreePine className="h-3 w-3" />
                            {property.state}
                          </span>
                        )}
                        {property.acreage && (
                          <span>{property.acreage} acres</span>
                        )}
                      </div>
                    </div>
                    <Link href={`/map/properties/${property.id}`}>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
