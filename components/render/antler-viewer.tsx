'use client'

import { useRef, useMemo, Suspense, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Environment, PerspectiveCamera } from '@react-three/drei'
import * as THREE from 'three'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Ruler,
} from 'lucide-react'
import {
  geometryToMeshParams,
  buildBeamTubeGeometry,
  buildTineGeometry,
  sampleBeamAt,
  getCameraPosition,
  RENDERER_LABELS,
} from '@/lib/render/adapter'
import type { AntlerGeometry, RenderSettings, RenderView } from '@/lib/types'
import type { AntlerMeshParams, TineSpec, BeamCurve } from '@/lib/render/adapter'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AntlerViewerProps {
  geometry: AntlerGeometry
  settings: RenderSettings
  onSettingsChange?: (updates: Partial<RenderSettings>) => void
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

// ─── Antler material ──────────────────────────────────────────────────────────

function useAntlerMaterial(color: string, wireframe: boolean) {
  return useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness: 0.78,
        metalness: 0.04,
        wireframe,
      }),
    [color, wireframe]
  )
}

// ─── Single beam mesh ─────────────────────────────────────────────────────────

function BeamMesh({
  beam,
  material,
}: {
  beam: BeamCurve
  material: THREE.MeshStandardMaterial
}) {
  const geo = useMemo(() => buildBeamTubeGeometry(beam, 48, 9), [beam])
  return <mesh geometry={geo} material={material} castShadow receiveShadow />
}

// ─── Single tine mesh ────────────────────────────────────────────────────────

function TineMesh({
  spec,
  beam,
  material,
}: {
  spec: TineSpec
  beam: BeamCurve
  material: THREE.MeshStandardMaterial
}) {
  const meshRef = useRef<THREE.Mesh>(null)

  const { geo, position, quaternion } = useMemo(() => {
    const { position, tangent } = sampleBeamAt(beam, spec.beamT)
    const baseRadius = spec.length * 0.08

    // Cone geometry: apex at top, base at bottom (Three default: along Y)
    const geo = buildTineGeometry(spec.length, baseRadius)

    // Align cone axis (Y) to spec.localDir
    const up = new THREE.Vector3(0, 1, 0)
    const dir = spec.localDir.clone().normalize()
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir)

    // Offset cone center by half-length along dir so base sits on beam
    const offset = dir.clone().multiplyScalar(spec.length * 0.5)
    const finalPos = position.clone().add(offset)

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

// ─── Burr disk ────────────────────────────────────────────────────────────────

function BurrMesh({
  center,
  radius,
  material,
}: {
  center: THREE.Vector3
  radius: number
  material: THREE.MeshStandardMaterial
}) {
  const geo = useMemo(
    () => new THREE.SphereGeometry(radius, 12, 8),
    [radius]
  )
  return <mesh geometry={geo} material={material} position={center} castShadow />
}

// ─── Full rack scene ─────────────────────────────────────────────────────────

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
  const mat = useAntlerMaterial(settings.antlerColor, settings.wireframe)

  useFrame((_, delta) => {
    if (autoRotate && groupRef.current) {
      groupRef.current.rotation.y += delta * 0.35
    }
  })

  return (
    <group ref={groupRef}>
      {/* Left side */}
      <BeamMesh beam={params.leftBeam} material={mat} />
      {params.leftTines.map((tine) => (
        <TineMesh key={tine.name + '-L'} spec={tine} beam={params.leftBeam} material={mat} />
      ))}
      <BurrMesh center={params.leftBurr.center} radius={params.leftBurr.radius} material={mat} />

      {/* Right side */}
      <BeamMesh beam={params.rightBeam} material={mat} />
      {params.rightTines.map((tine) => (
        <TineMesh key={tine.name + '-R'} spec={tine} beam={params.rightBeam} material={mat} />
      ))}
      <BurrMesh center={params.rightBurr.center} radius={params.rightBurr.radius} material={mat} />

      {/* Skull base connector — thin cylinder between burrs */}
      <mesh
        position={[0, 0, 0]}
        material={mat}
        castShadow
      >
        <cylinderGeometry args={[params.skullHalfWidth * 0.35, params.skullHalfWidth * 0.35, params.skullHalfWidth * 1.2, 10]} />
      </mesh>
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
  onSettingsChange,
  className = '',
}: AntlerViewerProps) {
  const [currentView, setCurrentView] = useState<RenderView>('isometric')

  const params = useMemo(() => geometryToMeshParams(geometry), [geometry])

  const handleAutoRotateToggle = (checked: boolean) => {
    onSettingsChange?.({ autoRotate: checked })
  }

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

              {/* Lighting */}
              <ambientLight intensity={0.45} />
              <directionalLight
                position={[5, 10, 5]}
                intensity={1.2}
                castShadow
                shadow-mapSize={[1024, 1024]}
              />
              <directionalLight position={[-4, 6, -3]} intensity={0.4} />
              <pointLight position={[0, 8, 0]} intensity={0.3} color="#f5e9d0" />

              {/* Environment for subtle IBL */}
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
                target={[0, 1.2, 0]}
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
          <div className="absolute top-2 right-2">
            <Badge variant="outline" className="text-xs bg-background/70 backdrop-blur-sm">
              {RENDERER_LABELS[params.rendererType]}
            </Badge>
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
      {onSettingsChange && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Display Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default AntlerViewer
