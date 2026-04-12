'use client'

import { useCallback, useRef, useState } from 'react'
import { Plus, X, ImagePlus, ChevronDown } from 'lucide-react'
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

// ─── Photo group types ────────────────────────────────────────────────────────

export type PhotoGroup = 'full_rack' | 'left_antler' | 'right_antler' | null

const GROUP_LABELS: Record<NonNullable<PhotoGroup>, string> = {
  full_rack:    'Full',
  left_antler:  'Left',
  right_antler: 'Right',
}

const GROUP_COLORS: Record<NonNullable<PhotoGroup>, string> = {
  full_rack:    'bg-primary/15 text-primary border-primary/30',
  left_antler:  'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
  right_antler: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GridImage {
  id: string
  url: string
  file?: File
  slotKey: GridSlotKey
  angleType: AngleType
  width: number
  height: number
  group?: PhotoGroup
}

interface PhotoGridUploaderProps {
  images: GridImage[]
  onChange: (images: GridImage[]) => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PhotoGridUploader({ images, onChange }: PhotoGridUploaderProps) {
  const addInputRef = useRef<HTMLInputElement>(null)
  const [activeGroupMenu, setActiveGroupMenu] = useState<string | null>(null)
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
    (id: string) => {
      setActiveGroupMenu(null)
      onChange(images.filter(img => img.id !== id))
    },
    [images, onChange]
  )

  const handleSetGroup = useCallback(
    (id: string, group: PhotoGroup) => {
      setActiveGroupMenu(null)
      onChange(images.map(img => img.id === id ? { ...img, group } : img))
    },
    [images, onChange]
  )

  return (
    <div className="space-y-3" onClick={() => setActiveGroupMenu(null)}>

      {/* Empty state — large tap target */}
      {images.length === 0 && (
        <button
          type="button"
          onClick={() => addInputRef.current?.click()}
          className={cn(
            'w-full rounded-2xl border-2 border-dashed border-primary/25 bg-primary/5',
            'hover:border-primary/45 hover:bg-primary/8 active:bg-primary/12',
            'transition-all py-10 px-6 flex flex-col items-center gap-3',
            'touch-manipulation cursor-pointer'
          )}
        >
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/15 text-primary">
            <ImagePlus className="h-7 w-7" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-semibold text-foreground">Drop photos here or tap to upload</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Front, left, and right angles give the best results
            </p>
          </div>
        </button>
      )}

      {/* Filled state — photo tray */}
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {images.map((image, idx) => (
            <PhotoTile
              key={image.id}
              image={image}
              index={idx}
              isMenuOpen={activeGroupMenu === image.id}
              onToggleMenu={(e) => {
                e.stopPropagation()
                setActiveGroupMenu(prev => prev === image.id ? null : image.id)
              }}
              onSetGroup={handleSetGroup}
              onRemove={handleRemove}
            />
          ))}

          {/* Inline add-more tile */}
          {canAddMore && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); addInputRef.current?.click() }}
              className={cn(
                'relative aspect-square rounded-xl overflow-hidden',
                'border-2 border-dashed border-border/40 bg-secondary/20',
                'flex flex-col items-center justify-center gap-1.5',
                'text-muted-foreground hover:text-foreground hover:border-border/60 hover:bg-secondary/40',
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
          {canAddMore ? ' \u2014 tap a photo to assign an angle' : ''}
        </p>
      )}
    </div>
  )
}

// ─── PhotoTile ────────────────────────────────────────────────────────────────

function PhotoTile({ image, index, isMenuOpen, onToggleMenu, onSetGroup, onRemove }: {
  image: GridImage
  index: number
  isMenuOpen: boolean
  onToggleMenu: (e: React.MouseEvent) => void
  onSetGroup: (id: string, group: PhotoGroup) => void
  onRemove: (id: string) => void
}) {
  const label =
    image.angleType === 'front' ? 'Front' :
    image.angleType === 'left'  ? 'Left'  :
    image.angleType === 'right' ? 'Right' :
    image.angleType === 'back'  ? 'Back'  :
    `Photo ${index + 1}`

  return (
    <div className="relative aspect-square rounded-xl overflow-visible">
      {/* Image */}
      <div className="absolute inset-0 rounded-xl overflow-hidden border border-border/40">
        <img
          src={image.url}
          alt={label}
          className="w-full h-full object-cover"
        />
        {/* Bottom label bar */}
        <div className="absolute bottom-0 inset-x-0 px-1.5 py-1 bg-gradient-to-t from-black/75 to-transparent">
          <span className="text-[10px] text-white/90 font-medium leading-none block">{label}</span>
        </div>
      </div>

      {/* Group badge (top-left) */}
      {image.group && (
        <div className={cn(
          'absolute top-1 left-1 z-10 px-1.5 py-0.5 rounded-md text-[9px] font-semibold border',
          GROUP_COLORS[image.group]
        )}>
          {GROUP_LABELS[image.group]}
        </div>
      )}

      {/* Assign group button (bottom-right corner, overlapping tile) */}
      <button
        type="button"
        onClick={onToggleMenu}
        className={cn(
          'absolute bottom-1 right-1 z-10 h-6 w-6 rounded-full flex items-center justify-center',
          'bg-black/60 hover:bg-black/80 text-white/80 hover:text-white transition-colors touch-manipulation',
          isMenuOpen && 'bg-black/80 text-white'
        )}
        aria-label="Assign group"
      >
        <ChevronDown className="h-3 w-3" />
      </button>

      {/* Remove button (top-right) */}
      <button
        type="button"
        className="absolute top-1 right-1 z-10 h-5 w-5 rounded-full bg-black/60 hover:bg-destructive/90 text-white flex items-center justify-center transition-colors touch-manipulation"
        onClick={(e) => { e.stopPropagation(); onRemove(image.id) }}
        aria-label={`Remove ${label}`}
      >
        <X className="h-3 w-3" />
      </button>

      {/* Group assignment popover */}
      {isMenuOpen && (
        <div
          className="absolute bottom-8 right-0 z-50 bg-card border border-border rounded-xl shadow-xl overflow-hidden min-w-[130px]"
          onClick={e => e.stopPropagation()}
        >
          <div className="px-2.5 py-1.5 border-b border-border/60">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Assign to</span>
          </div>
          {(['full_rack', 'left_antler', 'right_antler'] as NonNullable<PhotoGroup>[]).map(group => (
            <button
              key={group}
              type="button"
              onClick={() => onSetGroup(image.id, image.group === group ? null : group)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-left transition-colors',
                image.group === group
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-secondary/60 text-foreground'
              )}
            >
              <span className={cn(
                'h-2 w-2 rounded-full shrink-0',
                group === 'full_rack'    ? 'bg-primary'    :
                group === 'left_antler'  ? 'bg-blue-500'   :
                                           'bg-amber-500'
              )} />
              {GROUP_LABELS[group]}
              {image.group === group && (
                <span className="ml-auto text-[10px] text-muted-foreground">active</span>
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onSetGroup(image.id, null)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-secondary/60 border-t border-border/40 transition-colors"
          >
            <X className="h-3 w-3" />
            Remove group
          </button>
        </div>
      )}
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
          group: null,
        })
      }
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = url
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}
