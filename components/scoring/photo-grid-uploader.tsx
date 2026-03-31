'use client'

import { useCallback, useRef } from 'react'
import { Plus, X, Camera } from 'lucide-react'
import { SUPPORTED_IMAGE_TYPES, MAX_FILE_SIZE } from '@/lib/constants'
import type { AngleType } from '@/lib/types'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ─── Grid slot definition ───────────────────────────────────────────────────

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

// Map each grid slot to the closest AngleType the scoring pipeline understands
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

const GRID_SLOTS: { key: GridSlotKey; label: string }[] = [
  { key: 'left_top_angle',     label: 'Left Top Angle' },
  { key: 'centered_top_angle', label: 'Centered Top' },
  { key: 'right_top_angle',    label: 'Right Top Angle' },
  { key: 'left_side',          label: 'Left Side' },
  { key: 'front_center',       label: 'Front Center' },
  { key: 'right_side',         label: 'Right Side' },
  { key: 'left_bottom_angle',  label: 'Left Bottom' },
  { key: 'front_bottom_angle', label: 'Front Bottom' },
  { key: 'right_bottom_angle', label: 'Right Bottom' },
]

// ─── Types ──────────────────────────────────────────────────────────────────

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

// ─── Component ──────────────────────────────────────────────────────────────

export function PhotoGridUploader({ images, onChange }: PhotoGridUploaderProps) {
  // Map slotKey → image for O(1) lookup
  const slotMap = new Map(images.map(img => [img.slotKey, img]))

  const handleSlotClick = useCallback((slot: GridSlotKey, inputRef: HTMLInputElement | null) => {
    inputRef?.click()
  }, [])

  const handleFileChange = useCallback(
    async (slot: GridSlotKey, e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return

      if (!SUPPORTED_IMAGE_TYPES.includes(file.type as typeof SUPPORTED_IMAGE_TYPES[number])) {
        toast.error(`${file.name} is not a supported format`)
        return
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name} exceeds 20MB limit`)
        return
      }

      const gridImage = await readFileAsGridImage(file, slot)
      const next = images.filter(img => img.slotKey !== slot)
      onChange([...next, gridImage])
    },
    [images, onChange]
  )

  const handleRemove = useCallback(
    (slot: GridSlotKey) => {
      onChange(images.filter(img => img.slotKey !== slot))
    },
    [images, onChange]
  )

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {GRID_SLOTS.map(({ key, label }) => {
          const image = slotMap.get(key)
          return (
            <GridCell
              key={key}
              slotKey={key}
              label={label}
              image={image ?? null}
              onSelect={handleSlotClick}
              onFileChange={handleFileChange}
              onRemove={handleRemove}
            />
          )
        })}
      </div>

      <p className="text-xs text-center text-muted-foreground">
        Tap any box to add a photo for that angle
      </p>
    </div>
  )
}

// ─── GridCell ────────────────────────────────────────────────────────────────

interface GridCellProps {
  slotKey: GridSlotKey
  label: string
  image: GridImage | null
  onSelect: (slot: GridSlotKey, input: HTMLInputElement | null) => void
  onFileChange: (slot: GridSlotKey, e: React.ChangeEvent<HTMLInputElement>) => void
  onRemove: (slot: GridSlotKey) => void
}

function GridCell({ slotKey, label, image, onSelect, onFileChange, onRemove }: GridCellProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const isFrontCenter = slotKey === 'front_center'
  const isHighPriority = slotKey === 'front_center' || slotKey === 'left_side' || slotKey === 'right_side'

  return (
    <div
      className={cn(
        'relative aspect-square rounded-xl overflow-hidden transition-all',
        'border cursor-pointer select-none',
        image
          ? 'border-border/50'
          : isHighPriority
            ? 'border-primary/40 border-dashed bg-primary/5 hover:bg-primary/10 hover:border-primary/70'
            : 'border-border/60 border-dashed bg-secondary/30 hover:bg-secondary/60 hover:border-border',
      )}
      onClick={() => onSelect(slotKey, inputRef.current)}
      role="button"
      aria-label={image ? `Replace ${label}` : `Add ${label}`}
    >
      {/* Hidden file input per slot */}
      <input
        ref={inputRef}
        type="file"
        accept={SUPPORTED_IMAGE_TYPES.join(',')}
        className="sr-only"
        onChange={(e) => onFileChange(slotKey, e)}
      />

      {image ? (
        // ── Filled state ──────────────────────────────────────────────────
        <>
          <img
            src={image.url}
            alt={label}
            className="w-full h-full object-cover"
          />
          {/* Label badge */}
          <div className="absolute bottom-0 inset-x-0 px-1.5 py-1 bg-gradient-to-t from-black/70 to-transparent">
            <span className="text-[10px] text-white font-medium leading-none block truncate">
              {label}
            </span>
          </div>
          {/* Remove button */}
          <button
            type="button"
            className={cn(
              'absolute top-1 right-1 h-6 w-6 rounded-full',
              'bg-black/60 hover:bg-destructive/90 text-white',
              'flex items-center justify-center transition-colors',
              'touch-manipulation'
            )}
            onClick={(e) => { e.stopPropagation(); onRemove(slotKey) }}
            aria-label={`Remove ${label}`}
          >
            <X className="h-3 w-3" />
          </button>
        </>
      ) : (
        // ── Empty state ───────────────────────────────────────────────────
        <div className="flex flex-col items-center justify-center h-full gap-1 px-1 text-center">
          <div className={cn(
            'flex items-center justify-center rounded-full w-7 h-7',
            isHighPriority ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'
          )}>
            {isFrontCenter ? (
              <Camera className="h-3.5 w-3.5" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
          </div>
          <span className={cn(
            'text-[10px] font-medium leading-tight',
            isHighPriority ? 'text-primary/80' : 'text-muted-foreground'
          )}>
            {label}
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
