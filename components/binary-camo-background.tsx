'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Paintbrush } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CamoTheme {
  name: string
  tones: string[]
  bg: string
}

const CAMO_THEMES: CamoTheme[] = [
  {
    name: 'Rustic',
    tones: ['rgba(139,90,74,0.18)', 'rgba(166,123,104,0.22)', 'rgba(196,152,136,0.18)', 'rgba(157,104,88,0.2)', 'rgba(212,168,152,0.18)'],
    bg: '#1a120e',
  },
  {
    name: 'Deep Rust',
    tones: ['rgba(154,95,77,0.18)', 'rgba(185,139,118,0.22)', 'rgba(208,164,136,0.18)', 'rgba(170,124,106,0.2)', 'rgba(228,186,168,0.18)'],
    bg: '#150d0a',
  },
  {
    name: 'Woodland',
    tones: ['rgba(95,111,88,0.18)', 'rgba(122,139,112,0.22)', 'rgba(141,155,128,0.18)', 'rgba(106,122,98,0.2)', 'rgba(154,170,144,0.18)'],
    bg: '#0b0f0b',
  },
  {
    name: 'Night Ops',
    tones: ['rgba(74,90,104,0.18)', 'rgba(93,112,128,0.22)', 'rgba(112,136,152,0.18)', 'rgba(85,101,112,0.2)', 'rgba(122,144,160,0.18)'],
    bg: '#0a0f14',
  },
]

interface RainDrop {
  y: number
  speed: number
  char: 'X' | 'R'
  tone: number
}

interface BinaryCamoBackgroundProps {
  className?: string
  showToggle?: boolean
  showDeerOverlay?: boolean
  deerImageSrc?: string
  showRaxTitle?: boolean
}

export function BinaryCamoBackground({ 
  className, 
  showToggle = true,
  showDeerOverlay = true,
  deerImageSrc = '/deer_clean_85.png',
  showRaxTitle = true
}: BinaryCamoBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number>(0)
  const dropsRef = useRef<RainDrop[]>([])
  const dimensionsRef = useRef({ w: 0, h: 0, cols: 0 })
  const timeRef = useRef<number>(0)
  const [themeIndex, setThemeIndex] = useState(0)
  const themeRef = useRef(CAMO_THEMES[0])

  const cellSize = 22

  const buildRain = useCallback((cols: number, h: number) => {
    const drops: RainDrop[] = []
    for (let i = 0; i < cols; i++) {
      drops.push({
        y: Math.random() * -h,
        speed: cellSize * (0.52 + Math.random() * 0.38),
        char: Math.random() > 0.5 ? 'X' : 'R',
        tone: Math.floor(Math.random() * themeRef.current.tones.length),
      })
    }
    return drops
  }, [])

  const resize = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = window.devicePixelRatio || 1
    const w = window.innerWidth
    const h = window.innerHeight
    const cols = Math.ceil(w / cellSize)

    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`

    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    dimensionsRef.current = { w, h, cols }
    dropsRef.current = buildRain(cols, h)
  }, [buildRain])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    timeRef.current += 0.016

    const { w, h, cols } = dimensionsRef.current
    const drops = dropsRef.current
    const theme = themeRef.current

    ctx.fillStyle = theme.bg
    ctx.fillRect(0, 0, w, h)

    // trailing fade for rain effect
    ctx.fillStyle = 'rgba(8, 6, 6, 0.12)'
    ctx.fillRect(0, 0, w, h)

    ctx.font = `${cellSize}px monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'

    for (let i = 0; i < cols; i++) {
      const drop = drops[i]
      const x = i * cellSize + cellSize / 2
      const y = drop.y

      // draw a short trail per column
      for (let trail = 0; trail < 8; trail++) {
        const drawY = y - trail * cellSize * 0.92
        if (drawY < -cellSize || drawY > h + cellSize) continue

        const alpha = Math.max(0.04, 0.22 - trail * 0.025)
        const baseColor = theme.tones[(drop.tone + trail) % theme.tones.length]
        const color = baseColor.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^\)]+\)/, (_m, r, g, b) => `rgba(${r},${g},${b},${alpha})`)

        ctx.fillStyle = color
        ctx.fillText(trail === 0 ? drop.char : Math.random() > 0.5 ? 'X' : 'R', x, drawY)
      }

      drop.y += drop.speed

      if (Math.random() > 0.992) {
        drop.char = drop.char === 'X' ? 'R' : 'X'
      }
      if (Math.random() > 0.996) {
        drop.tone = Math.floor(Math.random() * theme.tones.length)
      }

      if (drop.y > h + Math.random() * 220) {
        drop.y = -Math.random() * 280
        drop.speed = cellSize * (0.52 + Math.random() * 0.38)
      }
    }

    animationRef.current = requestAnimationFrame(draw)
  }, [])

  useEffect(() => {
    themeRef.current = CAMO_THEMES[themeIndex]
  }, [themeIndex])

  useEffect(() => {
    resize()
    animationRef.current = requestAnimationFrame(draw)

    const handleResize = () => resize()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      cancelAnimationFrame(animationRef.current)
    }
  }, [resize, draw])

  const cycleTheme = () => {
    setThemeIndex((prev) => (prev + 1) % CAMO_THEMES.length)
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        className={cn('absolute inset-0', className)}
        style={{ display: 'block' }}
      />

      {/* base atmosphere */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(to bottom, rgba(20, 14, 10, 0.28), rgba(10, 8, 8, 0.52))',
          zIndex: 1,
        }}
      />

      {/* subtle ambient behind the deer - no glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          zIndex: 2,
        }}
      />

      {/* RaX Title - preserve existing title styling */}
      {showRaxTitle && (
        <div 
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ zIndex: 2 }}
        >
          <h1
            className="font-bold tracking-[0.2em] uppercase select-none"
            style={{
              fontSize: 'clamp(6rem, 20vw, 16rem)',
              color: 'rgba(230, 122, 61, 0.05)',
              textShadow: '0 0 60px rgba(230, 122, 61, 0.04)',
              letterSpacing: '0.25em',
            }}
          >
            RaX
          </h1>
        </div>
      )}
      
      {/* Deer image overlay - soft blended edges */}
      {showDeerOverlay && (
        <div 
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ zIndex: 3 }}
        >
          <img
            src={deerImageSrc}
            alt="RaX deer mark"
            className="select-none"
            style={{
              width: 'min(90vw, 840px)',
              maxWidth: '840px',
              minWidth: '400px',
              opacity: 0.55,
              filter: 'blur(0.5px) brightness(0.7) saturate(0.7)',
              WebkitMaskImage: 'radial-gradient(ellipse 75% 70% at center, rgba(0,0,0,1) 0%, rgba(0,0,0,0.85) 35%, rgba(0,0,0,0.5) 60%, rgba(0,0,0,0.2) 80%, rgba(0,0,0,0) 100%)',
              maskImage: 'radial-gradient(ellipse 75% 70% at center, rgba(0,0,0,1) 0%, rgba(0,0,0,0.85) 35%, rgba(0,0,0,0.5) 60%, rgba(0,0,0,0.2) 80%, rgba(0,0,0,0) 100%)',
            }}
          />
        </div>
      )}
      {showToggle && (
        <Button
          variant="outline"
          size="sm"
          onClick={cycleTheme}
          className="absolute top-4 right-4 z-10 bg-background/50 backdrop-blur-sm border-border/50 hover:bg-background/70 gap-2 text-xs"
        >
          <Paintbrush className="h-3.5 w-3.5" />
          {CAMO_THEMES[themeIndex].name}
        </Button>
      )}


    </>
  )
}
