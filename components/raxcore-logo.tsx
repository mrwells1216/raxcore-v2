'use client'

interface RaxcoreLogoProps {
  size?: number
  className?: string
}

export function RaxcoreLogo({ size = 48, className }: RaxcoreLogoProps) {
  // Wider viewBox to prevent clipping on the "E"
  const aspectRatio = 365 / 130
  const height = size
  const width = height * aspectRatio

  return (
    <svg
      viewBox="0 0 365 130"
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      className={className}
      aria-label="RAXcore Antler Analytics"
    >
      {/* Gradient definition for RAX */}
      <defs>
        <linearGradient id="raxGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#c8a96e" />
          <stop offset="50%" stopColor="#a86840" />
          <stop offset="100%" stopColor="#5c3418" />
        </linearGradient>
      </defs>

      {/* Main Title: RAX CORE */}
      <text
        x="5"
        y="65"
        fontFamily="'Segoe UI', Arial, sans-serif"
        fontWeight="800"
        fontSize="70"
      >
        <tspan fill="url(#raxGradient)">RAX</tspan>
        <tspan fill="none" stroke="#ffffff" strokeWidth="2" dx="5">
          CORE
        </tspan>
      </text>

      {/* Subtitle: Antler Analytics - solid white */}
      <text
        x="8"
        y="110"
        fontFamily="'Segoe UI', Arial, sans-serif"
        fontWeight="400"
        fontSize="32"
        fill="#ffffff"
      >
        Antler Analytics
      </text>
    </svg>
  )
}
