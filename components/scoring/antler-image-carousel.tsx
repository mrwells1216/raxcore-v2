'use client'

import { useState, useCallback, useEffect } from 'react'
import Image from 'next/image'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from '@/components/ui/carousel'

interface AntlerImageCarouselProps {
  /** Array of image URLs to display */
  images: string[]
  /** Optional className for the container */
  className?: string
  /**
   * Called when the carousel moves to a new image. Lets a parent component
   * (e.g. the landmark overlay) filter its annotations to the visible image.
   */
  onImageChange?: (index: number) => void
}

/**
 * A swipeable/spinnable image carousel for antler photos.
 * - Single image: displays as a large standalone image (no carousel controls)
 * - Multiple images: horizontal carousel with swipe, arrows, and position indicators
 */
export function AntlerImageCarousel({ images, className, onImageChange }: AntlerImageCarouselProps) {
  const [api, setApi] = useState<CarouselApi>()
  const [current, setCurrent] = useState(0)
  const [count, setCount] = useState(0)

  // Track carousel state
  useEffect(() => {
    if (!api) return

    setCount(api.scrollSnapList().length)
    setCurrent(api.selectedScrollSnap())

    api.on('select', () => {
      const idx = api.selectedScrollSnap()
      setCurrent(idx)
      onImageChange?.(idx)
    })
  }, [api, onImageChange])

  // Fire onImageChange for the initial position too (single-image case still
  // benefits from this, e.g. landmark overlay can show that image's dots).
  useEffect(() => {
    onImageChange?.(current)
  }, [current, onImageChange])

  const scrollPrev = useCallback(() => {
    api?.scrollPrev()
  }, [api])

  const scrollNext = useCallback(() => {
    api?.scrollNext()
  }, [api])

  // Don't render anything if no images
  if (!images || images.length === 0) {
    return null
  }

  // Single image - render without carousel controls
  if (images.length === 1) {
    return (
      <div className={cn('w-full mb-4', className)}>
        <div className="relative aspect-[4/3] w-full rounded-xl overflow-hidden bg-muted">
          <Image
            src={images[0]}
            alt="Antler photo"
            fill
            className="object-contain"
            sizes="(max-width: 768px) 100vw, 800px"
            priority
          />
        </div>
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
          {images.map((url, index) => (
            <CarouselItem key={index} className="pl-2 md:pl-4 basis-full">
              <div className="relative aspect-[4/3] w-full rounded-xl overflow-hidden bg-muted">
                <Image
                  src={url}
                  alt={`Antler photo ${index + 1} of ${images.length}`}
                  fill
                  className="object-contain"
                  sizes="(max-width: 768px) 100vw, 800px"
                  priority={index === 0}
                />
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>

        {/* Desktop arrow controls - positioned inside the image area.
            z-10 keeps them above the landmark overlay canvas when both visible. */}
        <Button
          variant="secondary"
          size="icon"
          className="absolute left-2 top-1/2 z-10 -translate-y-1/2 h-10 w-10 rounded-full bg-background/80 backdrop-blur-sm shadow-md hover:bg-background hidden md:flex"
          onClick={scrollPrev}
          aria-label="Previous image"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          className="absolute right-2 top-1/2 z-10 -translate-y-1/2 h-10 w-10 rounded-full bg-background/80 backdrop-blur-sm shadow-md hover:bg-background hidden md:flex"
          onClick={scrollNext}
          aria-label="Next image"
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </Carousel>

      {/* Position indicator */}
      <div className="flex items-center justify-center gap-2 mt-2">
        {/* Dot indicators — outer button is a larger tap target;
            the visible dot inside stays small. */}
        <div className="flex">
          {images.map((_, index) => (
            <button
              key={index}
              onClick={() => api?.scrollTo(index)}
              className="grid place-items-center w-6 h-6"
              aria-label={`Go to image ${index + 1}`}
              aria-current={current === index ? 'true' : undefined}
            >
              <span
                className={cn(
                  'rounded-full transition-all duration-200',
                  current === index
                    ? 'bg-primary w-4 h-2'
                    : 'bg-muted-foreground/30 hover:bg-muted-foreground/60 w-2 h-2',
                )}
              />
            </button>
          ))}
        </div>
        {/* Numeric indicator */}
        <span className="text-sm text-muted-foreground ml-1">
          {current + 1} / {count}
        </span>
      </div>
    </div>
  )
}
