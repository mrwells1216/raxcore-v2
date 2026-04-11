'use client'

import { useCallback, useRef } from 'react'
import { Plus, X, ImagePlus } from 'lucide-react'
import { SUPPORTED_IMAGE_TYPES, MAX_FILE_SIZE } from '@/lib/constants'
import type { AngleType } from '@/lib/types'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ─── Slot definitions (kept for pipeline compatibility) ──────────────────────

export type GridSlotKey =
  | 'left_top_angle'
  | 'centered_top_angle'
  | 'right_top_angle'
  | 'left_side'
  | 'front_center'
  | 'right_side'
  | 'left_bottom_angle'
  | 'front_bottom_angle'
  | 'right_bottom_angle'

export const GRID_SLOT_TO_ANGLE_TYPE: Record<GridSlotKey, AngleType> = {
  left_top_angle:     'left',
  centered_top_angle: 'back',
  right_top_angle:    'right',
  left_side:          'left',
  front_center:       'front',
  right_side:         'right',
  left_bottom_angle:  'left',
  front_bottom_angle: 'front',
  right_bottom_angle: 'right',
}

// Priority order for auto-assigning slots to uploaded photos
const SLOT_POOL: GridSlotKey[] = [
  'front_center',
  'left_side',
  'right_side',
  'centered_top_angle',
  'left_top_angle',
  'right_top_angle',
  'left_bottom_angle',
  'front_bottom_angle',
  'right_bottom_angle',
]

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GridImage {
  id: string
  url: string
  file?: File
  slotKey: GridSlotKey
  angleType: AngleType
  width: number
  height: number
}

interface PhotoGridUploaderProps {
  images: GridImage[]
  onChange: (images: GridImage[]) => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PhotoGridUploader({ images, onChange }: PhotoGridUploaderProps) {
  const addInputRef = useRef<HTMLInputElement>(null)
  const canAddMore = images.length < SLOT_POOL.length

  const handleAddFiles = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      e.target.value = ''
      if (!files.length) return

      const newImages: GridImage[] = []
      const usedSlots = new Set(images.map(img => img.slotKey))

      for (const file of files) {
        if (!SUPPORTED_IMAGE_TYPES.includes(file.type as typeof SUPPORTED_IMAGE_TYPES[number])) {
          toast.error(`${file.name} is not a supported format`)
          continue
        }
        if (file.size > MAX_FILE_SIZE) {
          toast.error(`${file.name} exceeds 20MB limit`)
          continue
        }
        const slot = SLOT_POOL.find(s => !usedSlots.has(s)) ?? SLOT_POOL[(images.length + newImages.length) % SLOT_POOL.length]
        usedSlots.add(slot)
        const img = await readFileAsGridImage(file, slot)
        newImages.push(img)
      }

      if (newImages.length) onChange([...images, ...newImages])
    },
    [images, onChange]
  )

  const handleRemove = useCallback(
    (id: string) => onChange(images.filter(img => img.id !== id)),
    [images, onChange]
  )

  return (
    <div className="space-y-3">

      {/* Empty state — large tap target */}
      {images.length === 0 && (
        <button
          type="button"
          onClick={() => addInputRef.current?.click()}
          className={cn(
            'w-full rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5',
            'hover:border-primary/50 hover:bg-primary/10 active:bg-primary/15',
            'transition-all py-10 px-6 flex flex-col items-center gap-3',
            'touch-manipulation cursor-pointer'
          )}
        >
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/15 text-primary">
            <ImagePlus className="h-7 w-7" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-semibold text-foreground">Add buck photos</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Front, left, and right angles give the best results
            </p>
          </div>
        </button>
      )}

      {/* Filled state — thumbnail tray */}
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {images.map((image, idx) => (
            <PhotoTile
              key={image.id}
              image={image}
              index={idx}
              onRemove={handleRemove}
            />
          ))}

          {/* Inline add-more tile */}
          {canAddMore && (
            <button
              type="button"
              onClick={() => addInputRef.current?.click()}
              className={cn(
                'relative aspect-square rounded-xl overflow-hidden',
                'border-2 border-dashed border-border/50 bg-secondary/20',
                'flex flex-col items-center justify-center gap-1.5',
                'text-muted-foreground hover:text-foreground hover:border-border hover:bg-secondary/40',
                'transition-all touch-manipulation cursor-pointer'
              )}
            >
              <Plus className="h-5 w-5" />
              <span className="text-[10px] font-medium">Add more</span>
            </button>
          )}
        </div>
      )}

      {/* Hidden multi-file input */}
      <input
        ref={addInputRef}
        type="file"
        accept={SUPPORTED_IMAGE_TYPES.join(',')}
        multiple
        className="sr-only"
        onChange={handleAddFiles}
      />

      {images.length > 0 && (
        <p className="text-xs text-center text-muted-foreground">
          {images.length} photo{images.length !== 1 ? 's' : ''} added
          {canAddMore ? ' — tap "Add more" for additional angles' : ''}
        </p>
      )}
    </div>
  )
}

// ─── PhotoTile ────────────────────────────────────────────────────────────────

function PhotoTile({ image, index, onRemove }: {
  image: GridImage
  index: number
  onRemove: (id: string) => void
}) {
  const label =
    image.angleType === 'front' ? 'Front' :
    image.angleType === 'left'  ? 'Left'  :
    image.angleType === 'right' ? 'Right' :
    image.angleType === 'back'  ? 'Back'  :
    `Photo ${index + 1}`

  return (
    <div className="relative aspect-square rounded-xl overflow-hidden border border-border/40">
      <img
        src={image.url}
        alt={label}
        className="w-full h-full object-cover"
      />
      <div className="absolute bottom-0 inset-x-0 px-1.5 py-1 bg-gradient-to-t from-black/70 to-transparent">
        <span className="text-[10px] text-white font-medium leading-none block">{label}</span>
      </div>
      <button
        type="button"
        className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 hover:bg-destructive/90 text-white flex items-center justify-center transition-colors touch-manipulation"
        onClick={() => onRemove(image.id)}
        aria-label={`Remove ${label}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readFileAsGridImage(file: File, slot: GridSlotKey): Promise<GridImage> {
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
          slotKey: slot,
          angleType: GRID_SLOT_TO_ANGLE_TYPE[slot],
          width: img.width,
          height: img.height,
        })
      }
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = url
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}
