'use client'

import { useRef, useMemo, Suspense, useState, useCallback } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Environment, PerspectiveCamera } from '@react-three/drei'
import * as THREE from 'three'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
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
  Ruler,
  Settings2,
  ChevronDown,
} from 'lucide-react'
import {
  geometryToMeshParams,
  buildBeamTubeGeometry,
  buildTineGeometry,
  buildBurrGeometry,
  buildSkullPlateGeometry,
  sampleBeamAt,
  getCameraPosition,
  RENDERER_LABELS,
  DEFAULT_RENDER_CONFIG,
  ensureRenderConfig,
  type RenderConfig,
  type MountMode,
  type RealismLevel,
} from '@/lib/render/adapter'
import type { AntlerGeometry, RenderSettings, RenderView } from '@/lib/types'
import type { AntlerMeshParams, TineSpec, BeamCurve, BurrSpec, SkullPlateSpec, MaterialHints } from '@/lib/render/adapter'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AntlerViewerProps {
  geometry: AntlerGeometry
  settings: RenderSettings
  renderConfig?: Partial<RenderConfig>
  onSettingsChange?: (updates: Partial<RenderSettings>) => void
  onRenderConfigChange?: (updates: Partial<RenderConfig>) => void
  className?: string
}

interface ViewButton {
  view: RenderView
  label: string
}

const VIEW_BUTTONS: ViewButton[] = [
  { view: 'front',      label: 'Front' },
  { view: 'left',       label: 'Left' },
  { view: 'right',      label: 'Right' },
  { view: 'top',        label: 'Top' },
  { view: 'isometric',  label: '3D' },
]

// ─── Enhanced Antler Material ─────────────────────────────────────────────────

function useAntlerMaterial(
  hints: MaterialHints,
  wireframe: boolean,
  position: 'base' | 'mid' | 'tip' | 'burr' = 'base'
) {
  return useMemo(() => {
    // Color varies from base to tip
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
      // Subtle variation for realism
      envMapIntensity: 0.4,
    })
  }, [hints, wireframe, position])
}

// Gradient material that interpolates along the beam
function useGradientAntlerMaterial(
  hints: MaterialHints,
  wireframe: boolean
) {
  return useMemo(() => {
    // Single material with average properties
    // The gradient effect comes from vertex colors (added in geometry)
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(hints.baseColor),
      roughness: (hints.roughnessBase + hints.roughnessTip) / 2,
      metalness: 0.02,
      wireframe,
      envMapIntensity: 0.5,
      vertexColors: false, // Could enable for per-vertex color variation
    })
  }, [hints, wireframe])
}

// ─── European Mount Skull Plate Mesh ──────────────────────────────────────────

function SkullPlateMesh({
  spec,
  material,
}: {
  spec: SkullPlateSpec
  material: THREE.MeshStandardMaterial
}) {
  const geo = useMemo(() => buildSkullPlateGeometry(spec), [spec])
  
  // Bone-like material for skull plate
  const boneMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color('#E8DCC8'),
      roughness: 0.85,
      metalness: 0.0,
    })
  }, [])

  return (
    <mesh
      geometry={geo}
      material={boneMaterial}
      position={spec.center}
      castShadow
      receiveShadow
    />
  )
}

// ─── Enhanced Beam Mesh with Gradient ─────────────────────────────────────────

function BeamMesh({
  beam,
  hints,
  wireframe,
}: {
  beam: BeamCurve
  hints: MaterialHints
  wireframe: boolean
}) {
  const geo = useMemo(() => buildBeamTubeGeometry(beam, 56, 12), [beam])
  const material = useGradientAntlerMaterial(hints, wireframe)
  
  return <mesh geometry={geo} material={material} castShadow receiveShadow />
}

// ─── Enhanced Tine Mesh with Proper Transitions ───────────────────────────────

function TineMesh({
  spec,
  beam,
  hints,
  wireframe,
}: {
  spec: TineSpec
  beam: BeamCurve
  hints: MaterialHints
  wireframe: boolean
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const material = useAntlerMaterial(hints, wireframe, 'mid')

  const { geo, position, quaternion } = useMemo(() => {
    const { position, tangent, radius: beamRadius } = sampleBeamAt(beam, spec.beamT)

    // Build tine geometry with proper base radius
    const geo = buildTineGeometry(spec)

    // Align tine axis (Y in LatheGeometry) to spec.localDir
    const up = new THREE.Vector3(0, 1, 0)
    const dir = spec.localDir.clone().normalize()
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir)

    // Position: start from beam surface, offset by beam radius in the tine direction
    // This creates a smoother transition
    const surfaceOffset = dir.clone().multiplyScalar(beamRadius * 0.3)
    const finalPos = position.clone().add(surfaceOffset)

    return { geo, position: finalPos, quaternion: quat }
  }, [spec, beam])

  return (
    <mesh
      ref={meshRef}
      geometry={geo}
      material={material}
      position={position}
      quaternion={quaternion}
      castShadow
    />
  )
}

// ─── Enhanced Burr Mesh ───────────────────────────────────────────────────────

function BurrMesh({
  spec,
  hints,
  wireframe,
}: {
  spec: BurrSpec
  hints: MaterialHints
  wireframe: boolean
}) {
  const geo = useMemo(() => buildBurrGeometry(spec), [spec])
  const material = useAntlerMaterial(hints, wireframe, 'burr')

  return (
    <mesh
      geometry={geo}
      material={material}
      position={spec.center}
      castShadow
    />
  )
}

// ─── Skull Connector (between burrs) ──────────────────────────────────────────

function SkullConnector({
  leftBurr,
  rightBurr,
  hints,
  wireframe,
  showPlate,
}: {
  leftBurr: BurrSpec
  rightBurr: BurrSpec
  hints: MaterialHints
  wireframe: boolean
  showPlate: boolean
}) {
  const material = useAntlerMaterial(hints, wireframe, 'burr')
  
  // Bone material for connector when showing plate
  const boneMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color('#E5D9C5'),
      roughness: 0.8,
      metalness: 0.0,
      wireframe,
    })
  }, [wireframe])

  const distance = leftBurr.center.distanceTo(rightBurr.center)
  const midpoint = leftBurr.center.clone().lerp(rightBurr.center, 0.5)
  
  // Use smaller of the two burr radii for connector
  const connectorRadius = Math.min(leftBurr.radius, rightBurr.radius) * 0.5

  return (
    <mesh
      position={midpoint}
      material={showPlate ? boneMaterial : material}
      castShadow
    >
      <cylinderGeometry args={[connectorRadius, connectorRadius, distance * 0.95, 10]} />
    </mesh>
  )
}

// ─── Full Rack Scene ─────────────────────────────────────────────────────────

function AntlerRack({
  params,
  settings,
  autoRotate,
}: {
  params: AntlerMeshParams
  settings: RenderSettings
  autoRotate: boolean
}) {
  const groupRef = useRef<THREE.Group>(null)

  useFrame((_, delta) => {
    if (autoRotate && groupRef.current) {
      groupRef.current.rotation.y += delta * 0.3
    }
  })

  const { materialHints, config } = params
  const showEuropeanMount = config.mountMode === 'european_mount'

  return (
    <group ref={groupRef}>
      {/* Left side */}
      <BeamMesh 
        beam={params.leftBeam} 
        hints={materialHints} 
        wireframe={settings.wireframe} 
      />
      {params.leftTines.map((tine) => (
        <TineMesh 
          key={tine.name + '-L'} 
          spec={tine} 
          beam={params.leftBeam} 
          hints={materialHints}
          wireframe={settings.wireframe}
        />
      ))}
      <BurrMesh 
        spec={params.leftBurr} 
        hints={materialHints}
        wireframe={settings.wireframe}
      />

      {/* Right side */}
      <BeamMesh 
        beam={params.rightBeam} 
        hints={materialHints}
        wireframe={settings.wireframe}
      />
      {params.rightTines.map((tine) => (
        <TineMesh 
          key={tine.name + '-R'} 
          spec={tine} 
          beam={params.rightBeam} 
          hints={materialHints}
          wireframe={settings.wireframe}
        />
      ))}
      <BurrMesh 
        spec={params.rightBurr} 
        hints={materialHints}
        wireframe={settings.wireframe}
      />

      {/* Skull connector between burrs */}
      <SkullConnector 
        leftBurr={params.leftBurr}
        rightBurr={params.rightBurr}
        hints={materialHints}
        wireframe={settings.wireframe}
        showPlate={showEuropeanMount}
      />

      {/* European mount skull plate */}
      {showEuropeanMount && params.skullPlate && (
        <SkullPlateMesh 
          spec={params.skullPlate}
          material={new THREE.MeshStandardMaterial()}
        />
      )}
    </group>
  )
}

// ─── Camera rig ──────────────────────────────────────────────────────────────

function CameraRig({ view }: { view: RenderView }) {
  const camPos = getCameraPosition(view, 6)
  return (
    <PerspectiveCamera
      makeDefault
      position={camPos}
      fov={42}
      near={0.1}
      far={200}
    />
  )
}

// ─── Loading fallback ────────────────────────────────────────────────────────

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
      Loading 3D viewer...
    </div>
  )
}

// ─── Main AntlerViewer ───────────────────────────────────────────────────────

export function AntlerViewer({
  geometry,
  settings,
  renderConfig,
  onSettingsChange,
  onRenderConfigChange,
  className = '',
}: AntlerViewerProps) {
  const [currentView, setCurrentView] = useState<RenderView>('isometric')
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Merge saved config with defaults for backward compatibility
  const config = useMemo(
    () => ensureRenderConfig(renderConfig),
    [renderConfig]
  )

  const params = useMemo(
    () => geometryToMeshParams(geometry, config),
    [geometry, config]
  )

  const handleAutoRotateToggle = (checked: boolean) => {
    onSettingsChange?.({ autoRotate: checked })
  }

  const handleMountModeChange = useCallback((value: string) => {
    onRenderConfigChange?.({ mountMode: value as MountMode })
  }, [onRenderConfigChange])

  const handleRealismChange = useCallback((value: string) => {
    onRenderConfigChange?.({ realismLevel: value as RealismLevel })
  }, [onRenderConfigChange])

  const handleAsymmetryChange = useCallback((value: number[]) => {
    onRenderConfigChange?.({ asymmetrySensitivity: value[0] })
  }, [onRenderConfigChange])

  return (
    <div className={`space-y-4 ${className}`}>
      {/* 3D Canvas */}
      <Card className="overflow-hidden">
        <div className="relative h-80 sm:h-96 md:h-[420px] flex items-center justify-center">
          <Suspense fallback={<LoadingFallback />}>
            <Canvas
              shadows
              gl={{ antialias: true, preserveDrawingBuffer: true }}
              style={{ background: settings.backgroundColor, borderRadius: '0.5rem' }}
            >
              <CameraRig view={currentView} />

              {/* Enhanced Lighting for better material appearance */}
              <ambientLight intensity={0.35} />
              <directionalLight
                position={[5, 12, 5]}
                intensity={1.4}
                castShadow
                shadow-mapSize={[1024, 1024]}
                shadow-bias={-0.0001}
              />
              <directionalLight position={[-4, 8, -3]} intensity={0.5} />
              <pointLight position={[0, 10, 0]} intensity={0.25} color="#f5e9d0" />
              {/* Rim light for edge definition */}
              <directionalLight position={[0, 2, -8]} intensity={0.3} color="#ffe4c4" />

              {/* Environment for realistic reflections */}
              <Environment preset="forest" backgroundBlurriness={1} backgroundIntensity={0} />

              {/* Rack */}
              <AntlerRack
                params={params}
                settings={settings}
                autoRotate={settings.autoRotate}
              />

              {/* Orbit controls — disabled when auto-rotating */}
              <OrbitControls
                enablePan={false}
                minDistance={2}
                maxDistance={18}
                target={[0, 2.2, 0]}
                enabled={!settings.autoRotate}
              />
            </Canvas>
          </Suspense>

          {/* View buttons overlay */}
          <div className="absolute top-2 left-2 flex gap-1">
            {VIEW_BUTTONS.map(({ view, label }) => (
              <Button
                key={view}
                size="sm"
                variant={currentView === view ? 'default' : 'secondary'}
                onClick={() => {
                  onSettingsChange?.({ autoRotate: false })
                  setCurrentView(view)
                }}
                className="h-7 px-2 text-xs"
              >
                {label}
              </Button>
            ))}
          </div>

          {/* Renderer badge */}
          <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
            <Badge variant="outline" className="text-xs bg-background/70 backdrop-blur-sm">
              {RENDERER_LABELS[params.rendererType]}
            </Badge>
            {params.asymmetryFactor > 0.15 && (
              <Badge variant="secondary" className="text-xs bg-background/70 backdrop-blur-sm">
                Asymmetric
              </Badge>
            )}
          </div>

          {/* Score/type badge */}
          <div className="absolute bottom-2 left-2">
            <Badge variant="secondary" className="text-xs">
              {geometry.rackType === 'typical' ? 'Typical' : 'Non-Typical'} &bull; {geometry.mainFramePoints}-pt
            </Badge>
          </div>
        </div>
      </Card>

      {/* Measurement summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Ruler className="h-4 w-4" />
            Geometry Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Spread</p>
              <p className="font-medium">{geometry.insideSpread}&quot;</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Beam L</p>
              <p className="font-medium">{geometry.mainBeamLeft}&quot;</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Beam R</p>
              <p className="font-medium">{geometry.mainBeamRight}&quot;</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">G2 L</p>
              <p className="font-medium">{geometry.g2Left}&quot;</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">G2 R</p>
              <p className="font-medium">{geometry.g2Right}&quot;</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Abnormal</p>
              <p className="font-medium">{geometry.abnormalPoints}&quot;</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Settings */}
      {(onSettingsChange || onRenderConfigChange) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Display Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {onSettingsChange && (
              <>
                <div className="flex items-center justify-between">
                  <Label htmlFor="autoRotate" className="text-sm">Auto Rotate</Label>
                  <Switch
                    id="autoRotate"
                    checked={settings.autoRotate}
                    onCheckedChange={handleAutoRotateToggle}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="wireframe" className="text-sm">Wireframe</Label>
                  <Switch
                    id="wireframe"
                    checked={settings.wireframe}
                    onCheckedChange={(checked) => onSettingsChange({ wireframe: checked })}
                  />
                </div>
              </>
            )}

            {/* Advanced render config */}
            {onRenderConfigChange && (
              <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between p-0 h-8">
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Settings2 className="h-3.5 w-3.5" />
                      Advanced Options
                    </span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 pt-4">
                  {/* Mount Mode */}
                  <div className="space-y-2">
                    <Label className="text-sm">Mount Style</Label>
                    <Select value={config.mountMode} onValueChange={handleMountModeChange}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="antlers_only">Antlers Only</SelectItem>
                        <SelectItem value="european_mount">European Mount</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Realism Level */}
                  <div className="space-y-2">
                    <Label className="text-sm">Realism Level</Label>
                    <Select value={config.realismLevel} onValueChange={handleRealismChange}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="basic">Basic</SelectItem>
                        <SelectItem value="standard">Standard</SelectItem>
                        <SelectItem value="enhanced">Enhanced</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Asymmetry Sensitivity */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label className="text-sm">Asymmetry Sensitivity</Label>
                      <span className="text-xs text-muted-foreground">
                        {Math.round(config.asymmetrySensitivity * 100)}%
                      </span>
                    </div>
                    <Slider
                      value={[config.asymmetrySensitivity]}
                      min={0}
                      max={1}
                      step={0.1}
                      onValueChange={handleAsymmetryChange}
                      className="w-full"
                    />
                    <p className="text-xs text-muted-foreground">
                      How much left/right differences affect the 3D shape
                    </p>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default AntlerViewer
