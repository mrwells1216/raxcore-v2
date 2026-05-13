'use client'

interface RaxcoreLogoProps {
  size?: number
  className?: string
}

export function RaxcoreLogo({ size = 36, className }: RaxcoreLogoProps) {
  // Scale factor based on viewBox 800x400, targeting the given height
  const aspectRatio = 800 / 400
  const height = size
  const width = height * aspectRatio

  return (
    <svg
      viewBox="0 0 800 400"
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      className={className}
      aria-label="RAXcore Antler Analytics"
    >
      <defs>
        <linearGradient id="copperGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#d4a84b" />
          <stop offset="50%" stopColor="#b87248" />
          <stop offset="100%" stopColor="#8b5a2b" />
        </linearGradient>
        <linearGradient id="frameGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#2a2a2a" />
          <stop offset="100%" stopColor="#1a1a1a" />
        </linearGradient>
      </defs>

      {/* Frame background */}
      <g id="frame">
        <rect
          x="50"
          y="50"
          width="700"
          height="300"
          rx="12"
          fill="url(#frameGradient)"
          stroke="#333"
          strokeWidth="2"
        />
      </g>

      {/* Circuit traces */}
      <g id="traces" stroke="#4a4a4a" strokeWidth="1.5" fill="none">
        {/* Left side traces */}
        <path d="M70,100 L120,100 L140,120 L140,180" />
        <path d="M70,150 L100,150 L120,170 L120,280" />
        <path d="M70,200 L90,200 L90,250 L130,250" />
        
        {/* Right side traces */}
        <path d="M730,100 L680,100 L660,120 L660,180" />
        <path d="M730,150 L700,150 L680,170 L680,280" />
        <path d="M730,200 L710,200 L710,250 L670,250" />
        
        {/* Bottom traces */}
        <path d="M200,330 L200,300 L280,300" />
        <path d="M600,330 L600,300 L520,300" />
        
        {/* Connection nodes */}
        <circle cx="140" cy="180" r="4" fill="#4a4a4a" />
        <circle cx="120" cy="280" r="4" fill="#4a4a4a" />
        <circle cx="130" cy="250" r="4" fill="#4a4a4a" />
        <circle cx="660" cy="180" r="4" fill="#4a4a4a" />
        <circle cx="680" cy="280" r="4" fill="#4a4a4a" />
        <circle cx="670" cy="250" r="4" fill="#4a4a4a" />
      </g>

      {/* Antler wireframe (simplified) */}
      <g id="antler-wireframe" stroke="#666" strokeWidth="0.8" fill="none" opacity="0.5">
        {/* Left antler outline */}
        <path d="M300,280 Q280,220 260,180 Q250,160 270,140 Q290,120 320,130" />
        <path d="M280,200 Q260,180 250,150" />
        <path d="M290,170 Q275,150 280,130" />
        
        {/* Right antler outline */}
        <path d="M500,280 Q520,220 540,180 Q550,160 530,140 Q510,120 480,130" />
        <path d="M520,200 Q540,180 550,150" />
        <path d="M510,170 Q525,150 520,130" />
        
        {/* Center beam */}
        <path d="M360,280 L360,250 Q380,230 400,230 Q420,230 440,250 L440,280" />
      </g>

      {/* Main text */}
      <text
        x="400"
        y="200"
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="72"
        fontWeight="700"
        letterSpacing="8"
      >
        <tspan fill="url(#copperGradient)">RAX</tspan>
        <tspan fill="#999">CORE</tspan>
      </text>

      {/* Tagline */}
      <text
        x="400"
        y="245"
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="14"
        fontWeight="500"
        letterSpacing="4"
        fill="#666"
      >
        ANTLER ANALYTICS
      </text>
    </svg>
  )
}
