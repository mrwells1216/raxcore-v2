/// <reference types="@react-three/fiber" />
'use client'

import { useRef, useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, Html, useGLTF, Environment } from '@react-three/drei'
import * as THREE from 'three'
import {
  useMeasureStore,
  FIELD_DEFS,
  type Point3D,
  type FieldId,
} from './measure-store'
import { unitsToInches, isFiniteNumber } from '@/lib/advanced-scoring/geometry'
import { computeMeshCircumference } from '@/lib/advanced-scoring/mesh-circumference'

const MAX_RENDERED_POINT_CLOUD_POINTS = 120_000

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function zoneColor(type: string): THREE.Color {
  switch (type) {
    case 'beam':          return new THREE.Color('#4a90d9')
    case 'tine':          return new THREE.Color('#4fc36e')
    case 'circumference': return new THREE.Color('#d94a4a')
    case 'spread':        return new THREE.Color('#40c8c8')
    default:              return new THREE.Color('#c8a96e')
  }
}

// ─── Base material factory ─────────────────────────────────────────────────────

function buildBaseMaterial(renderMode: string): THREE.Material {
  switch (renderMode) {
    case 'wireframe':
      return new THREE.MeshBasicMaterial({ color: '#c8a96e', wireframe: true })
    case 'xray':
      return new THREE.MeshPhysicalMaterial({
        color: '#4a90d9', transparent: true, opacity: 0.28,
        side: THREE.DoubleSide, depthWrite: false,
      })
    case 'thermal':
      return new THREE.MeshStandardMaterial({
        color: '#ff6030', emissive: '#ff2000', emissiveIntensity: 0.4,
        roughness: 0.3, metalness: 0.1,
      })
    default: // solid / zones
      return new THREE.MeshPhysicalMaterial({
        color: '#8B6530', roughness: 0.55, metalness: 0.05,
        clearcoat: 0.15, clearcoatRoughness: 0.8,
      })
  }
}

// ─── AntlerModel — solid mesh + optional wireframe / zone overlays ─────────────

function AntlerModel({
  url,
  renderMode,
  showWireframe,
  showZones,
  zoneOpacity,
  hoveredZoneId,
}: {
  url: string
  renderMode: string
  showWireframe: boolean
  showZones: boolean
  zoneOpacity: number
  hoveredZoneId: FieldId | null
}) {
  const { scene } = useGLTF(url)
  const measurements3D = useMeasureStore(s => s.measurements3D)

  const solidClone = useMemo(() => {
    const clone = scene.clone(true)
    const mat = buildBaseMaterial(renderMode)
    clone.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh
        mesh.material = mat
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
    return clone
  }, [scene, renderMode])

  const wireClone = useMemo(() => {
    if (!showWireframe || renderMode === 'wireframe') return null
    const clone = scene.clone(true)
    const mat = new THREE.MeshBasicMaterial({
      color: '#c8a96e', wireframe: true, transparent: true, opacity: 0.18, depthTest: true,
    })
    clone.traverse((obj) => { if ((obj as THREE.Mesh).isMesh) (obj as THREE.Mesh).material = mat })
    return clone
  }, [scene, showWireframe, renderMode])

  const zoneOverlays = useMemo(() => {
    if (!showZones || renderMode === 'wireframe') return []
    const typesSeen = new Set<string>()
    const overlays: { type: string; clone: THREE.Object3D }[] = []
    for (const fd of FIELD_DEFS) {
      const m = measurements3D[fd.id]
      if (!m || m.points.length === 0 || typesSeen.has(fd.type)) continue
      typesSeen.add(fd.type)
      const clone = scene.clone(true)
      const color = zoneColor(fd.type)
      const mat = new THREE.MeshStandardMaterial({
        color, transparent: true, opacity: zoneOpacity,
        depthTest: true, polygonOffset: true,
        polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.FrontSide,
      })
      clone.traverse((obj) => { if ((obj as THREE.Mesh).isMesh) (obj as THREE.Mesh).material = mat })
      overlays.push({ type: fd.type, clone })
    }
    return overlays
  }, [scene, showZones, zoneOpacity, measurements3D, renderMode])

  // Hovered zone overlay (shows even when showZones is off)
  const hoveredFieldDef = hoveredZoneId ? FIELD_DEFS.find(f => f.id === hoveredZoneId) : null
  const hoveredOverlayRef = useRef<THREE.MeshStandardMaterial | null>(null)
  const hoveredClone = useMemo(() => {
    if (!hoveredFieldDef || renderMode === 'wireframe') return null
    const clone = scene.clone(true)
    const mat = new THREE.MeshStandardMaterial({
      color: zoneColor(hoveredFieldDef.type),
      transparent: true, opacity: 0.6,
      emissive: zoneColor(hoveredFieldDef.type), emissiveIntensity: 0.3,
      depthTest: true, polygonOffset: true,
      polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.FrontSide,
    })
    hoveredOverlayRef.current = mat
    clone.traverse((obj) => { if ((obj as THREE.Mesh).isMesh) (obj as THREE.Mesh).material = mat })
    return clone
  }, [scene, hoveredFieldDef, renderMode])

  useFrame(() => {
    const mat = hoveredOverlayRef.current
    if (!mat) return
    mat.emissiveIntensity = 0.3 + Math.sin(Date.now() / 200) * 0.2
  })

  return (
    <>
      <primitive object={solidClone} />
      {wireClone && <primitive object={wireClone} />}
      {zoneOverlays.map(({ type, clone }) => (
        <primitive key={type} object={clone} />
      ))}
      {hoveredClone && <primitive object={hoveredClone} />}
    </>
  )
}

// ─── Point cloud renderer ─────────────────────────────────────────────────────

function PointCloudRenderer() {
  const { points, visible, pointSize } = useMeasureStore(s => s.pointCloud)

  // Build a stable BufferGeometry; only recreate when the points array reference changes.
  const geometry = useMemo(() => {
    if (!points.length) return null
    const stride = Math.max(1, Math.ceil(points.length / MAX_RENDERED_POINT_CLOUD_POINTS))
    const renderedCount = Math.ceil(points.length / stride)

    const positions = new Float32Array(renderedCount * 3)
    const colors    = new Float32Array(renderedCount * 3)
    let hasColor = false

    for (let sourceIndex = 0, renderIndex = 0; sourceIndex < points.length; sourceIndex += stride, renderIndex++) {
      const p = points[sourceIndex]
      positions[renderIndex * 3]     = p.x
      positions[renderIndex * 3 + 1] = p.y
      positions[renderIndex * 3 + 2] = p.z
      if (p.color) {
        hasColor = true
        colors[renderIndex * 3]     = p.color.r
        colors[renderIndex * 3 + 1] = p.color.g
        colors[renderIndex * 3 + 2] = p.color.b
      } else {
        // Default: warm amber tint
        colors[renderIndex * 3]     = 0.78
        colors[renderIndex * 3 + 1] = 0.66
        colors[renderIndex * 3 + 2] = 0.43
      }
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color',    new THREE.BufferAttribute(colors,    3))
    geo.userData.hasColor = hasColor
    return geo
  }, [points])

  // Dispose geometry when it changes to prevent GPU leak
  useEffect(() => {
    return () => { geometry?.dispose() }
  }, [geometry])

  if (!visible || !geometry || !points.length) return null

  return (
    <points geometry={geometry}>
      <pointsMaterial
        size={pointSize}
        vertexColors
        sizeAttenuation
        depthWrite={false}
        transparent
        opacity={0.85}
      />
    </points>
  )
}

// ─── Cross-section ring ────────────────────────────────────────────────────────

function CrossSectionRing({ scene, p0, p1 }: { scene: THREE.Object3D; p0: Point3D; p1: Point3D }) {
  const ring = useMemo(() => {
    const v0 = new THREE.Vector3(p0.x, p0.y, p0.z)
    const v1 = new THREE.Vector3(p1.x, p1.y, p1.z)
    const normal = v1.clone().sub(v0).normalize()
    const plane  = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, v0.clone().lerp(v1, 0.5))

    const intersectionPts: THREE.Vector3[] = []
    const _edge   = new THREE.Line3()
    const _target = new THREE.Vector3()

    scene.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return
      const mesh = obj as THREE.Mesh
      const geom = mesh.geometry
      if (!geom.index) return
      const pos = geom.attributes.position as THREE.BufferAttribute
      const idx = geom.index!
      const wm  = mesh.matrixWorld
      for (let i = 0; i < idx.count; i += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i)).applyMatrix4(wm)
        const b = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i + 1)).applyMatrix4(wm)
        const c = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i + 2)).applyMatrix4(wm)
        for (const [ea, eb] of [[a, b], [b, c], [c, a]] as [THREE.Vector3, THREE.Vector3][]) {
          _edge.set(ea, eb)
          if (plane.intersectLine(_edge, _target)) intersectionPts.push(_target.clone())
        }
      }
    })

    if (intersectionPts.length < 3) return null

    const centroid = intersectionPts.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(intersectionPts.length)
    const u = intersectionPts[0].clone().sub(centroid).normalize()
    const v = new THREE.Vector3().crossVectors(normal, u).normalize()
    intersectionPts.sort((a, b) => {
      const aA = Math.atan2(v.dot(a.clone().sub(centroid)), u.dot(a.clone().sub(centroid)))
      const aB = Math.atan2(v.dot(b.clone().sub(centroid)), u.dot(b.clone().sub(centroid)))
      return aA - aB
    })

    return new THREE.BufferGeometry().setFromPoints(intersectionPts)
  }, [scene, p0, p1])

  useEffect(() => {
    return () => { ring?.dispose() }
  }, [ring])

  if (!ring) return null
  return (
    <lineLoop geometry={ring}>
      <lineBasicMaterial color="#ff3333" linewidth={2} />
    </lineLoop>
  )
}

// ─── CrossSectionHandler ──────────────────────────────────────────────────────

function CrossSectionHandler() {
  const { gl, camera, scene } = useThree()
  const setCrossSectionPoint = useMeasureStore(s => s.setCrossSectionPoint)
  const crossLen = useMeasureStore(s => s.crossSectionPoints.length)
  const clickCountRef = useRef(crossLen)
  const raycaster = useRef(new THREE.Raycaster())
  const mouse     = useRef(new THREE.Vector2())

  useEffect(() => { clickCountRef.current = crossLen }, [crossLen])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const rect = gl.domElement.getBoundingClientRect()
      mouse.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouse.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.current.setFromCamera(mouse.current, camera)
      const hits = raycaster.current.intersectObjects(scene.children, true)
      if (hits.length > 0) {
        const idx = (clickCountRef.current % 2) as 0 | 1
        const pt  = hits[0].point
        setCrossSectionPoint(idx, { x: pt.x, y: pt.y, z: pt.z })
      }
    }
    gl.domElement.addEventListener('click', handler)
    return () => gl.domElement.removeEventListener('click', handler)
  }, [gl, camera, scene, setCrossSectionPoint])

  return null
}

// ─── CrossSection circumference ───────────────────────────────────────────────

function crossSectionCircumference(scene: THREE.Object3D, p0: Point3D, p1: Point3D): number {
  const v0 = new THREE.Vector3(p0.x, p0.y, p0.z)
  const v1 = new THREE.Vector3(p1.x, p1.y, p1.z)
  const normal = v1.clone().sub(v0).normalize()
  const plane  = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, v0.clone().lerp(v1, 0.5))
  const _edge = new THREE.Line3(), _target = new THREE.Vector3()
  const pts: THREE.Vector3[] = []

  scene.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return
    const mesh = obj as THREE.Mesh
    const geom = mesh.geometry
    if (!geom.index) return
    const pos = geom.attributes.position as THREE.BufferAttribute
    const idx = geom.index!
    const wm  = mesh.matrixWorld
    for (let i = 0; i < idx.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i)).applyMatrix4(wm)
      const b = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i + 1)).applyMatrix4(wm)
      const c = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i + 2)).applyMatrix4(wm)
      for (const [ea, eb] of [[a, b], [b, c], [c, a]] as [THREE.Vector3, THREE.Vector3][]) {
        _edge.set(ea, eb)
        if (plane.intersectLine(_edge, _target)) pts.push(_target.clone())
      }
    }
  })

  let total = 0
  if (pts.length >= 3) {
    const centroid = pts.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(pts.length)
    const u = pts[0].clone().sub(centroid).normalize()
    const v = new THREE.Vector3().crossVectors(normal, u).normalize()
    pts.sort((a, b) => {
      const aA = Math.atan2(v.dot(a.clone().sub(centroid)), u.dot(a.clone().sub(centroid)))
      const aB = Math.atan2(v.dot(b.clone().sub(centroid)), u.dot(b.clone().sub(centroid)))
      return aA - aB
    })
    for (let i = 1; i < pts.length; i++) total += pts[i].distanceTo(pts[i - 1])
    total += pts[pts.length - 1].distanceTo(pts[0])
  }
  return total
}

// ─── Measurement tube ─────────────────────────────────────────────────────────

function MeasurementTube({ points, color, active }: { points: Point3D[]; color: string; active: boolean }) {
  if (points.length < 2) return null
  const threePoints = useMemo(
    () => points.map(p => new THREE.Vector3(p.x, p.y, p.z)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(points)],
  )
  const geometry = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(threePoints, false, 'chordal', 0.5)
    return new THREE.TubeGeometry(
      curve,
      Math.max(threePoints.length * 4, 12),
      active ? 0.003 : 0.0018,
      6,
      false,
    )
  }, [threePoints, active])
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    color, depthTest: false, transparent: true, opacity: active ? 1 : 0.8,
  }), [color, active])

  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material])

  return <mesh geometry={geometry} material={material} renderOrder={999} />
}

// ─── Point sphere ─────────────────────────────────────────────────────────────

function PointSphere({ position, color, active }: { position: Point3D; color: string; active: boolean }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    // Guard: only update scale when active to avoid unnecessary per-frame work
    if (ref.current && active) {
      ref.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 3) * 0.15)
    }
  })
  return (
    <mesh ref={ref} position={[position.x, position.y, position.z]} renderOrder={999}>
      <sphereGeometry args={[0.004, 8, 8]} />
      <meshBasicMaterial color={color} depthTest={false} />
    </mesh>
  )
}

// ─── Running total label ──────────────────────────────────────────────────────

function RunningTotalLabel({
  point,
  length,
  color,
  suffix = '"',
}: {
  point: Point3D
  length: number
  color: string
  suffix?: string
}) {
  return (
    <Html position={[point.x, point.y + 0.015, point.z]} zIndexRange={[100, 0]} center>
      <div
        className="px-1.5 py-0.5 rounded text-xs font-mono font-bold pointer-events-none whitespace-nowrap"
        style={{ background: 'rgba(0,0,0,0.78)', color, border: `1px solid ${color}` }}
      >
        {length.toFixed(2)}{suffix}
      </div>
    </Html>
  )
}

// ─── Mesh fallback warning label ──────────────────────────────────────────────

function MeshFallbackLabel({ point }: { point: Point3D }) {
  return (
    <Html position={[point.x, point.y + 0.03, point.z]} zIndexRange={[100, 0]} center>
      <div
        className="px-1.5 py-0.5 rounded text-xs font-mono pointer-events-none whitespace-nowrap"
        style={{ background: 'rgba(200,100,30,0.85)', color: '#ffe0a0', border: '1px solid #e08030' }}
      >
        mesh fallback
      </div>
    </Html>
  )
}

// ─── Measure click handler ────────────────────────────────────────────────────

function MeasureClickHandler({ active, onPlace }: { active: boolean; onPlace: (p: Point3D) => void }) {
  const { gl, camera, scene } = useThree()
  const raycaster = useRef(new THREE.Raycaster())
  const mouse     = useRef(new THREE.Vector2())

  useEffect(() => {
    if (!active) return
    const handler = (e: MouseEvent) => {
      const rect = gl.domElement.getBoundingClientRect()
      mouse.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouse.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.current.setFromCamera(mouse.current, camera)
      const hits = raycaster.current.intersectObjects(scene.children, true)
      if (hits.length > 0) {
        const pt = hits[0].point
        onPlace({ x: pt.x, y: pt.y, z: pt.z })
      }
    }
    gl.domElement.addEventListener('click', handler)
    return () => gl.domElement.removeEventListener('click', handler)
  }, [active, gl, camera, scene, onPlace])

  return null
}

// ─── SceneInner ───────────────────────────────────────────────────────────────

function SceneInner() {
  const {
    glbUrl, renderMode, showWireframe, showZones, zoneOpacity,
    activeField, mode, measurements3D, addPoint3D, crossSectionPoints,
    calibration3D, hoveredZoneId, clearCrossSection, setMeshCircumferenceMeasurement,
  } = useMeasureStore()

  const { scene: threeScene } = useThree()

  const [meshCircumError, setMeshCircumError] = useState<string | null>(null)

  const activeFieldDef = activeField ? FIELD_DEFS.find(f => f.id === activeField) : null
  const isCircumferenceField = activeFieldDef?.type === 'circumference'

  const handlePlace = useCallback(
    (p: Point3D) => { if (activeField) addPoint3D(activeField, p) },
    [activeField, addPoint3D],
  )

  const isMeasuring = mode === 'measure' && !!activeField

  const handleRecordCircumference = useCallback(() => {
    if (!activeField || crossSectionPoints.length < 2) return
    setMeshCircumError(null)

    // Collect all world-space triangles from the Three.js scene into a flat positions array
    const trianglePositions: number[] = []
    threeScene.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return
      const mesh = obj as THREE.Mesh
      const geom = mesh.geometry
      const posAttr = geom.attributes.position as THREE.BufferAttribute | undefined
      if (!posAttr) return
      const idx = geom.index
      const wm = mesh.matrixWorld
      if (idx) {
        for (let i = 0; i < idx.count; i += 3) {
          const a = new THREE.Vector3().fromBufferAttribute(posAttr, idx.getX(i)).applyMatrix4(wm)
          const b = new THREE.Vector3().fromBufferAttribute(posAttr, idx.getX(i + 1)).applyMatrix4(wm)
          const c = new THREE.Vector3().fromBufferAttribute(posAttr, idx.getX(i + 2)).applyMatrix4(wm)
          trianglePositions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
        }
      } else {
        for (let i = 0; i + 2 < posAttr.count; i += 3) {
          const a = new THREE.Vector3().fromBufferAttribute(posAttr, i).applyMatrix4(wm)
          const b = new THREE.Vector3().fromBufferAttribute(posAttr, i + 1).applyMatrix4(wm)
          const c = new THREE.Vector3().fromBufferAttribute(posAttr, i + 2).applyMatrix4(wm)
          trianglePositions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
        }
      }
    })

    if (trianglePositions.length === 0) {
      setMeshCircumError('No mesh geometry found.')
      return
    }

    const box = new THREE.Box3()
    threeScene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) box.expandByObject(obj)
    })
    const bboxSize = new THREE.Vector3()
    box.getSize(bboxSize)
    const bboxDiagonal = bboxSize.length()

    if (!isFiniteNumber(bboxDiagonal) || bboxDiagonal <= 0) {
      setMeshCircumError('Invalid bounding box.')
      return
    }

    const p0 = crossSectionPoints[0]
    const p1 = crossSectionPoints[1]
    const diff = new THREE.Vector3(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z)
    if (diff.lengthSq() === 0) { setMeshCircumError('Cross-section points are identical.'); return }
    const normal = diff.normalize()

    const plane = {
      origin: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2, z: (p0.z + p1.z) / 2 },
      normal: { x: normal.x, y: normal.y, z: normal.z },
    }

    const result = computeMeshCircumference(new Float32Array(trianglePositions), null, plane, bboxDiagonal)

    if (result.closedRingCount === 0) {
      setMeshCircumError(result.warnings[0] ?? 'No closed ring found — reposition the cross-section.')
      return
    }

    const longestClosedRing = result.rings
      .filter(r => r.closed && r.perimeter !== null)
      .sort((a, b) => (b.perimeter ?? 0) - (a.perimeter ?? 0))[0]

    if (!longestClosedRing || longestClosedRing.perimeter === null) {
      setMeshCircumError('No closed ring with a valid perimeter.')
      return
    }

    const rawPerimeter = longestClosedRing.perimeter
    const inchLength = calibration3D.finalized
      ? unitsToInches(rawPerimeter, calibration3D.unitsPerInch)
      : rawPerimeter

    if (!isFiniteNumber(inchLength) || inchLength <= 0) {
      setMeshCircumError('Invalid measurement — check 3D calibration.')
      return
    }

    setMeshCircumferenceMeasurement(
      activeField as FieldId,
      inchLength,
      true,
      result.confidence,
    )
    clearCrossSection()
  }, [
    activeField, crossSectionPoints, threeScene, calibration3D,
    setMeshCircumferenceMeasurement, clearCrossSection,
  ])

  const crossLength = useMemo(() => {
    if (crossSectionPoints.length < 2) return null
    return crossSectionCircumference(threeScene, crossSectionPoints[0], crossSectionPoints[1])
  }, [threeScene, crossSectionPoints])
  const crossLengthDisplay = crossLength !== null && calibration3D.finalized
    ? unitsToInches(crossLength, calibration3D.unitsPerInch)
    : crossLength
  const crossLengthSuffix = calibration3D.finalized ? '"' : ' units'

  return (
    <>
      {/* Lights */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 5]} intensity={1.2} castShadow shadow-mapSize={[2048, 2048]} />
      <pointLight position={[-4, 3, -4]} intensity={0.5} color="#c8a96e" />
      <pointLight position={[4, 1, 4]} intensity={0.3} color="#6090d0" />
      <hemisphereLight args={['#a07040', '#202018', 0.3]} />

      {/* Ground shadow plane */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
        <planeGeometry args={[20, 20]} />
        <shadowMaterial opacity={0.3} />
      </mesh>

      {/* Point cloud — always rendered if loaded, independent of mesh mode */}
      <PointCloudRenderer />

      {/* GLB model with overlays */}
      {glbUrl && (
        <Suspense fallback={null}>
          <AntlerModel
            url={glbUrl}
            renderMode={renderMode}
            showWireframe={showWireframe}
            showZones={showZones}
            zoneOpacity={zoneOpacity}
            hoveredZoneId={hoveredZoneId}
          />

          {crossSectionPoints.length === 2 && (
            <CrossSectionRing scene={threeScene} p0={crossSectionPoints[0]} p1={crossSectionPoints[1]} />
          )}
          {crossSectionPoints.length === 2 && crossLengthDisplay !== null && crossLengthDisplay > 0 && (
            <RunningTotalLabel point={crossSectionPoints[1]} length={crossLengthDisplay} color="#ff3333" suffix={crossLengthSuffix} />
          )}
          {crossSectionPoints.length === 2 && isCircumferenceField && (
            <Html
              position={[
                (crossSectionPoints[0].x + crossSectionPoints[1].x) / 2,
                Math.max(crossSectionPoints[0].y, crossSectionPoints[1].y) + 0.06,
                (crossSectionPoints[0].z + crossSectionPoints[1].z) / 2,
              ]}
              zIndexRange={[100, 0]}
              center
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                <button
                  style={{
                    background: '#d94a4a', color: '#fff', border: 'none',
                    borderRadius: 4, padding: '4px 12px',
                    fontSize: 11, fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                  onClick={handleRecordCircumference}
                >
                  Record Circumference
                </button>
                {meshCircumError && (
                  <div
                    style={{
                      background: 'rgba(200,50,50,0.92)', color: '#fff',
                      borderRadius: 3, padding: '3px 8px',
                      fontSize: 10, maxWidth: 200, textAlign: 'center',
                    }}
                  >
                    {meshCircumError}
                  </div>
                )}
              </div>
            </Html>
          )}
        </Suspense>
      )}

      {/* Measurement geometry */}
      {FIELD_DEFS.map((fd) => {
        const m = measurements3D[fd.id]
        if (m.points.length === 0) return null
        const isActive = fd.id === activeField

        return (
          <group key={fd.id}>
            <MeasurementTube points={m.points} color={fd.color} active={isActive} />
            {m.points.map((p, i) => (
              <PointSphere
                key={i}
                position={p}
                color={fd.color}
                active={isActive && i === m.points.length - 1}
              />
            ))}
            {isActive && m.points.length >= 2 && (
              <RunningTotalLabel
                point={m.points[m.points.length - 1]}
                length={m.inchLength}
                color={fd.color}
              />
            )}
            {/* Mesh-fallback warning on last point */}
            {isActive && m.method === 'three_d_mesh_fallback' && m.points.length >= 1 && (
              <MeshFallbackLabel point={m.points[m.points.length - 1]} />
            )}
          </group>
        )
      })}

      <MeasureClickHandler active={isMeasuring} onPlace={handlePlace} />

      <OrbitControls
        enabled={!isMeasuring}
        autoRotate={!isMeasuring && !glbUrl}
        autoRotateSpeed={0.4}
        makeDefault
      />
    </>
  )
}

// ─── Render-modes panel ───────────────────────────────────────────────────────

function RenderModesPanel() {
  const {
    renderMode, setRenderMode,
    showWireframe, setShowWireframe,
    showZones, setShowZones, zoneOpacity, setZoneOpacity,
    crossSectionPoints, clearCrossSection,
    pointCloud, setPointCloudVisible, setPointCloudPointSize,
  } = useMeasureStore()

  const modes: { id: typeof renderMode; label: string }[] = [
    { id: 'solid',     label: 'Solid' },
    { id: 'wireframe', label: 'Wire'  },
    { id: 'xray',      label: 'X-Ray' },
    { id: 'thermal',   label: 'Thermal' },
    { id: 'zones',     label: 'Zones' },
  ]

  const btnBase = 'px-2 py-1 rounded text-xs font-medium transition-colors'

  return (
    <div
      className="absolute bottom-3 left-3 z-10 flex flex-col gap-2 p-2 rounded"
      style={{ background: 'rgba(10,9,7,0.82)', border: '1px solid rgba(200,169,110,0.2)', minWidth: 140 }}
    >
      {/* Render mode row */}
      <div className="flex flex-wrap gap-1">
        {modes.map(m => (
          <button
            key={m.id}
            className={btnBase}
            style={{
              background: renderMode === m.id ? '#c8a96e' : 'rgba(255,255,255,0.06)',
              color: renderMode === m.id ? '#0d0a06' : '#c8a96e',
            }}
            onClick={() => setRenderMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Toggles */}
      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={showWireframe} onChange={e => setShowWireframe(e.target.checked)} className="accent-amber-400" />
          <span className="text-xs" style={{ color: '#c8a96e' }}>Wireframe overlay</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={showZones} onChange={e => setShowZones(e.target.checked)} className="accent-amber-400" />
          <span className="text-xs" style={{ color: '#c8a96e' }}>Zone map</span>
        </label>

        {showZones && (
          <div className="flex items-center gap-2 pl-5">
            <span className="text-xs" style={{ color: 'rgba(200,169,110,0.7)' }}>Opacity</span>
            <input
              type="range" min={0.1} max={1} step={0.05} value={zoneOpacity}
              onChange={e => setZoneOpacity(parseFloat(e.target.value))}
              className="flex-1 accent-amber-400"
            />
          </div>
        )}

        {/* Point cloud controls */}
        {pointCloud.loaded && (
          <>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={pointCloud.visible} onChange={e => setPointCloudVisible(e.target.checked)} className="accent-amber-400" />
              <span className="text-xs" style={{ color: '#c8a96e' }}>
                Point cloud ({pointCloud.points.length.toLocaleString()} pts)
              </span>
            </label>
            {pointCloud.visible && (
              <div className="flex items-center gap-2 pl-5">
                <span className="text-xs" style={{ color: 'rgba(200,169,110,0.7)' }}>Size</span>
                <input
                  type="range" min={0.001} max={0.02} step={0.001} value={pointCloud.pointSize}
                  onChange={e => setPointCloudPointSize(parseFloat(e.target.value))}
                  className="flex-1 accent-amber-400"
                />
              </div>
            )}
          </>
        )}
      </div>

      {crossSectionPoints.length > 0 && (
        <button className="text-xs text-left px-1" style={{ color: '#ff6060' }} onClick={clearCrossSection}>
          Clear cross-section ({crossSectionPoints.length}/2 pts)
        </button>
      )}
    </div>
  )
}

// ─── Point cloud upload panel ─────────────────────────────────────────────────

function PointCloudUploadPanel() {
  const { pointCloud, loadPointCloudText, clearPointCloud } = useMeasureStore()
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result
      if (typeof text === 'string') {
        loadPointCloudText(text, file.name)
      }
    }
    reader.readAsText(file)
    // Reset input so same file can be re-uploaded
    e.target.value = ''
  }, [loadPointCloudText])

  if (pointCloud.loaded) {
    return (
      <div
        className="absolute top-3 left-3 z-10 flex items-center gap-2 px-2 py-1.5 rounded"
        style={{ background: 'rgba(10,9,7,0.82)', border: '1px solid rgba(200,169,110,0.2)' }}
      >
        <span className="text-xs" style={{ color: '#4fc36e' }}>
          Point cloud: {pointCloud.filename} ({pointCloud.points.length.toLocaleString()} pts)
        </span>
        <button
          className="text-xs"
          style={{ color: '#f87171' }}
          onClick={clearPointCloud}
        >
          Remove
        </button>
      </div>
    )
  }

  return (
    <div className="absolute top-3 left-3 z-10">
      <button
        className="px-2 py-1.5 rounded text-xs font-medium"
        style={{
          background: 'rgba(10,9,7,0.82)',
          border: '1px solid rgba(200,169,110,0.2)',
          color: '#c8a96e',
        }}
        onClick={() => fileRef.current?.click()}
      >
        Upload Point Cloud (.xyz / .pts / .csv)
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".xyz,.pts,.csv,.txt"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  )
}

// ─── Exported Scene3D ─────────────────────────────────────────────────────────

export function Scene3D() {
  const { glbUrl, setGlbUrl, activeField, mode } = useMeasureStore()
  const pointCloudLoaded = useMeasureStore(s => s.pointCloud.loaded)
  const fileRef   = useRef<HTMLInputElement>(null)
  const isMeasuring = mode === 'measure' && !!activeField
  const afd         = activeField ? FIELD_DEFS.find(f => f.id === activeField) : null

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    const previousUrl = useMeasureStore.getState().glbUrl
    if (previousUrl?.startsWith('blob:')) URL.revokeObjectURL(previousUrl)
    setGlbUrl(url)
    e.target.value = ''
  }

  return (
    <div className="relative w-full h-full" style={{ background: '#0a0907' }}>
      {/* Upload prompt */}
      {!glbUrl && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10 pointer-events-none">
          <p className="text-sm" style={{ color: 'rgba(200,169,110,0.7)' }}>
            Upload a GLB model to begin 3D measurement
          </p>
          <button
            className="pointer-events-auto px-4 py-2 rounded text-sm font-medium"
            style={{ background: '#c8a96e', color: '#0d0a06' }}
            onClick={() => fileRef.current?.click()}
          >
            Upload GLB
          </button>
          <input ref={fileRef} type="file" accept=".glb,.gltf" className="hidden" onChange={handleFileUpload} />
        </div>
      )}

      {/* Replace GLB button */}
      {glbUrl && (
        <>
          <div className="absolute top-3 right-3 z-10">
            <button
              className="px-2 py-1 rounded text-xs"
              style={{ background: 'rgba(0,0,0,0.6)', color: '#c8a96e', border: '1px solid rgba(200,169,110,0.3)' }}
              onClick={() => fileRef.current?.click()}
            >
              Replace GLB
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".glb,.gltf" className="hidden" onChange={handleFileUpload} />
        </>
      )}

      {/* Point cloud upload/status */}
      <PointCloudUploadPanel />

      {/* Measure mode banner */}
      {isMeasuring && afd && (
        <div
          className="absolute top-12 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded text-xs font-bold tracking-wider pointer-events-none"
          style={{
            background: 'rgba(0,0,0,0.78)',
            border: `1px solid ${afd.color}`,
            color: afd.color,
          }}
        >
          {pointCloudLoaded
            ? 'Click mesh — snaps to nearest point cloud point'
            : 'Click mesh to place points (mesh fallback — no point cloud)'}
        </div>
      )}

      {/* Render-modes panel */}
      {glbUrl && <RenderModesPanel />}

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
