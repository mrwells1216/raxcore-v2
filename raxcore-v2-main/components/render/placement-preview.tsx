'use client'

import { useState, useRef, useCallback, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera, Environment } from '@react-three/drei'
import * as THREE from 'three'
import Image from 'next/image'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Home,
  ImageIcon,
  Move,
  ZoomIn,
  Upload,
  Trash2,
  ChevronDown,
  AlertCircle,
  Settings2,
} from 'lucide-react'
import {
  WALL_TONE_COLORS,
  PLACEMENT_PRESETS,
  DEFAULT_PLACEMENT_CONFIG,
  ensurePlacementConfig,
  geometryToMeshParams,
  buildBeamTubeGeometry,
  buildTineGeometry,
  buildBurrGeometry,
  buildSkullPlateGeometry,
  sampleBeamAt,
  DEFAULT_RENDER_CONFIG,
  ensureRenderConfig,
  type RenderConfig,
  type BeamCurve,
  type TineSpec,
  type BurrSpec,
  type SkullPlateSpec,
  type MaterialHints,
  type AntlerMeshParams,
} from '@/lib/render/adapter'
import type { PlacementConfig, PlacementPreviewMode, WallTone, AntlerGeometry, RenderSettings } from '@/lib/types'

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlacementPreviewProps {
  /** Current placement config */
  config: PlacementConfig
  /** Callback when config changes */
  onConfigChange: (updates: Partial<PlacementConfig>) => void
  /** Geometry for the antler rack */
  geometry: AntlerGeometry
  /** Render config for the rack */
  renderConfig?: RenderConfig
  /** Render settings */
  settings?: RenderSettings
  /** Show controls panel */
  showControls?: boolean
}

interface WallBackdropProps {
  wallTone: WallTone
  horizontalOffset: number
  verticalOffset: number
  showMountHint: boolean
  shadowIntensity: number
}

// ─── Antler Material Hook ────────────────────────────────────────────────────

function useAntlerMaterial(
  hints: MaterialHints,
  wireframe: boolean,
  position: 'base' | 'mid' | 'tip' | 'burr' = 'base'
) {
  return useMemo(() => {
    const colorMap: Record<typeof position, string> = {
      base: hints.baseColor,
      mid: hints.baseColor,
      tip: hints.tipColor,
      burr: hints.burrColor,
    }
    
    const roughnessMap: Record<typeof position, number> = {
      base: hints.roughnessBase,
      mid: (hints.roughnessBase + hints.roughnessTip) / 2,
      tip: hints.roughnessTip,
      burr: hints.roughnessBase + 0.1,
    }

    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(colorMap[position]),
      roughness: roughnessMap[position],
      metalness: 0.02,
      wireframe,
      envMapIntensity: 0.4,
    })
  }, [hints, wireframe, position])
}

function useGradientAntlerMaterial(hints: MaterialHints, wireframe: boolean) {
  return useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(hints.baseColor),
      roughness: (hints.roughnessBase + hints.roughnessTip) / 2,
      metalness: 0.02,
      wireframe,
      envMapIntensity: 0.5,
    })
  }, [hints, wireframe])
}

// ─── Rack Mesh Components ────────────────────────────────────────────────────

function BeamMesh({ beam, hints, wireframe }: { beam: BeamCurve; hints: MaterialHints; wireframe: boolean }) {
  const geo = useMemo(() => buildBeamTubeGeometry(beam, 56, 12), [beam])
  const material = useGradientAntlerMaterial(hints, wireframe)
  return <mesh geometry={geo} material={material} castShadow receiveShadow />
}

function TineMesh({ spec, beam, hints, wireframe }: { spec: TineSpec; beam: BeamCurve; hints: MaterialHints; wireframe: boolean }) {
  const material = useAntlerMaterial(hints, wireframe, 'mid')
  const { geo, position, quaternion } = useMemo(() => {
    const { position, tangent, radius: beamRadius } = sampleBeamAt(beam, spec.beamT)
    const geo = buildTineGeometry(spec)
    const up = new THREE.Vector3(0, 1, 0)
    const dir = spec.localDir.clone().normalize()
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir)
    const surfaceOffset = dir.clone().multiplyScalar(beamRadius * 0.3)
    const finalPos = position.clone().add(surfaceOffset)
    return { geo, position: finalPos, quaternion: quat }
  }, [spec, beam])

  return <mesh geometry={geo} material={material} position={position} quaternion={quaternion} castShadow />
}

function BurrMesh({ spec, hints, wireframe }: { spec: BurrSpec; hints: MaterialHints; wireframe: boolean }) {
  const geo = useMemo(() => buildBurrGeometry(spec), [spec])
  const material = useAntlerMaterial(hints, wireframe, 'burr')
  return <mesh geometry={geo} material={material} position={spec.center} castShadow />
}

function SkullConnector({ leftBurr, rightBurr, hints, wireframe, showPlate }: { leftBurr: BurrSpec; rightBurr: BurrSpec; hints: MaterialHints; wireframe: boolean; showPlate: boolean }) {
  const material = useAntlerMaterial(hints, wireframe, 'burr')
  const boneMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: '#E5D9C5', roughness: 0.8, metalness: 0, wireframe }), [wireframe])
  const distance = leftBurr.center.distanceTo(rightBurr.center)
  const midpoint = leftBurr.center.clone().lerp(rightBurr.center, 0.5)
  const connectorRadius = Math.min(leftBurr.radius, rightBurr.radius) * 0.5

  return (
    <mesh position={midpoint} material={showPlate ? boneMaterial : material} castShadow>
      <cylinderGeometry args={[connectorRadius, connectorRadius, distance * 0.95, 10]} />
    </mesh>
  )
}

function SkullPlateMesh({ spec }: { spec: SkullPlateSpec }) {
  const geo = useMemo(() => buildSkullPlateGeometry(spec), [spec])
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: '#E8DCC8', roughness: 0.85, metalness: 0 }), [])
  return <mesh geometry={geo} material={material} position={spec.center} castShadow receiveShadow />
}

// ─── Full Rack Scene ─────────────────────────────────────────────────────────

function AntlerRackScene({ params, wireframe }: { params: AntlerMeshParams; wireframe: boolean }) {
  const { materialHints, config } = params
  const showEuropeanMount = config.mountMode === 'european_mount'

  return (
    <group>
      <BeamMesh beam={params.leftBeam} hints={materialHints} wireframe={wireframe} />
      {params.leftTines.map((tine) => (
        <TineMesh key={tine.name + '-L'} spec={tine} beam={params.leftBeam} hints={materialHints} wireframe={wireframe} />
      ))}
      <BurrMesh spec={params.leftBurr} hints={materialHints} wireframe={wireframe} />

      <BeamMesh beam={params.rightBeam} hints={materialHints} wireframe={wireframe} />
      {params.rightTines.map((tine) => (
        <TineMesh key={tine.name + '-R'} spec={tine} beam={params.rightBeam} hints={materialHints} wireframe={wireframe} />
      ))}
      <BurrMesh spec={params.rightBurr} hints={materialHints} wireframe={wireframe} />

      <SkullConnector leftBurr={params.leftBurr} rightBurr={params.rightBurr} hints={materialHints} wireframe={wireframe} showPlate={showEuropeanMount} />
      {showEuropeanMount && params.skullPlate && <SkullPlateMesh spec={params.skullPlate} />}
    </group>
  )
}

// ─── Wall Backdrop 3D Component ──────────────────────────────────────────────

function WallBackdrop({ wallTone, horizontalOffset, verticalOffset, showMountHint, shadowIntensity }: WallBackdropProps) {
  const colors = WALL_TONE_COLORS[wallTone]
  
  const wallMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: new THREE.Color(colors.background),
    roughness: 0.9,
    metalness: 0.0,
  }), [colors.background])

  const bracketMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: new THREE.Color('#3A3A3A'),
    roughness: 0.4,
    metalness: 0.6,
  }), [])

  return (
    <group>
      {/* Main wall surface */}
      <mesh position={[0, 2, -1.5]} receiveShadow material={wallMaterial}>
        <planeGeometry args={[12, 8]} />
      </mesh>

      {/* Floor hint */}
      <mesh position={[0, -1.5, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[12, 6]} />
        <meshStandardMaterial color={colors.accent} roughness={0.95} metalness={0} />
      </mesh>

      {/* Mount bracket hint */}
      {showMountHint && (
        <group position={[horizontalOffset * 2, 2 + verticalOffset * 2, -1.4]}>
          <mesh material={bracketMaterial}>
            <boxGeometry args={[0.3, 0.15, 0.05]} />
          </mesh>
          <mesh position={[0, 0.05, 0.03]} material={bracketMaterial}>
            <cylinderGeometry args={[0.02, 0.02, 0.1, 8]} />
          </mesh>
        </group>
      )}

      {/* Shadow plane */}
      <mesh position={[0, 2, -1.49]} receiveShadow>
        <planeGeometry args={[10, 7]} />
        <shadowMaterial opacity={shadowIntensity} />
      </mesh>
    </group>
  )
}

// ─── Room Image Overlay Component ────────────────────────────────────────────

function RoomImageOverlay({
  imageUrl,
  children,
  horizontalOffset,
  verticalOffset,
  scale,
}: {
  imageUrl: string
  children: React.ReactNode
  horizontalOffset: number
  verticalOffset: number
  scale: number
}) {
  return (
    <div className="relative w-full h-full">
      <div className="absolute inset-0">
        <Image src={imageUrl} alt="Room background" fill className="object-cover" unoptimized />
      </div>
      
      <div 
        className="absolute inset-0 flex items-center justify-center"
        style={{ transform: `translate(${horizontalOffset * 20}%, ${-verticalOffset * 20}%) scale(${scale})` }}
      >
        {children}
      </div>

      <div className="absolute bottom-2 left-2">
        <Badge variant="secondary" className="text-xs bg-background/80 backdrop-blur-sm">
          <AlertCircle className="h-3 w-3 mr-1" />
          Placement preview - not to scale
        </Badge>
      </div>
    </div>
  )
}

// ─── Main PlacementPreview Component ─────────────────────────────────────────

export function PlacementPreview({
  config,
  onConfigChange,
  geometry,
  renderConfig,
  settings,
  showControls = true,
}: PlacementPreviewProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const safeConfig = useMemo(() => ensurePlacementConfig(config), [config])
  const safeRenderConfig = useMemo(() => ensureRenderConfig(renderConfig), [renderConfig])
  const wireframe = settings?.wireframe ?? false

  // Generate mesh params from geometry
  const meshParams = useMemo(() => geometryToMeshParams(geometry, safeRenderConfig), [geometry, safeRenderConfig])

  const handlePreviewModeChange = useCallback((mode: string) => {
    onConfigChange({ previewMode: mode as PlacementPreviewMode })
  }, [onConfigChange])

  const handleWallToneChange = useCallback((tone: string) => {
    onConfigChange({ wallTone: tone as WallTone })
  }, [onConfigChange])

  const handlePresetSelect = useCallback((presetId: string) => {
    const preset = PLACEMENT_PRESETS.find(p => p.id === presetId)
    if (preset) {
      onConfigChange({ wallTone: preset.wallTone, previewMode: 'wall' })
    }
  }, [onConfigChange])

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const url = URL.createObjectURL(file)
      onConfigChange({ roomImageUrl: url, previewMode: 'room_image' })
    }
  }, [onConfigChange])

  const handleRemoveRoomImage = useCallback(() => {
    if (safeConfig.roomImageUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(safeConfig.roomImageUrl)
    }
    onConfigChange({ roomImageUrl: null, previewMode: 'studio' })
  }, [safeConfig.roomImageUrl, onConfigChange])

  // Render the 3D scene
  const renderScene = () => {
    const wallColors = WALL_TONE_COLORS[safeConfig.wallTone]
    const bgColor = safeConfig.previewMode === 'wall' ? wallColors.background : '#1a1a2e'

    return (
      <Canvas
        shadows
        gl={{ antialias: true, preserveDrawingBuffer: true, alpha: safeConfig.previewMode === 'room_image' }}
        style={{ background: safeConfig.previewMode === 'room_image' ? 'transparent' : bgColor, borderRadius: '0.5rem' }}
      >
        <PerspectiveCamera makeDefault position={[0, 2.5, 6]} fov={42} near={0.1} far={200} />

        {/* Lighting */}
        <ambientLight intensity={safeConfig.previewMode === 'wall' ? 0.5 : 0.35} />
        <directionalLight position={[5, 12, 5]} intensity={safeConfig.previewMode === 'wall' ? 1.2 : 1.4} castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0001} />
        <directionalLight position={[-4, 8, -3]} intensity={0.5} />
        
        {safeConfig.previewMode === 'wall' && (
          <>
            <pointLight position={[0, 4, 2]} intensity={0.3} color="#fff5e6" />
            <spotLight position={[0, 5, 3]} angle={0.4} penumbra={0.5} intensity={0.6} castShadow />
          </>
        )}

        <Environment preset={safeConfig.previewMode === 'wall' ? 'apartment' : 'forest'} backgroundBlurriness={1} backgroundIntensity={0} />

        {/* Wall backdrop */}
        {safeConfig.previewMode === 'wall' && (
          <WallBackdrop
            wallTone={safeConfig.wallTone}
            horizontalOffset={safeConfig.horizontalOffset}
            verticalOffset={safeConfig.verticalOffset}
            showMountHint={safeConfig.showMountHint}
            shadowIntensity={safeConfig.shadowIntensity}
          />
        )}

        {/* Antler rack */}
        <group
          position={[safeConfig.horizontalOffset * 2, 2.2 + safeConfig.verticalOffset * 1.5, 0]}
          scale={safeConfig.scale}
        >
          <AntlerRackScene params={meshParams} wireframe={wireframe} />
        </group>

        <OrbitControls enablePan={false} minDistance={3} maxDistance={12} target={[0, 2.2, 0]} maxPolarAngle={Math.PI * 0.75} />
      </Canvas>
    )
  }

  return (
    <div className="space-y-4">
      {/* Preview Canvas */}
      <Card className="overflow-hidden">
        <div className="relative h-80 sm:h-96 md:h-[420px]">
          {safeConfig.previewMode === 'room_image' && safeConfig.roomImageUrl ? (
            <RoomImageOverlay
              imageUrl={safeConfig.roomImageUrl}
              horizontalOffset={safeConfig.horizontalOffset}
              verticalOffset={safeConfig.verticalOffset}
              scale={safeConfig.scale}
            >
              {renderScene()}
            </RoomImageOverlay>
          ) : (
            renderScene()
          )}

          <div className="absolute top-2 right-2">
            <Badge variant="outline" className="text-xs bg-background/70 backdrop-blur-sm">
              {safeConfig.previewMode === 'studio' && 'Studio View'}
              {safeConfig.previewMode === 'wall' && `Wall: ${WALL_TONE_COLORS[safeConfig.wallTone].label}`}
              {safeConfig.previewMode === 'room_image' && 'Room Preview'}
            </Badge>
          </div>
        </div>
      </Card>

      {/* Controls Panel */}
      {showControls && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Home className="h-4 w-4" />
              Placement Preview
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Preview Mode Selection */}
            <div className="space-y-2">
              <Label className="text-sm">Preview Mode</Label>
              <div className="flex gap-2">
                <Button variant={safeConfig.previewMode === 'studio' ? 'default' : 'outline'} size="sm" onClick={() => handlePreviewModeChange('studio')} className="flex-1">
                  <Settings2 className="h-3.5 w-3.5 mr-1" />
                  Studio
                </Button>
                <Button variant={safeConfig.previewMode === 'wall' ? 'default' : 'outline'} size="sm" onClick={() => handlePreviewModeChange('wall')} className="flex-1">
                  <Home className="h-3.5 w-3.5 mr-1" />
                  Wall
                </Button>
                <Button variant={safeConfig.previewMode === 'room_image' ? 'default' : 'outline'} size="sm" onClick={() => handlePreviewModeChange('room_image')} className="flex-1">
                  <ImageIcon className="h-3.5 w-3.5 mr-1" />
                  Photo
                </Button>
              </div>
            </div>

            {/* Wall Settings */}
            {safeConfig.previewMode === 'wall' && (
              <div className="space-y-3 pt-2 border-t border-border">
                <div className="space-y-2">
                  <Label className="text-sm">Wall Style</Label>
                  <Select value={safeConfig.wallTone} onValueChange={handleWallToneChange}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(WALL_TONE_COLORS).map(([tone, { label }]) => (
                        <SelectItem key={tone} value={tone}>
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded border" style={{ backgroundColor: WALL_TONE_COLORS[tone as WallTone].background }} />
                            {label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">Quick Presets</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {PLACEMENT_PRESETS.map((preset) => (
                      <Button key={preset.id} variant="outline" size="sm" className="h-7 text-xs" onClick={() => handlePresetSelect(preset.id)}>
                        {preset.name}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Room Image Upload */}
            {safeConfig.previewMode === 'room_image' && (
              <div className="space-y-3 pt-2 border-t border-border">
                <div className="space-y-2">
                  <Label className="text-sm">Room Photo</Label>
                  {safeConfig.roomImageUrl ? (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 text-sm text-muted-foreground truncate">Image uploaded</div>
                      <Button variant="outline" size="sm" onClick={handleRemoveRoomImage}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <div>
                      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                      <Button variant="outline" className="w-full" onClick={() => fileInputRef.current?.click()}>
                        <Upload className="h-4 w-4 mr-2" />
                        Upload Room Photo
                      </Button>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Upload a photo of your wall or room to preview mount placement. This is a basic composite preview, not exact AR placement.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Position and Scale Controls */}
            <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between p-0 h-8">
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Move className="h-3.5 w-3.5" />
                    Position & Scale
                  </span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-4">
                {/* Horizontal Position */}
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-sm">Horizontal Position</Label>
                    <span className="text-xs text-muted-foreground">{safeConfig.horizontalOffset > 0 ? 'Right' : safeConfig.horizontalOffset < 0 ? 'Left' : 'Center'}</span>
                  </div>
                  <Slider value={[safeConfig.horizontalOffset]} min={-1} max={1} step={0.05} onValueChange={([v]) => onConfigChange({ horizontalOffset: v })} />
                </div>

                {/* Vertical Position */}
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-sm">Vertical Position</Label>
                    <span className="text-xs text-muted-foreground">{safeConfig.verticalOffset > 0 ? 'Up' : safeConfig.verticalOffset < 0 ? 'Down' : 'Center'}</span>
                  </div>
                  <Slider value={[safeConfig.verticalOffset]} min={-1} max={1} step={0.05} onValueChange={([v]) => onConfigChange({ verticalOffset: v })} />
                </div>

                {/* Scale */}
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-sm flex items-center gap-1"><ZoomIn className="h-3.5 w-3.5" />Scale</Label>
                    <span className="text-xs text-muted-foreground">{Math.round(safeConfig.scale * 100)}%</span>
                  </div>
                  <Slider value={[safeConfig.scale]} min={0.5} max={2.0} step={0.1} onValueChange={([v]) => onConfigChange({ scale: v })} />
                </div>

                {/* Shadow Intensity */}
                {safeConfig.previewMode === 'wall' && (
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label className="text-sm">Shadow Intensity</Label>
                      <span className="text-xs text-muted-foreground">{Math.round(safeConfig.shadowIntensity * 100)}%</span>
                    </div>
                    <Slider value={[safeConfig.shadowIntensity]} min={0} max={1} step={0.1} onValueChange={([v]) => onConfigChange({ shadowIntensity: v })} />
                  </div>
                )}

                {/* Show mount hint toggle */}
                {safeConfig.previewMode === 'wall' && (
                  <div className="flex items-center justify-between">
                    <Label htmlFor="showMountHint" className="text-sm">Show Mount Bracket</Label>
                    <Switch id="showMountHint" checked={safeConfig.showMountHint} onCheckedChange={(checked) => onConfigChange({ showMountHint: checked })} />
                  </div>
                )}

                {/* Reset button */}
                <Button variant="outline" size="sm" className="w-full" onClick={() => onConfigChange({ horizontalOffset: 0, verticalOffset: 0, scale: 1.0, shadowIntensity: 0.3 })}>
                  Reset Position
                </Button>
              </CollapsibleContent>
            </Collapsible>

            {/* Disclaimer */}
            <div className="text-xs text-muted-foreground pt-2 border-t border-border">
              <p><strong>Note:</strong> This is a visualization preview to help you imagine how your mount might look. Actual wall placement will depend on mount type, wall surface, and lighting conditions.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default PlacementPreview
