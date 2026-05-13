'use client'

import { useEffect, useRef } from 'react'

interface CircuitLine {
  id: number
  path: string
  delay: number
  duration: number
  opacity: number
}

export function CircuitBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size
    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    // Circuit node positions (grid-based with some randomness)
    const nodes: { x: number; y: number }[] = []
    const gridSize = 80
    const cols = Math.ceil(canvas.width / gridSize) + 1
    const rows = Math.ceil(canvas.height / gridSize) + 1

    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        nodes.push({
          x: i * gridSize + (Math.random() - 0.5) * 20,
          y: j * gridSize + (Math.random() - 0.5) * 20,
        })
      }
    }

    // Create circuit paths between nearby nodes
    interface CircuitPath {
      points: { x: number; y: number }[]
      progress: number
      speed: number
      delay: number
      active: boolean
      lastFired: number
      color: string
    }

    const paths: CircuitPath[] = []
    const bronzeColors = [
      'rgba(184, 114, 72, 0.4)',
      'rgba(200, 169, 110, 0.35)',
      'rgba(140, 90, 50, 0.3)',
      'rgba(90, 184, 80, 0.25)', // Occasional green
    ]

    // Generate paths
    for (let i = 0; i < 25; i++) {
      const startNode = nodes[Math.floor(Math.random() * nodes.length)]
      const pathPoints = [{ ...startNode }]
      
      // Create a path with 2-5 segments
      const segments = 2 + Math.floor(Math.random() * 4)
      let current = startNode

      for (let s = 0; s < segments; s++) {
        // Find nearby nodes
        const nearby = nodes.filter(n => {
          const dist = Math.hypot(n.x - current.x, n.y - current.y)
          return dist > 40 && dist < 160
        })

        if (nearby.length > 0) {
          const next = nearby[Math.floor(Math.random() * nearby.length)]
          
          // Add intermediate point for right-angle turns (circuit style)
          if (Math.random() > 0.3) {
            const midPoint = Math.random() > 0.5
              ? { x: next.x, y: current.y }
              : { x: current.x, y: next.y }
            pathPoints.push(midPoint)
          }
          
          pathPoints.push({ ...next })
          current = next
        }
      }

      if (pathPoints.length > 2) {
        paths.push({
          points: pathPoints,
          progress: 0,
          speed: 0.002 + Math.random() * 0.003, // Slow speeds
          delay: Math.random() * 8000, // Random initial delay up to 8s
          active: false,
          lastFired: -10000,
          color: bronzeColors[Math.floor(Math.random() * bronzeColors.length)],
        })
      }
    }

    let startTime = performance.now()

    const draw = (timestamp: number) => {
      const elapsed = timestamp - startTime

      // Clear with slight trail effect
      ctx.fillStyle = 'rgba(13, 10, 6, 0.15)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Draw static circuit grid (very faint)
      ctx.strokeStyle = 'rgba(184, 114, 72, 0.03)'
      ctx.lineWidth = 1
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        // Draw small node dot
        ctx.beginPath()
        ctx.arc(node.x, node.y, 1, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(184, 114, 72, 0.05)'
        ctx.fill()
      }

      // Update and draw active paths
      paths.forEach((path) => {
        // Check if should start firing
        if (!path.active && elapsed - path.lastFired > path.delay) {
          path.active = true
          path.progress = 0
          // Randomize next delay (3-12 seconds)
          path.delay = 3000 + Math.random() * 9000
        }

        if (path.active) {
          path.progress += path.speed

          if (path.progress >= 1) {
            path.active = false
            path.lastFired = elapsed
            path.progress = 0
            return
          }

          // Draw the animated path
          const totalLength = calculatePathLength(path.points)
          const currentLength = totalLength * path.progress

          ctx.beginPath()
          ctx.strokeStyle = path.color
          ctx.lineWidth = 1.5
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'

          let drawnLength = 0
          ctx.moveTo(path.points[0].x, path.points[0].y)

          for (let i = 1; i < path.points.length; i++) {
            const prev = path.points[i - 1]
            const curr = path.points[i]
            const segmentLength = Math.hypot(curr.x - prev.x, curr.y - prev.y)

            if (drawnLength + segmentLength <= currentLength) {
              ctx.lineTo(curr.x, curr.y)
              drawnLength += segmentLength
            } else {
              // Partial segment
              const remaining = currentLength - drawnLength
              const ratio = remaining / segmentLength
              const x = prev.x + (curr.x - prev.x) * ratio
              const y = prev.y + (curr.y - prev.y) * ratio
              ctx.lineTo(x, y)

              // Draw glowing head
              ctx.stroke()
              
              // Glow effect at head
              const gradient = ctx.createRadialGradient(x, y, 0, x, y, 8)
              gradient.addColorStop(0, path.color.replace('0.', '0.8').replace(')', ')'))
              gradient.addColorStop(1, 'transparent')
              ctx.fillStyle = gradient
              ctx.beginPath()
              ctx.arc(x, y, 8, 0, Math.PI * 2)
              ctx.fill()
              
              break
            }
          }

          ctx.stroke()

          // Draw fading trail
          const fadeStart = Math.max(0, path.progress - 0.3)
          if (fadeStart > 0) {
            ctx.strokeStyle = path.color.replace(/[\d.]+\)$/, '0.1)')
            ctx.lineWidth = 1
            ctx.beginPath()
            
            const fadeLength = totalLength * fadeStart
            let fadeDrawn = 0
            ctx.moveTo(path.points[0].x, path.points[0].y)

            for (let i = 1; i < path.points.length; i++) {
              const prev = path.points[i - 1]
              const curr = path.points[i]
              const segmentLength = Math.hypot(curr.x - prev.x, curr.y - prev.y)

              if (fadeDrawn + segmentLength <= fadeLength) {
                ctx.lineTo(curr.x, curr.y)
                fadeDrawn += segmentLength
              } else {
                const remaining = fadeLength - fadeDrawn
                const ratio = remaining / segmentLength
                ctx.lineTo(
                  prev.x + (curr.x - prev.x) * ratio,
                  prev.y + (curr.y - prev.y) * ratio
                )
                break
              }
            }
            ctx.stroke()
          }
        }
      })

      requestAnimationFrame(draw)
    }

    const calculatePathLength = (points: { x: number; y: number }[]) => {
      let length = 0
      for (let i = 1; i < points.length; i++) {
        length += Math.hypot(
          points[i].x - points[i - 1].x,
          points[i].y - points[i - 1].y
        )
      }
      return length
    }

    const animationId = requestAnimationFrame(draw)

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(animationId)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ 
        zIndex: 0,
        opacity: 0.6,
      }}
      aria-hidden="true"
    />
  )
}
