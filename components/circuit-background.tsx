'use client'

import { useEffect, useRef } from 'react'

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

    // Circuit trace configuration - smaller, tighter grid
    const gridSize = 24
    const nodeRadius = 1.5

    // Generate grid nodes
    const getNodes = () => {
      const nodes: { x: number; y: number }[] = []
      const cols = Math.ceil(canvas.width / gridSize) + 2
      const rows = Math.ceil(canvas.height / gridSize) + 2

      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          nodes.push({
            x: i * gridSize,
            y: j * gridSize,
          })
        }
      }
      return nodes
    }

    // Circuit trace paths - strictly horizontal and vertical
    interface Trace {
      segments: { x1: number; y1: number; x2: number; y2: number }[]
      progress: number
      speed: number
      nextFireTime: number
      active: boolean
    }

    const createTrace = (): Trace => {
      const segments: { x1: number; y1: number; x2: number; y2: number }[] = []
      
      // Start at a random grid position
      let x = Math.floor(Math.random() * (canvas.width / gridSize)) * gridSize
      let y = Math.floor(Math.random() * (canvas.height / gridSize)) * gridSize
      
      // Create 3-8 segments, alternating horizontal/vertical
      const numSegments = 3 + Math.floor(Math.random() * 6)
      let isHorizontal = Math.random() > 0.5

      for (let i = 0; i < numSegments; i++) {
        const length = (2 + Math.floor(Math.random() * 6)) * gridSize
        
        let x2 = x
        let y2 = y

        if (isHorizontal) {
          x2 = x + (Math.random() > 0.5 ? length : -length)
          // Keep in bounds
          x2 = Math.max(0, Math.min(canvas.width, x2))
        } else {
          y2 = y + (Math.random() > 0.5 ? length : -length)
          // Keep in bounds
          y2 = Math.max(0, Math.min(canvas.height, y2))
        }

        if (x !== x2 || y !== y2) {
          segments.push({ x1: x, y1: y, x2, y2 })
          x = x2
          y = y2
        }

        isHorizontal = !isHorizontal
      }

      return {
        segments,
        progress: 0,
        speed: 0.003 + Math.random() * 0.004, // Slow and varied
        nextFireTime: Math.random() * 6000,
        active: false,
      }
    }

    // Create initial traces
    const traces: Trace[] = []
    for (let i = 0; i < 15; i++) {
      traces.push(createTrace())
    }

    let lastTime = performance.now()

    const draw = (timestamp: number) => {
      const deltaTime = timestamp - lastTime
      lastTime = timestamp

      // Clear canvas completely (no trail effect)
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Draw static circuit grid pattern (very subtle)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.015)'
      const nodes = getNodes()
      nodes.forEach(node => {
        ctx.beginPath()
        ctx.arc(node.x, node.y, nodeRadius, 0, Math.PI * 2)
        ctx.fill()
      })

      // Draw some static trace lines (very faint grid connectors)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)'
      ctx.lineWidth = 0.5
      for (let i = 0; i < canvas.width; i += gridSize * 4) {
        ctx.beginPath()
        ctx.moveTo(i, 0)
        ctx.lineTo(i, canvas.height)
        ctx.stroke()
      }
      for (let j = 0; j < canvas.height; j += gridSize * 4) {
        ctx.beginPath()
        ctx.moveTo(0, j)
        ctx.lineTo(canvas.width, j)
        ctx.stroke()
      }

      // Update and draw active traces
      traces.forEach((trace, idx) => {
        // Check if should start firing
        trace.nextFireTime -= deltaTime
        if (!trace.active && trace.nextFireTime <= 0) {
          trace.active = true
          trace.progress = 0
        }

        if (trace.active) {
          trace.progress += trace.speed

          if (trace.progress >= 1) {
            trace.active = false
            // Reset with new random delay (4-12 seconds)
            trace.nextFireTime = 4000 + Math.random() * 8000
            // Occasionally regenerate the trace path
            if (Math.random() > 0.7) {
              const newTrace = createTrace()
              traces[idx] = { ...newTrace, nextFireTime: trace.nextFireTime }
            }
            return
          }

          // Calculate total path length
          let totalLength = 0
          trace.segments.forEach(seg => {
            totalLength += Math.abs(seg.x2 - seg.x1) + Math.abs(seg.y2 - seg.y1)
          })

          const currentLength = totalLength * trace.progress

          // Draw the trace up to current progress
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
          ctx.lineWidth = 1
          ctx.lineCap = 'square'
          ctx.lineJoin = 'miter'

          let drawnLength = 0
          let headX = trace.segments[0]?.x1 || 0
          let headY = trace.segments[0]?.y1 || 0

          ctx.beginPath()
          if (trace.segments.length > 0) {
            ctx.moveTo(trace.segments[0].x1, trace.segments[0].y1)
          }

          for (const seg of trace.segments) {
            const segLength = Math.abs(seg.x2 - seg.x1) + Math.abs(seg.y2 - seg.y1)

            if (drawnLength + segLength <= currentLength) {
              ctx.lineTo(seg.x2, seg.y2)
              drawnLength += segLength
              headX = seg.x2
              headY = seg.y2
            } else {
              // Partial segment
              const remaining = currentLength - drawnLength
              const ratio = remaining / segLength
              
              if (seg.x1 !== seg.x2) {
                // Horizontal segment
                headX = seg.x1 + (seg.x2 - seg.x1) * ratio
                headY = seg.y1
              } else {
                // Vertical segment
                headX = seg.x1
                headY = seg.y1 + (seg.y2 - seg.y1) * ratio
              }
              
              ctx.lineTo(headX, headY)
              break
            }
          }
          ctx.stroke()

          // Draw small glowing head at current position
          const gradient = ctx.createRadialGradient(headX, headY, 0, headX, headY, 4)
          gradient.addColorStop(0, 'rgba(255, 255, 255, 0.5)')
          gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.15)')
          gradient.addColorStop(1, 'transparent')
          ctx.fillStyle = gradient
          ctx.beginPath()
          ctx.arc(headX, headY, 4, 0, Math.PI * 2)
          ctx.fill()

          // Draw node dots at corners
          ctx.fillStyle = 'rgba(255, 255, 255, 0.25)'
          trace.segments.forEach(seg => {
            ctx.beginPath()
            ctx.arc(seg.x1, seg.y1, 1.5, 0, Math.PI * 2)
            ctx.fill()
          })
        }
      })

      requestAnimationFrame(draw)
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
        opacity: 0.8,
      }}
      aria-hidden="true"
    />
  )
}
