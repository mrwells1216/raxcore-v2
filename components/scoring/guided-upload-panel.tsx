'use client'

import { useCallback, useRef, useState } from 'react'
import { Plus, X, ImagePlus, Star, Upload } from 'lucide-react'
import { SUPPORTED_IMAGE_TYPES, MAX_FILE_SIZE } from '@/lib/constants'
import type { AngleType } from '@/lib/types'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { GridImage, GridSlotKey, PhotoGroup } from './photo-grid-uploader'

// ─── Section definitions ─────────────────────────────────────────────────────

type UploadSection = 'full_rack' | 'left_antler' | 'right_antler' | 'detail'

interface SectionConfig {
  key: UploadSection
  label: string
  description: string
  required: boolean
  accent: string
  dotColor: string
  defaultSlot: GridSlotKey
  angleType: AngleType
}

const SECTIONS: SectionConfig[] = [
  {
    key: 'full_rack',
    label: 'Full Rack',
    description: 'Front view showing both antlers',
    required: true,
    accent: 'border-primary/30 bg-primary/5',
    dotColor: 'bg-primary',
    defaultSlot: 'front_center',
    angleType: 'front',
  },
  {
    key: 'left_antler',
    label: 'Left Antler',
    description: 'Side view of left antler',
    required: true,
    accent: 'border-blue-500/25 bg-blue-500/5',
    dotColor: 'bg-blue-500',
    defaultSlot: 'left_side',
    angleType: 'left',
  },
  {
    key: 'right_antler',
    label: 'Right Antler',
    description: 'Side view of right antler',
    required: true,
    accent: 'border-amber-500/25 bg-amber-500/5',
    dotColor: 'bg-amber-500',
    defaultSlot: 'right_side',
    angleType: 'right',
  },
  {
    key: 'detail',
    label: 'Optional Detail',
    description: 'Close-ups of tines, bases, or abnormalities',
    required: false,
    accent: 'border-border/40 bg-secondary/20',
    dotColor: 'bg-muted-foreground',
    defaultSlot: 'centered_top_angle',
    angleType: 'other' as AngleType, // detail shots map to 'other' angle type
  },
]

// ─── Types ───────────────────────────────────────────────────────────────────

interface SectionImage extends GridImage {
  section: UploadSection
  isBest?: boolean
}

interface GuidedUploadPanelProps {
  /** Callback when images change - outputs GridImage[] for scoring compatibility */
  onChange: (images: GridImage[]) => void
  /** Initial images to populate */
  initialImages?: GridImage[]
}

// ─── Component ───────────────────────────────────────────────────────────────

export function GuidedUploadPanel({ onChange, initialImages = [] }: GuidedUploadPanelProps) {
  // Convert initial GridImages to SectionImages
  const [sectionImages, setSectionImages] = useState<SectionImage[]>(() =>
    initialImages.map(img => ({
      ...img,
      section: groupToSection(img.group),
      isBest: false,
    }))
  )

  const inputRefs = useRef<Record<UploadSection, HTMLInputElement | null>>({
    full_rack: null,
    left_antler: null,
    right_antler: null,
    detail: null,
  })

  // Sync changes to parent
  const syncToParent = useCallback((images: SectionImage[]) => {
    const gridImages: GridImage[] = images.map(img => ({
      id: img.id,
      url: img.url,
      file: img.file,
      slotKey: img.slotKey,
      angleType: img.angleType,
      width: img.width,
      height: img.height,
      group: sectionToGroup(img.section),
    }))
    onChange(gridImages)
  }, [onChange])

  const handleAddFiles = useCallback(
    async (section: UploadSection, e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      e.target.value = ''
      if (!files.length) return

      const config = SECTIONS.find(s => s.key === section)!
      const newImages: SectionImage[] = []

      for (const file of files) {
        if (!SUPPORTED_IMAGE_TYPES.includes(file.type as typeof SUPPORTED_IMAGE_TYPES[number])) {
          toast.error(`${file.name} is not a supported format`)
          continue
        }
        if (file.size > MAX_FILE_SIZE) {
          toast.error(`${file.name} exceeds 20MB limit`)
          continue
        }

        const img = await readFileAsSectionImage(file, section, config)
        newImages.push(img)
      }

      if (newImages.length) {
        setSectionImages(prev => {
          const updated = [...prev, ...newImages]
          syncToParent(updated)
          return updated
        })
      }
    },
    [syncToParent]
  )

  const handleRemove = useCallback(
    (id: string) => {
      setSectionImages(prev => {
        const updated = prev.filter(img => img.id !== id)
        syncToParent(updated)
        return updated
      })
    },
    [syncToParent]
  )

  const handleToggleBest = useCallback(
    (id: string, section: UploadSection) => {
      setSectionImages(prev => {
        const updated = prev.map(img => {
          if (img.section === section) {
            return { ...img, isBest: img.id === id ? !img.isBest : false }
          }
          return img
        })
        syncToParent(updated)
        return updated
      })
    },
    [syncToParent]
  )

  const getImagesForSection = (section: UploadSection) =>
    sectionImages.filter(img => img.section === section)

  const requiredSectionsFilled = SECTIONS
    .filter(s => s.required)
    .every(s => getImagesForSection(s.key).length > 0)

  return (
    <div className="space-y-4">
      {/* Section cards */}
      {SECTIONS.map(section => {
        const images = getImagesForSection(section.key)
        const isEmpty = images.length === 0

        return (
          <div
            key={section.key}
            className={cn(
              'rounded-xl border p-4 transition-all',
              section.accent,
              isEmpty && 'border-dashed'
            )}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', section.dotColor)} />
                <div>
                  <h3 className="text-sm font-semibold text-foreground leading-none">
                    {section.label}
                    {section.required && (
                      <span className="text-destructive ml-1">*</span>
                    )}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{section.description}</p>
                </div>
              </div>
              {images.length > 0 && (
                <span className="text-xs font-medium text-muted-foreground">
                  {images.length} photo{images.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Empty state */}
            {isEmpty && (
              <button
                type="button"
                onClick={() => inputRefs.current[section.key]?.click()}
                className={cn(
                  'w-full rounded-lg border-2 border-dashed py-6 px-4',
                  'flex flex-col items-center gap-2',
                  'text-muted-foreground hover:text-foreground hover:border-border',
                  'transition-all touch-manipulation cursor-pointer',
                  'border-border/30 hover:bg-secondary/30'
                )}
              >
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-secondary/50">
                  <Upload className="h-5 w-5" />
                </div>
                <span className="text-xs font-medium">Tap to add photos</span>
              </button>
            )}

            {/* Image grid */}
            {!isEmpty && (
              <div className="space-y-2">
                <div className="grid grid-cols-4 gap-2">
                  {images.map(img => (
                    <div
                      key={img.id}
                      className="relative aspect-square rounded-lg overflow-hidden group"
                    >
                      <img
                        src={img.url}
                        alt={section.label}
                        className="w-full h-full object-cover"
                      />

                      {/* Best badge */}
                      {img.isBest && (
                        <div className="absolute top-1 left-1 z-10 px-1.5 py-0.5 rounded bg-primary text-primary-foreground text-[9px] font-bold flex items-center gap-0.5">
                          <Star className="h-2.5 w-2.5 fill-current" />
                          Best
                        </div>
                      )}

                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                        {/* Mark as best */}
                        <button
                          type="button"
                          onClick={() => handleToggleBest(img.id, section.key)}
                          className={cn(
                            'h-7 w-7 rounded-full flex items-center justify-center touch-manipulation transition-colors',
                            img.isBest
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-white/20 text-white hover:bg-white/30'
                          )}
                          aria-label={img.isBest ? 'Unmark as best' : 'Mark as best'}
                        >
                          <Star className={cn('h-3.5 w-3.5', img.isBest && 'fill-current')} />
                        </button>

                        {/* Remove */}
                        <button
                          type="button"
                          onClick={() => handleRemove(img.id)}
                          className="h-7 w-7 rounded-full bg-destructive/80 hover:bg-destructive text-white flex items-center justify-center touch-manipulation transition-colors"
                          aria-label="Remove"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Add more tile */}
                  <button
                    type="button"
                    onClick={() => inputRefs.current[section.key]?.click()}
                    className={cn(
                      'aspect-square rounded-lg border-2 border-dashed border-border/40',
                      'flex flex-col items-center justify-center gap-1',
                      'text-muted-foreground hover:text-foreground hover:border-border/60 hover:bg-secondary/40',
                      'transition-all touch-manipulation cursor-pointer'
                    )}
                  >
                    <Plus className="h-4 w-4" />
                    <span className="text-[9px] font-medium">Add</span>
                  </button>
                </div>

                {images.length > 1 && (
                  <p className="text-[10px] text-muted-foreground text-center">
                    Tap the star to mark your best photo
                  </p>
                )}
              </div>
            )}

            {/* Hidden input */}
            <input
              ref={el => { inputRefs.current[section.key] = el }}
              type="file"
              accept={SUPPORTED_IMAGE_TYPES.join(',')}
              multiple
              className="sr-only"
              onChange={(e) => handleAddFiles(section.key, e)}
            />
          </div>
        )
      })}

      {/* Coverage status */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          {SECTIONS.filter(s => s.required).map(section => {
            const hasPhotos = getImagesForSection(section.key).length > 0
            return (
              <div key={section.key} className="flex items-center gap-1.5">
                <div className={cn(
                  'h-2 w-2 rounded-full transition-colors',
                  hasPhotos ? section.dotColor : 'bg-border'
                )} />
                <span className={cn(
                  'text-[10px] font-medium transition-colors',
                  hasPhotos ? 'text-foreground' : 'text-muted-foreground'
                )}>
                  {section.label.split(' ')[0]}
                </span>
              </div>
            )
          })}
        </div>
        <span className="text-[10px] text-muted-foreground">
          {sectionImages.length} total
        </span>
      </div>

      {!requiredSectionsFilled && sectionImages.length > 0 && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2.5 text-xs text-amber-600 dark:text-amber-400">
          Add photos to all required sections for best accuracy
        </div>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function groupToSection(group: PhotoGroup | undefined): UploadSection {
  if (group === 'full_rack') return 'full_rack'
  if (group === 'left_antler') return 'left_antler'
  if (group === 'right_antler') return 'right_antler'
  return 'full_rack' // Default
}

function sectionToGroup(section: UploadSection): PhotoGroup {
  if (section === 'full_rack') return 'full_rack'
  if (section === 'left_antler') return 'left_antler'
  if (section === 'right_antler') return 'right_antler'
  return null // detail has no group
}

function readFileAsSectionImage(
  file: File,
  section: UploadSection,
  config: SectionConfig
): Promise<SectionImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const url = e.target?.result as string
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        resolve({
          id: crypto.randomUUID(),
          url,
          file,
          slotKey: config.defaultSlot,
          angleType: config.angleType,
          width: img.width,
          height: img.height,
          group: sectionToGroup(section),
          section,
          isBest: false,
        })
      }
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = url
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}
