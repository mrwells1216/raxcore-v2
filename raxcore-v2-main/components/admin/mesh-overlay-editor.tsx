'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { 
  ChevronUp, 
  ChevronDown, 
  ChevronLeft, 
  ChevronRight,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Move,
  Crosshair,
  Check,
  Eye,
  EyeOff
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface MeshPoint {
  x: number // Image coordinate (pixels)
  y: number
}

export interface MeshSegment {
  id: string
  label: string
  points: MeshPoint[]
  confidence: number // 0-1
  type: 'beam' | 'tine' | 'spread' | 'circumference' | 'burr' | 'other'
}

export interface AntlerMesh {
  beams: MeshSegment[]
  tines: MeshSegment[]
  spreads: MeshSegment[]
  circumferences: MeshSegment[]
  burrs: MeshSegment[]
}

interface MeshOverlayEditorProps {
  imageUrl: string
  mesh: AntlerMesh
  onMeshChange: (mesh: AntlerMesh) => void
  onSave?: (mesh: AntlerMesh) => Promise<void>
  readOnly?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SEGMENT_COLORS: Record<MeshSegment['type'], { stroke: string; fill: string; label: string }> = {
  beam: { stroke: '#22c55e', fill: 'rgba(34, 197, 94, 0.15)', label: 'Main Beams' },
  tine: { stroke: '#3b82f6', fill: 'rgba(59, 130, 246, 0.15)', label: 'Tines' },
  spread: { stroke: '#f59e0b', fill: 'rgba(245, 158, 11, 0.15)', label: 'Spread' },
  circumference: { stroke: '#8b5cf6', fill: 'rgba(139, 92, 246, 0.15)', label: 'Circumferences' },
  burr: { stroke: '#ec4899', fill: 'rgba(236, 72, 153, 0.15)', label: 'Burrs' },
  other: { stroke: '#6b7280', fill: 'rgba(107, 114, 128, 0.15)', label: 'Other' },
}

const CONFIDENCE_COLORS = {
  high: '#22c55e',    // >= 0.8
  medium: '#f59e0b',  // >= 0.5
  low: '#ef4444',     // < 0.5
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return CONFIDENCE_COLORS.high
  if (confidence >= 0.5) return CONFIDENCE_COLORS.medium
  return CONFIDENCE_COLORS.low
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function MeshOverlayEditor({
  imageUrl,
  mesh,
  onMeshChange,
  onSave,
  readOnly = false,
}: MeshOverlayEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null)
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [showOverlay, setShowOverlay] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  // Load image dimensions
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.src = imageUrl
  }, [imageUrl])

  // Get all segments as flat array
  const getAllSegments = useCallback((): MeshSegment[] => {
    return [
      ...mesh.beams,
      ...mesh.tines,
      ...mesh.spreads,
      ...mesh.circumferences,
      ...mesh.burrs,
    ]
  }, [mesh])

  // Find segment by ID
  const findSegment = useCallback((id: string): { segment: MeshSegment; type: keyof AntlerMesh } | null => {
    for (const beam of mesh.beams) if (beam.id === id) return { segment: beam, type: 'beams' }
    for (const tine of mesh.tines) if (tine.id === id) return { segment: tine, type: 'tines' }
    for (const spread of mesh.spreads) if (spread.id === id) return { segment: spread, type: 'spreads' }
    for (const circ of mesh.circumferences) if (circ.id === id) return { segment: circ, type: 'circumferences' }
    for (const burr of mesh.burrs) if (burr.id === id) return { segment: burr, type: 'burrs' }
    return null
  }, [mesh])

  // Move selected segment or point
  const moveSelection = useCallback((dx: number, dy: number) => {
    if (!selectedSegmentId || readOnly) return

    const found = findSegment(selectedSegmentId)
    if (!found) return

    const { segment, type } = found
    const step = 2 / zoom // Scale step by zoom level

    const updatedSegment: MeshSegment = {
      ...segment,
      points: segment.points.map((p, i) => {
        // If a specific point is selected, only move that point
        if (selectedPointIndex !== null && i !== selectedPointIndex) return p
        return { x: p.x + dx * step, y: p.y + dy * step }
      }),
    }

    const updatedMesh: AntlerMesh = {
      ...mesh,
      [type]: mesh[type].map(s => s.id === selectedSegmentId ? updatedSegment : s),
    }

    onMeshChange(updatedMesh)
  }, [selectedSegmentId, selectedPointIndex, mesh, onMeshChange, findSegment, zoom, readOnly])

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedSegmentId || readOnly) return
      
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          moveSelection(0, -1)
          break
        case 'ArrowDown':
          e.preventDefault()
          moveSelection(0, 1)
          break
        case 'ArrowLeft':
          e.preventDefault()
          moveSelection(-1, 0)
          break
        case 'ArrowRight':
          e.preventDefault()
          moveSelection(1, 0)
          break
        case 'Escape':
          setSelectedSegmentId(null)
          setSelectedPointIndex(null)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedSegmentId, moveSelection, readOnly])

  // Handle pan drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || selectedSegmentId) return
    setIsDragging(true)
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
  }, [pan, selectedSegmentId])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
  }, [isDragging, dragStart])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  // Zoom controls
  const handleZoomIn = useCallback(() => setZoom(z => Math.min(z * 1.25, 4)), [])
  const handleZoomOut = useCallback(() => setZoom(z => Math.max(z / 1.25, 0.5)), [])
  const handleResetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  // Save handler
  const handleSave = useCallback(async () => {
    if (!onSave) return
    setIsSaving(true)
    try {
      await onSave(mesh)
    } finally {
      setIsSaving(false)
    }
  }, [mesh, onSave])

  // Render polyline for segment
  const renderSegment = (segment: MeshSegment) => {
    const colors = SEGMENT_COLORS[segment.type]
    const isSelected = selectedSegmentId === segment.id
    const confidenceColor = getConfidenceColor(segment.confidence)

    return (
      <g key={segment.id}>
        {/* Main polyline */}
        <polyline
          points={segment.points.map(p => `${p.x},${p.y}`).join(' ')}
          stroke={isSelected ? '#fff' : colors.stroke}
          strokeWidth={isSelected ? 3 : 2}
          fill="none"
          className={cn(
            'cursor-pointer transition-all',
            !readOnly && 'hover:stroke-white hover:stroke-[3px]'
          )}
          onClick={(e) => {
            e.stopPropagation()
            if (!readOnly) {
              setSelectedSegmentId(segment.id)
              setSelectedPointIndex(null)
            }
          }}
          style={{
            filter: isSelected ? 'drop-shadow(0 0 4px rgba(255,255,255,0.8))' : undefined,
          }}
        />

        {/* Confidence indicator line (underneath) */}
        <polyline
          points={segment.points.map(p => `${p.x},${p.y}`).join(' ')}
          stroke={confidenceColor}
          strokeWidth={1}
          strokeDasharray="4,4"
          fill="none"
          opacity={0.6}
          style={{ pointerEvents: 'none' }}
        />

        {/* Control points (when selected) */}
        {isSelected && !readOnly && segment.points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={6}
            fill={selectedPointIndex === i ? '#fff' : colors.stroke}
            stroke="#fff"
            strokeWidth={2}
            className="cursor-move"
            onClick={(e) => {
              e.stopPropagation()
              setSelectedPointIndex(selectedPointIndex === i ? null : i)
            }}
          />
        ))}

        {/* Label */}
        {segment.points.length > 0 && (
          <text
            x={segment.points[0].x}
            y={segment.points[0].y - 10}
            fill={colors.stroke}
            fontSize={12}
            fontWeight={500}
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            {segment.label}
          </text>
        )}
      </g>
    )
  }

  const selectedSegment = selectedSegmentId ? findSegment(selectedSegmentId)?.segment : null

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleZoomOut}
            className="h-9 w-9 p-0"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Badge variant="secondary" className="font-mono text-xs">
            {Math.round(zoom * 100)}%
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={handleZoomIn}
            className="h-9 w-9 p-0"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetView}
            className="h-9 px-3"
          >
            <RotateCcw className="h-4 w-4 mr-1" />
            Reset
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={showOverlay ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowOverlay(!showOverlay)}
            className="h-9 px-3"
          >
            {showOverlay ? <Eye className="h-4 w-4 mr-1" /> : <EyeOff className="h-4 w-4 mr-1" />}
            Overlay
          </Button>
          {onSave && !readOnly && (
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
              className="h-9 px-4"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(SEGMENT_COLORS).map(([type, colors]) => (
          <div key={type} className="flex items-center gap-1.5">
            <div 
              className="h-3 w-3 rounded-full" 
              style={{ backgroundColor: colors.stroke }}
            />
            <span className="text-xs text-muted-foreground">{colors.label}</span>
          </div>
        ))}
      </div>

      {/* Image + Overlay Container */}
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-lg border bg-muted cursor-grab active:cursor-grabbing"
        style={{ height: 500 }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={() => {
          setSelectedSegmentId(null)
          setSelectedPointIndex(null)
        }}
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
            transition: isDragging ? 'none' : 'transform 0.1s ease-out',
          }}
        >
          {/* Image */}
          <img
            src={imageUrl}
            alt="Antler mesh overlay"
            className="max-w-full h-auto select-none"
            style={{ display: 'block' }}
            draggable={false}
          />

          {/* SVG Overlay */}
          {showOverlay && imageSize.width > 0 && (
            <svg
              viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
              className="absolute top-0 left-0 w-full h-full"
              style={{ pointerEvents: 'none' }}
            >
              <g style={{ pointerEvents: 'auto' }}>
                {mesh.beams.map(renderSegment)}
                {mesh.tines.map(renderSegment)}
                {mesh.spreads.map(renderSegment)}
                {mesh.circumferences.map(renderSegment)}
                {mesh.burrs.map(renderSegment)}
              </g>
            </svg>
          )}
        </div>
      </div>

      {/* Selection Controls */}
      {selectedSegment && !readOnly && (
        <div className="rounded-lg border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h4 className="font-medium text-sm">{selectedSegment.label}</h4>
              <div className="flex items-center gap-2">
                <Badge 
                  variant="outline" 
                  className="text-xs"
                  style={{ borderColor: SEGMENT_COLORS[selectedSegment.type].stroke }}
                >
                  {selectedSegment.type}
                </Badge>
                <Badge 
                  variant="outline" 
                  className="text-xs"
                  style={{ borderColor: getConfidenceColor(selectedSegment.confidence) }}
                >
                  {Math.round(selectedSegment.confidence * 100)}% confidence
                </Badge>
                {selectedPointIndex !== null && (
                  <Badge variant="secondary" className="text-xs">
                    Point {selectedPointIndex + 1} of {selectedSegment.points.length}
                  </Badge>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedSegmentId(null)
                setSelectedPointIndex(null)
              }}
            >
              Done
            </Button>
          </div>

          {/* Nudge Controls */}
          <div className="flex items-center justify-center gap-1">
            <div className="grid grid-cols-3 gap-1">
              <div />
              <Button
                variant="outline"
                size="sm"
                className="h-10 w-10 p-0"
                onClick={() => moveSelection(0, -1)}
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <div />
              <Button
                variant="outline"
                size="sm"
                className="h-10 w-10 p-0"
                onClick={() => moveSelection(-1, 0)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-10 w-10 p-0"
              >
                <Move className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-10 w-10 p-0"
                onClick={() => moveSelection(1, 0)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <div />
              <Button
                variant="outline"
                size="sm"
                className="h-10 w-10 p-0"
                onClick={() => moveSelection(0, 1)}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              <div />
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Use arrow keys or buttons to nudge. Click points to move individually.
          </p>
        </div>
      )}

      {/* Segment List */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium">All Segments ({getAllSegments().length})</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-[200px] overflow-y-auto">
          {getAllSegments().map(segment => (
            <button
              key={segment.id}
              type="button"
              className={cn(
                'flex items-center gap-2 p-2 rounded-lg border text-left transition-colors',
                'hover:bg-accent hover:border-accent-foreground/20',
                selectedSegmentId === segment.id && 'bg-accent border-primary'
              )}
              onClick={() => {
                if (!readOnly) {
                  setSelectedSegmentId(segment.id)
                  setSelectedPointIndex(null)
                }
              }}
            >
              <div 
                className="h-3 w-3 rounded-full shrink-0"
                style={{ backgroundColor: getConfidenceColor(segment.confidence) }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{segment.label}</p>
                <p className="text-[10px] text-muted-foreground">
                  {Math.round(segment.confidence * 100)}% conf
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo / Example Usage
// ─────────────────────────────────────────────────────────────────────────────

export function createEmptyMesh(): AntlerMesh {
  return {
    beams: [],
    tines: [],
    spreads: [],
    circumferences: [],
    burrs: [],
  }
}

export function createDemoMesh(): AntlerMesh {
  return {
    beams: [
      {
        id: 'beam-left',
        label: 'Left Main Beam',
        type: 'beam',
        confidence: 0.85,
        points: [
          { x: 200, y: 300 },
          { x: 180, y: 200 },
          { x: 150, y: 100 },
        ],
      },
      {
        id: 'beam-right',
        label: 'Right Main Beam',
        type: 'beam',
        confidence: 0.82,
        points: [
          { x: 400, y: 300 },
          { x: 420, y: 200 },
          { x: 450, y: 100 },
        ],
      },
    ],
    tines: [
      {
        id: 'g1-left',
        label: 'G1 Left',
        type: 'tine',
        confidence: 0.78,
        points: [
          { x: 190, y: 250 },
          { x: 170, y: 220 },
        ],
      },
      {
        id: 'g2-left',
        label: 'G2 Left',
        type: 'tine',
        confidence: 0.65,
        points: [
          { x: 175, y: 180 },
          { x: 140, y: 140 },
        ],
      },
    ],
    spreads: [
      {
        id: 'inside-spread',
        label: 'Inside Spread',
        type: 'spread',
        confidence: 0.72,
        points: [
          { x: 200, y: 300 },
          { x: 400, y: 300 },
        ],
      },
    ],
    circumferences: [
      {
        id: 'h1-left',
        label: 'H1 Left',
        type: 'circumference',
        confidence: 0.45,
        points: [
          { x: 195, y: 280 },
          { x: 205, y: 280 },
        ],
      },
    ],
    burrs: [
      {
        id: 'burr-left',
        label: 'Left Burr',
        type: 'burr',
        confidence: 0.9,
        points: [
          { x: 200, y: 310 },
        ],
      },
    ],
  }
}
