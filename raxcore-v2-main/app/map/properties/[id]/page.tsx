'use client'

import { useState, use } from 'react'
import useSWR, { mutate } from 'swr'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { PropertyForm } from '@/components/map/property-form'
import { PinForm } from '@/components/map/pin-form'
import { 
  ArrowLeft, 
  MapPin, 
  Plus, 
  Building2, 
  TreePine,
  Target,
  Calendar,
  Edit,
  Trash2,
  Eye
} from 'lucide-react'
import type { Property, MapPin as MapPinType, MapPinFormData, PropertyFormData } from '@/lib/types'
import { LOCATION_TYPE_LABELS, LOCATION_TYPE_COLORS } from '@/components/map/map-viewer'

// Dynamic import for map
const MapViewer = dynamic(
  () => import('@/components/map/map-viewer').then(mod => mod.MapViewer),
  { 
    ssr: false,
    loading: () => (
      <div className="w-full h-full min-h-[300px] flex items-center justify-center bg-muted rounded-lg">
        <Skeleton className="h-8 w-32" />
      </div>
    )
  }
)

const fetcher = (url: string) => fetch(url).then(res => res.json())

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  private: 'Private Land',
  lease: 'Lease',
  public: 'Public Land',
  unknown: 'Unknown'
}

interface PropertyWithDetails extends Property {
  pins: MapPinType[]
  bucks: any[]
}

export default function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [showEditForm, setShowEditForm] = useState(false)
  const [showPinForm, setShowPinForm] = useState(false)
  const [clickedLocation, setClickedLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [selectedPinId, setSelectedPinId] = useState<string>()

  const { data, isLoading, error } = useSWR<{ property: PropertyWithDetails }>(
    `/api/map/properties/${id}`,
    fetcher
  )

  const property = data?.property

  const handleUpdateProperty = async (formData: PropertyFormData) => {
    const res = await fetch(`/api/map/properties/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    })
    if (res.ok) {
      mutate(`/api/map/properties/${id}`)
    }
  }

  const handleDeleteProperty = async () => {
    const res = await fetch(`/api/map/properties/${id}`, {
      method: 'DELETE'
    })
    if (res.ok) {
      router.push('/map')
    }
  }

  const handleCreatePin = async (data: MapPinFormData) => {
    const res = await fetch('/api/map/pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, property_id: id })
    })
    if (res.ok) {
      mutate(`/api/map/properties/${id}`)
      setClickedLocation(null)
    }
  }

  const handleMapClick = (lat: number, lng: number) => {
    setClickedLocation({ lat, lng })
    setShowPinForm(true)
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-6">
          <Skeleton className="h-8 w-48 mb-6" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="space-y-4">
              <Skeleton className="h-48 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
            <div className="lg:col-span-2">
              <Skeleton className="h-[500px] w-full" />
            </div>
          </div>
        </main>
      </div>
    )
  }

  if (error || !property) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-6">
          <Card className="p-8 text-center">
            <Building2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">Property Not Found</h2>
            <p className="text-muted-foreground mb-4">
              The property you&apos;re looking for doesn&apos;t exist or has been deleted.
            </p>
            <Link href="/map">
              <Button>Back to Map</Button>
            </Link>
          </Card>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="container mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
          <div className="flex items-start gap-4">
            <Link href="/map">
              <Button variant="outline" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold">{property.name}</h1>
                <Badge variant="secondary">
                  {PROPERTY_TYPE_LABELS[property.property_type]}
                </Badge>
              </div>
              <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                {property.state && (
                  <span className="flex items-center gap-1">
                    <TreePine className="h-4 w-4" />
                    {property.state}
                    {property.county && `, ${property.county}`}
                  </span>
                )}
                {property.acreage && (
                  <span>{property.acreage} acres</span>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setShowEditForm(true)}>
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Property?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete &quot;{property.name}&quot; and all associated pins.
                    This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteProperty} className="bg-destructive text-destructive-foreground">
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column */}
          <div className="space-y-4">
            {/* Property Details */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Property Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {property.owner_label && (
                  <div>
                    <div className="text-xs text-muted-foreground uppercase">Owner / Label</div>
                    <div className="text-sm">{property.owner_label}</div>
                  </div>
                )}
                {property.notes && (
                  <div>
                    <div className="text-xs text-muted-foreground uppercase">Notes</div>
                    <div className="text-sm">{property.notes}</div>
                  </div>
                )}
                <div className="pt-2 border-t">
                  <div className="text-xs text-muted-foreground">
                    Added {new Date(property.created_at).toLocaleDateString()}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Pins List */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Pins
                    <Badge variant="secondary">{property.pins?.length || 0}</Badge>
                  </CardTitle>
                  <Button size="sm" onClick={() => setShowPinForm(true)}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[250px] px-4 pb-4">
                  {property.pins?.length === 0 ? (
                    <div className="py-6 text-center text-muted-foreground">
                      <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No pins yet</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {property.pins?.map(pin => (
                        <div
                          key={pin.id}
                          className={`
                            p-3 rounded-lg border cursor-pointer transition-colors
                            ${selectedPinId === pin.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}
                          `}
                          onClick={() => setSelectedPinId(pin.id)}
                        >
                          <div className="flex items-center gap-2">
                            <div 
                              className="w-2.5 h-2.5 rounded-full"
                              style={{ backgroundColor: LOCATION_TYPE_COLORS[pin.location_type] }}
                            />
                            <span className="text-sm font-medium truncate">
                              {pin.label || LOCATION_TYPE_LABELS[pin.location_type]}
                            </span>
                            {pin.is_approximate && (
                              <Badge variant="outline" className="text-xs py-0 ml-auto">
                                Approx
                              </Badge>
                            )}
                          </div>
                          {pin.pin_date && (
                            <div className="text-xs text-muted-foreground mt-1 ml-4">
                              {new Date(pin.pin_date).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Linked Bucks */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  Linked Bucks
                  <Badge variant="secondary">{property.bucks?.length || 0}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[200px] px-4 pb-4">
                  {property.bucks?.length === 0 ? (
                    <div className="py-6 text-center text-muted-foreground">
                      <Target className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No bucks linked</p>
                      <p className="text-xs mt-1">Score a buck and link it to this property</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {property.bucks?.map((buck: any) => (
                        <Link key={buck.id} href={`/results/${buck.session_id}`}>
                          <div className="p-3 rounded-lg border hover:bg-muted/50 cursor-pointer">
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="text-sm font-medium">
                                  {buck.nickname || 'Unnamed Buck'}
                                </div>
                                {buck.predictions?.[0]?.estimated_score && (
                                  <div className="text-xs text-muted-foreground">
                                    Est. {buck.predictions[0].estimated_score}" 
                                    <Badge variant="outline" className="ml-2 text-xs py-0">
                                      {buck.predictions[0].confidence}
                                    </Badge>
                                  </div>
                                )}
                              </div>
                              <Eye className="h-4 w-4 text-muted-foreground" />
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* Map Area */}
          <div className="lg:col-span-2">
            <Card className="h-[600px]">
              <CardContent className="p-0 h-full">
                <MapViewer
                  pins={property.pins || []}
                  onMapClick={handleMapClick}
                  onPinClick={(pin) => setSelectedPinId(pin.id)}
                  selectedPinId={selectedPinId}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Edit Property Form */}
      <PropertyForm
        open={showEditForm}
        onOpenChange={setShowEditForm}
        onSubmit={handleUpdateProperty}
        initialData={{
          name: property.name,
          owner_label: property.owner_label || '',
          state: property.state || '',
          county: property.county || '',
          property_type: property.property_type,
          acreage: property.acreage || undefined,
          notes: property.notes || ''
        }}
        isEditing
      />

      {/* Add Pin Form */}
      <PinForm
        open={showPinForm}
        onOpenChange={(open) => {
          setShowPinForm(open)
          if (!open) setClickedLocation(null)
        }}
        onSubmit={handleCreatePin}
        properties={[property]}
        clickedLocation={clickedLocation}
        initialData={{ property_id: id }}
      />
    </div>
  )
}
