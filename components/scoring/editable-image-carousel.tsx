'use client'

import { useState, useCallback, useEffect } from 'react'
import Image from 'next/image'
import { ChevronLeft, ChevronRight, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from '@/components/ui/carousel'
import { ImageEditor } from './image-editor'
import type { GridImage } from './photo-grid-uploader'

interface EditableImageCarouselProps {
  /** Array of GridImage objects */
  images: GridImage[]
  /** Callback when an image is edited */
  onImageEdit: (index: number, newUrl: string) => void
  /** Optional className for the container */
  className?: string
}

/**
 * Editable image carousel for the scoring wizard.
 * Allows users to crop and rotate images before scoring.
 */
export function EditableImageCarousel({ 
  images, 
  onImageEdit, 
  className 
}: EditableImageCarouselProps) {
  const [api, setApi] = useState<CarouselApi>()
  const [current, setCurrent] = useState(0)
  const [count, setCount] = useState(0)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  // Track carousel state
  useEffect(() => {
    if (!api) return

    setCount(api.scrollSnapList().length)
    setCurrent(api.selectedScrollSnap())

    api.on('select', () => {
      setCurrent(api.selectedScrollSnap())
    })
  }, [api])

  const scrollPrev = useCallback(() => {
    api?.scrollPrev()
  }, [api])

  const scrollNext = useCallback(() => {
    api?.scrollNext()
  }, [api])

  const handleEditClick = (index: number) => {
    setEditingIndex(index)
  }

  const handleEditorClose = () => {
    setEditingIndex(null)
  }

  const handleEditorSave = (newUrl: string) => {
    if (editingIndex !== null) {
      onImageEdit(editingIndex, newUrl)
    }
    setEditingIndex(null)
  }

  // Don't render anything if no images
  if (!images || images.length === 0) {
    return null
  }

  // Single image - render without carousel controls
  if (images.length === 1) {
    return (
      <div className={cn('w-full mb-4', className)}>
        <div className="relative aspect-[4/3] w-full rounded-xl overflow-hidden bg-muted group">
          <Image
            src={images[0].url}
            alt="Antler photo"
            fill
            className="object-contain"
            sizes="(max-width: 768px) 100vw, 800px"
            priority
          />
          {/* Edit button overlay */}
          <Button
            variant="secondary"
            size="sm"
            className="absolute bottom-3 right-3 bg-background/90 backdrop-blur-sm shadow-md opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity min-h-[44px]"
            onClick={() => handleEditClick(0)}
          >
            <Pencil className="h-4 w-4 mr-1.5" />
            Edit
          </Button>
        </div>

        {/* Image Editor Dialog */}
        <ImageEditor
          imageUrl={images[0].url}
          isOpen={editingIndex === 0}
          onClose={handleEditorClose}
          onSave={handleEditorSave}
        />
      </div>
    )
  }

  // Multiple images - render carousel
  return (
    <div className={cn('w-full mb-4', className)}>
      <Carousel
        setApi={setApi}
        opts={{
          align: 'center',
          loop: true,
        }}
        className="w-full"
      >
        <CarouselContent className="-ml-2 md:-ml-4">
          {images.map((img, index) => (
            <CarouselItem key={img.id} className="pl-2 md:pl-4 basis-full">
              <div className="relative aspect-[4/3] w-full rounded-xl overflow-hidden bg-muted group">
                <Image
                  src={img.url}
                  alt={`Antler photo ${index + 1} of ${images.length}`}
                  fill
                  className="object-contain"
                  sizes="(max-width: 768px) 100vw, 800px"
                  priority={index === 0}
                />
                {/* Edit button overlay - always visible on mobile, hover on desktop */}
                <Button
                  variant="secondary"
                  size="sm"
                  className="absolute bottom-3 right-3 bg-background/90 backdrop-blur-sm shadow-md opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity min-h-[44px]"
                  onClick={() => handleEditClick(index)}
                >
                  <Pencil className="h-4 w-4 mr-1.5" />
                  Edit
                </Button>
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>

        {/* Desktop arrow controls */}
        <Button
          variant="secondary"
          size="icon"
          className="absolute left-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-background/80 backdrop-blur-sm shadow-md hover:bg-background hidden md:flex"
          onClick={scrollPrev}
          aria-label="Previous image"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-background/80 backdrop-blur-sm shadow-md hover:bg-background hidden md:flex"
          onClick={scrollNext}
          aria-label="Next image"
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </Carousel>

      {/* Position indicator */}
      <div className="flex items-center justify-center gap-2 mt-3">
        {/* Dot indicators */}
        <div className="flex gap-1.5">
          {images.map((_, index) => (
            <button
              key={index}
              onClick={() => api?.scrollTo(index)}
              className={cn(
                'w-2 h-2 rounded-full transition-all duration-200',
                current === index
                  ? 'bg-primary w-4'
                  : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'
              )}
              aria-label={`Go to image ${index + 1}`}
            />
          ))}
        </div>
        {/* Numeric indicator */}
        <span className="text-sm text-muted-foreground ml-2">
          {current + 1} / {count}
        </span>
      </div>

      {/* Image Editor Dialog */}
      {editingIndex !== null && (
        <ImageEditor
          imageUrl={images[editingIndex].url}
          isOpen={true}
          onClose={handleEditorClose}
          onSave={handleEditorSave}
        />
      )}
    </div>
  )
}
