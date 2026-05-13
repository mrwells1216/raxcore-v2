'use client'

interface RaxcoreLogoProps {
  size?: number
  className?: string
}

export function RaxcoreLogo({ size = 48, className }: RaxcoreLogoProps) {
  // Tighter viewBox with minimal padding around the content
  const aspectRatio = 340 / 130
  const height = size
  const width = height * aspectRatio

  return (
    <svg
      viewBox="0 0 340 130"
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      className={className}
      aria-label="RAXcore Antler Analytics"
    >
      {/* Main Title: RAX CORE */}
      <text
        x="5"
        y="65"
        fontFamily="'Segoe UI', Arial, sans-serif"
        fontWeight="800"
        fontSize="70"
      >
        <tspan fill="#b87333">RAX</tspan>
        <tspan fill="none" stroke="#ffffff" strokeWidth="2" dx="5">
          CORE
        </tspan>
      </text>

      {/* Subtitle: Antler Analytics */}
      <text
        x="8"
        y="110"
        fontFamily="'Segoe UI', Arial, sans-serif"
        fontWeight="400"
        fontSize="32"
        fill="#b87333"
      >
        Antler Analytics
      </text>
    </svg>
  )
}
