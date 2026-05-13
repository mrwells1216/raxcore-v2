'use client'

interface RaxcoreLogoProps {
  size?: number
  className?: string
}

export function RaxcoreLogo({ size = 40, className }: RaxcoreLogoProps) {
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
        {/* Metallic gradients */}
        <linearGradient id="copperGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#b87333" stopOpacity="1" />
          <stop offset="50%" stopColor="#dfaf8d" stopOpacity="1" />
          <stop offset="100%" stopColor="#8b4513" stopOpacity="1" />
        </linearGradient>

        <linearGradient id="frameGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#3a3a3a" stopOpacity="1" />
          <stop offset="50%" stopColor="#222222" stopOpacity="1" />
          <stop offset="100%" stopColor="#1a1a1a" stopOpacity="1" />
        </linearGradient>

        {/* Depth & glow filters */}
        <filter id="depth" x="-20%" y="-20%" width="140%" height="140%">
          <feOffset result="offOut" in="SourceAlpha" dx="0" dy="4" />
          <feGaussianBlur result="blurOut" in="offOut" stdDeviation="5" />
          <feBlend in="SourceGraphic" in2="blurOut" mode="normal" />
        </filter>

        <filter id="dataGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.2" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      {/* Layer 1: Background & 3D Frame */}
      <rect width="1000" height="500" fill="#121215" />
      
      <path 
        d="M 80,60 H 400 L 420,80 H 580 L 600,60 H 920 A 20,20 0 0 1 940,80 V 180 L 920,200 V 280 L 940,300 V 400 A 20,20 0 0 1 920,420 H 600 L 580,400 H 420 L 400,420 H 80 A 20,20 0 0 1 60,400 V 300 L 80,280 V 200 L 60,180 V 80 A 20,20 0 0 1 80,60 Z" 
        fill="url(#frameGradient)" 
        stroke="#444" 
        strokeWidth="2" 
        filter="url(#depth)" 
      />

      {/* Layer 2: Corner Hardware */}
      <g fill="#1a1a1a" stroke="#555" strokeWidth="1.5">
        <circle cx="95" cy="95" r="12" />
        <circle cx="905" cy="95" r="12" />
        <circle cx="95" cy="385" r="12" />
        <circle cx="905" cy="385" r="12" />
        <circle cx="95" cy="95" r="5" fill="#000" />
        <circle cx="905" cy="95" r="5" fill="#000" />
        <circle cx="95" cy="385" r="5" fill="#000" />
        <circle cx="905" cy="385" r="5" fill="#000" />
      </g>

      {/* Layer 3: Branding */}
      <g fontFamily="Arial, sans-serif" textAnchor="middle" fontWeight="bold">
        <text x="500" y="140" fontSize="60" letterSpacing="3">
          <tspan fill="url(#copperGradient)">RAX</tspan>
          <tspan fill="#a0a0a0">CORE</tspan>
        </text>
        <text x="500" y="180" fontSize="28" fill="#888" fontWeight="normal" letterSpacing="1.5">
          Antler Analytics
        </text>
      </g>

      {/* Layer 4: Analytical Scale */}
      <g stroke="#b87333" strokeWidth="1.5" transform="translate(0, 50)">
        <line x1="400" y1="350" x2="600" y2="350" />
        <line x1="400" y1="350" x2="400" y2="365" />
        <line x1="420" y1="350" x2="420" y2="360" />
        <line x1="440" y1="350" x2="440" y2="365" />
        <line x1="460" y1="350" x2="460" y2="360" />
        <line x1="480" y1="350" x2="480" y2="365" />
        <line x1="500" y1="350" x2="500" y2="375" strokeWidth="2.5" />
        <line x1="520" y1="350" x2="520" y2="365" />
        <line x1="540" y1="350" x2="540" y2="360" />
        <line x1="560" y1="350" x2="560" y2="365" />
        <line x1="580" y1="350" x2="580" y2="360" />
        <line x1="600" y1="350" x2="600" y2="365" />
      </g>

      {/* Layer 5: Circuitry Traces */}
      <g stroke="#c0c0c0" strokeWidth="1.2" fill="none" opacity="0.6" filter="url(#dataGlow)">
        <g id="left-circ">
          <path d="M 120,240 H 280 L 310,270" />
          <path d="M 180,240 L 150,210 V 170 H 120" />
          <path d="M 160,240 L 190,270 V 310 H 220" />
        </g>
        <g id="right-circ">
          <path d="M 880,240 H 720 L 690,270" />
          <path d="M 820,240 L 850,210 V 170 H 880" />
          <path d="M 840,240 L 810,270 V 310 H 780" />
        </g>
      </g>

      {/* Layer 6: Antler Wireframe Mesh */}
      <g filter="url(#dataGlow)" transform="translate(500, 340)">
        <g stroke="#ffffff" strokeWidth="0.6" fill="none" opacity="0.7">
          <g id="single-antler-final">
            <path d="M -10,10 Q -60,-10 -90,-80 Q -100,-120 -110,-180 Q -115,-220 -120,-240"/>
            <path d="M -20,15 Q -70,-5 -95,-80 Q -105,-120 -115,-180 Q -120,-220 -125,-240"/>
            <path d="M -85,-70 Q -60,-80 -50,-100 Q -40,-130 -30,-150"/>
            <path d="M -90,-100 Q -80,-110 -70,-130 Q -60,-150 -50,-170"/>
            <path d="M -70,-50 Q -50,-40 -40,-60"/>
            <path d="M -15,10 Q -40,-50 -70,-50 M -30,15 Q -60,-70 -85,-70"/>
          </g>
          {/* Mirrored right antler */}
          <g transform="scale(-1, 1)">
            <path d="M -10,10 Q -60,-10 -90,-80 Q -100,-120 -110,-180 Q -115,-220 -120,-240"/>
            <path d="M -20,15 Q -70,-5 -95,-80 Q -105,-120 -115,-180 Q -120,-220 -125,-240"/>
            <path d="M -85,-70 Q -60,-80 -50,-100 Q -40,-130 -30,-150"/>
            <path d="M -90,-100 Q -80,-110 -70,-130 Q -60,-150 -50,-170"/>
            <path d="M -70,-50 Q -50,-40 -40,-60"/>
            <path d="M -15,10 Q -40,-50 -70,-50 M -30,15 Q -60,-70 -85,-70"/>
          </g>
          <path d="M -10,10 Q 0,25 10,10" strokeWidth="1.5"/>
        </g>
      </g>
    </svg>
  )
}
