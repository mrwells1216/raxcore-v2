'use client'

interface RaxcoreLogoProps {
  size?: number
  className?: string
}

export function RaxcoreLogo({ size = 36, className }: RaxcoreLogoProps) {
  // Scale factor based on viewBox 1000x500, targeting the given height
  const aspectRatio = 1000 / 500
  const height = size
  const width = height * aspectRatio

  return (
    <svg
      viewBox="0 0 1000 500"
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      className={className}
      aria-label="RAXcore Antler Analytics"
    >
      <defs>
        {/* Copper Metallic Gradient */}
        <linearGradient id="copper" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#b87333" />
          <stop offset="50%" stopColor="#dfaf8d" />
          <stop offset="100%" stopColor="#8b4513" />
        </linearGradient>
        
        {/* Simple Shadow for Compatibility */}
        <filter id="shadow">
          <feDropShadow dx="0" dy="4" stdDeviation="3" floodOpacity="0.5"/>
        </filter>
      </defs>

      {/* 1. THE PLATE */}
      <path 
        d="M 80,60 H 400 L 420,80 H 580 L 600,60 H 920 A 20,20 0 0 1 940,80 V 180 L 920,200 V 280 L 940,300 V 400 A 20,20 0 0 1 920,420 H 600 L 580,400 H 420 L 400,420 H 80 A 20,20 0 0 1 60,400 V 300 L 80,280 V 200 L 60,180 V 80 A 20,20 0 0 1 80,60 Z" 
        fill="#1e1e1e" 
        stroke="#444" 
        strokeWidth="2" 
        filter="url(#shadow)" 
      />

      {/* 2. BRANDING */}
      <g fontFamily="system-ui, -apple-system, sans-serif" textAnchor="middle" fontWeight="bold">
        {/* RAXCORE */}
        <text x="500" y="140" fontSize="60" letterSpacing="3">
          <tspan fill="url(#copper)">RAX</tspan>
          <tspan fill="#a0a0a0">CORE</tspan>
        </text>
        {/* Antler Analytics */}
        <text x="500" y="185" fontSize="28" fontWeight="normal" letterSpacing="1.5">
          <tspan fill="url(#copper)">A</tspan>
          <tspan fill="#a0a0a0">ntler </tspan>
          <tspan fill="#a0a0a0">Analytics</tspan>
        </text>
      </g>

      {/* 3. CIRCUITRY */}
      <g stroke="#666" strokeWidth="1.2" fill="none" opacity="0.5">
        <path d="M 120,240 H 280 L 310,270" />
        <path d="M 180,240 L 150,210 V 170 H 120" />
        <path d="M 880,240 H 720 L 690,270" />
        <path d="M 820,240 L 850,210 V 170 H 880" />
      </g>

      {/* 4. ANTLERS */}
      <g transform="translate(500, 340)" stroke="#ffffff" strokeWidth="0.8" fill="none" opacity="0.6">
        <g id="antler-shape">
          <path d="M -10,10 Q -60,-10 -90,-80 Q -100,-120 -110,-180"/>
          <path d="M -20,15 Q -70,-5 -95,-80 Q -105,-120 -115,-180"/>
          <path d="M -85,-70 Q -60,-80 -50,-100 Q -40,-130 -30,-150"/>
          <path d="M -15,10 Q -40,-50 -70,-50"/>
        </g>
        {/* Mirrored right antler */}
        <g transform="scale(-1, 1)">
          <path d="M -10,10 Q -60,-10 -90,-80 Q -100,-120 -110,-180"/>
          <path d="M -20,15 Q -70,-5 -95,-80 Q -105,-120 -115,-180"/>
          <path d="M -85,-70 Q -60,-80 -50,-100 Q -40,-130 -30,-150"/>
          <path d="M -15,10 Q -40,-50 -70,-50"/>
        </g>
        <path d="M -10,10 Q 0,25 10,10" />
      </g>

      {/* 5. SCALE */}
      <path 
        d="M 400,400 H 600 M 400,400 V 410 M 450,400 V 410 M 500,400 V 420 M 550,400 V 410 M 600,400 V 410" 
        stroke="#b87333" 
        strokeWidth="1.5" 
      />
    </svg>
  )
}
