/// <reference types="@react-three/fiber" />
'use client'

import { useRef, useCallback, useEffect, Suspense } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import {
  OrbitControls,
  Html,
  useGLTF,
  Environment,
} from '@react-three/drei'
import * as THREE from 'three'
import { useMeasureStore, FIELD_DEFS, type FieldId, type Point3D } from './measure-store'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function polyline3DLength(points: Point3D[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    const dz = points[i].z - points[i - 1].z
    total += Math.sqrt(dx * dx + dy * dy + dz * dz)
  }
  return total
}

// ─── GLB Model ───────────────────────────────────────────────────────────────

function AntlerModel({ url, renderMode }: { url: string; renderMode: string }) {
  const { scene } = useGLTF(url)
  const cloned = scene.clone(true)

  cloned.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh
      if (renderMode === 'wireframe') {
        mesh.material = new THREE.MeshBasicMaterial({ color: '#c8a96e', wireframe: true })
      } else if (renderMode === 'xray') {
        mesh.material = new THREE.MeshPhysicalMaterial({
          color: '#4a90d9',
          transparent: true,
          opacity: 0.35,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      } else if (renderMode === 'thermal') {
        mesh.material = new THREE.MeshStandardMaterial({
          color: '#ff6030',
          emissive: '#ff2000',
          emissiveIntensity: 0.4,
          roughness: 0.3,
          metalness: 0.1,
        })
      } else {
        // solid / zones
        mesh.material = new THREE.MeshPhysicalMaterial({
          color: '#8B6530',
          roughness: 0.55,
          metalness: 0.05,
          clearcoat: 0.15,
          clearcoatRoughness: 0.8,
        })
      }
      mesh.castShadow    = true
      mesh.receiveShadow = true
    }
  })

  return <primitive object={cloned} />
}

// ─── Measurement tube ─────────────────────────────────────────────────────────

function MeasurementTube({ points, color, active }: {
  points: Point3D[]
  color: string
  active: boolean
}) {
  if (points.length < 2) return null

  const threePoints = points.map(p => new THREE.Vector3(p.x, p.y, p.z))
  const curve = new THREE.CatmullRomCurve3(threePoints, false, 'chordal', 0.5)
  const geometry = new THREE.TubeGeometry(curve, Math.max(threePoints.length * 4, 12), active ? 0.003 : 0.0018, 6, false)
  const material = new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    transparent: true,
    opacity: active ? 1 : 0.8,
  })

  return <mesh geometry={geometry} material={material} renderOrder={999} />
}

// ─── Point spheres ────────────────────────────────────────────────────────────

function PointSphere({ position, color, active }: {
  position: Point3D
  color: string
  active: boolean
}) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (ref.current && active) {
      ref.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 3) * 0.15)
    }
  })
  return (
    <mesh
      ref={ref}
      position={[position.x, position.y, position.z]}
      renderOrder={999}
    >
      <sphereGeometry args={[0.004, 8, 8]} />
      <meshBasicMaterial color={color} depthTest={false} />
    </mesh>
  )
}

// ─── Raycaster click handler ──────────────────────────────────────────────────

function MeasureClickHandler({
  active,
  onPlace,
}: {
  active: boolean
  onPlace: (p: Point3D) => void
}) {
  const { gl, camera, scene } = useThree()
  const raycaster = useRef(new THREE.Raycaster())
  const mouse = useRef(new THREE.Vector2())

  useEffect(() => {
    if (!active) return

    const handler = (e: MouseEvent) => {
      const rect = gl.domElement.getBoundingClientRect()
      mouse.current.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1
      mouse.current.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1

      raycaster.current.setFromCamera(mouse.current, camera)
      const intersects = raycaster.current.intersectObjects(scene.children, true)
      if (intersects.length > 0) {
        const pt = intersects[0].point
        onPlace({ x: pt.x, y: pt.y, z: pt.z })
      }
    }

    gl.domElement.addEventListener('click', handler)
    return () => gl.domElement.removeEventListener('click', handler)
  }, [active, gl, camera, scene, onPlace])

  return null
}

// ─── Running-total HTML overlay ───────────────────────────────────────────────

function RunningTotalLabel({ point, length, color }: {
  point: Point3D
  length: number
  color: string
}) {
  return (
    <Html position={[point.x, point.y + 0.015, point.z]} zIndexRange={[100, 0]} center>
      <div
        className="px-1.5 py-0.5 rounded text-xs font-mono font-bold pointer-events-none whitespace-nowrap"
        style={{ background: 'rgba(0,0,0,0.75)', color, border: `1px solid ${color}` }}
      >
        {length.toFixed(2)}&quot;
      </div>
    </Html>
  )
}

// ─── Scene inner ─────────────────────────────────────────────────────────────

function SceneInner() {
  const {
    glbUrl,
    renderMode,
    activeField,
    mode,
    measurements3D,
    addPoint3D,
  } = useMeasureStore()

  const handlePlace = useCallback((p: Point3D) => {
    if (!activeField) return
    addPoint3D(activeField, p)
  }, [activeField, addPoint3D])

  const isMeasuring = mode === 'measure' && !!activeField

  return (
    <>
      {/* Lights */}
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[5, 8, 5]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      <pointLight position={[-4, 3, -4]} intensity={0.5} color="#c8a96e" />
      <pointLight position={[4, 1, 4]}  intensity={0.3} color="#6090d0" />
      <hemisphereLight args={['#a07040', '#202018', 0.3]} />

      {/* Ground plane */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
        <planeGeometry args={[20, 20]} />
        <shadowMaterial opacity={0.3} />
      </mesh>

      {/* GLB model */}
      {glbUrl && (
        <Suspense fallback={null}>
          <AntlerModel url={glbUrl} renderMode={renderMode} />
        </Suspense>
      )}

      {/* Measurement geometry */}
      {FIELD_DEFS.map(fd => {
        const m = measurements3D[fd.id]
        if (m.points.length === 0) return null
        const isActive = fd.id === activeField

        return (
          <group key={fd.id}>
            <MeasurementTube points={m.points} color={fd.color} active={isActive} />
            {m.points.map((p, i) => (
              <PointSphere key={i} position={p} color={fd.color} active={isActive && i === m.points.length - 1} />
            ))}
            {/* Running total on last point */}
            {isActive && m.points.length >= 2 && (
              <RunningTotalLabel
                point={m.points[m.points.length - 1]}
                length={m.inchLength}
                color={fd.color}
              />
            )}
          </group>
        )
      })}

      {/* Click handler */}
      <MeasureClickHandler active={isMeasuring} onPlace={handlePlace} />

      {/* Orbit controls — disabled when measuring */}
      <OrbitControls
        enabled={!isMeasuring}
        autoRotate={!isMeasuring && !glbUrl}
        autoRotateSpeed={0.4}
        makeDefault
      />


    </>
  )
}

// ─── Exported component ───────────────────────────────────────────────────────

export function Scene3D() {
  const { glbUrl, setGlbUrl, activeField, mode } = useMeasureStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const isMeasuring = mode === 'measure' && !!activeField

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    setGlbUrl(url)
  }

  return (
    <div className="relative w-full h-full" style={{ background: '#0a0907' }}>
      {/* Upload prompt */}
      {!glbUrl && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10 pointer-events-none">
          <p className="text-muted-foreground text-sm">Upload a GLB model to begin 3D measurement</p>
          <button
            className="pointer-events-auto px-4 py-2 rounded text-sm font-medium"
            style={{ background: '#c8a96e', color: '#0d0a06' }}
            onClick={() => fileRef.current?.click()}
          >
            Upload GLB
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".glb,.gltf"
            className="hidden"
            onChange={handleFileUpload}
          />
        </div>
      )}

      {/* GLB replace button when loaded */}
      {glbUrl && (
        <div className="absolute top-3 right-3 z-10 flex gap-2">
          <button
            className="px-2 py-1 rounded text-xs"
            style={{ background: 'rgba(0,0,0,0.6)', color: '#c8a96e', border: '1px solid #c8a96e44' }}
            onClick={() => fileRef.current?.click()}
          >
            Replace GLB
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".glb,.gltf"
            className="hidden"
            onChange={handleFileUpload}
          />
        </div>
      )}

      {/* Measure mode overlay */}
      {isMeasuring && (
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded text-xs font-bold tracking-wider pointer-events-none"
          style={{
            background: 'rgba(0,0,0,0.75)',
            border: `1px solid ${FIELD_DEFS.find(f => f.id === activeField)?.color ?? '#c8a96e'}`,
            color: FIELD_DEFS.find(f => f.id === activeField)?.color ?? '#c8a96e',
          }}
        >
          Click mesh to place points — orbit disabled while measuring
        </div>
      )}

      <Canvas
        shadows
        camera={{ position: [0, 0.5, 2], fov: 45 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        style={{ width: '100%', height: '100%' }}
      >
        <fog attach="fog" args={['#0a0907', 8, 25]} />
        <Environment preset="sunset" background={false} />
        <SceneInner />
      </Canvas>
    </div>
  )
}
