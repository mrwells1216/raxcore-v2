'use client'

interface PointCountSliderProps {
  label: string
  value: number | null
  min: number
  max: number
  displayValue: (v: number) => string
  helperText?: string
  onChange: (val: number | null) => void
}

export function PointCountSlider({
  label,
  value,
  min,
  max,
  displayValue,
  helperText,
  onChange,
}: PointCountSliderProps) {
  // Internal slider range: 0 = not set, 1..N maps to min..max
  const steps = max - min + 1
  const sliderMax = steps  // 0 = not set, 1..steps = min..max

  const sliderValue = value == null ? 0 : value - min + 1

  const handleChange = (raw: number) => {
    if (raw === 0) {
      onChange(null)
    } else {
      onChange(raw + min - 1)
    }
  }

  const displayLabel = value == null ? 'Not set' : displayValue(value)

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span
          className="text-xs font-bold tabular-nums px-2 py-0.5 rounded-full"
          style={
            value != null
              ? {
                  background: 'rgba(251,191,36,0.12)',
                  color: 'rgba(251,191,36,0.9)',
                  border: '1px solid rgba(251,191,36,0.25)',
                }
              : {
                  color: 'rgba(150,135,120,0.7)',
                }
          }
        >
          {displayLabel}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          onClick={() => {
            if (value == null) return
            const next = value - 1
            handleChange(next < min ? 0 : next - min + 1)
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border/60 text-sm font-bold text-muted-foreground hover:text-foreground disabled:opacity-30"
          disabled={value == null}
        >
          −
        </button>

        <input
          type="range"
          min={0}
          max={sliderMax}
          step={1}
          value={sliderValue}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange(parseInt(e.target.value, 10))}
          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-black/30 accent-[var(--bronze-light)]"
          aria-label={label}
          aria-valuetext={displayLabel}
        />

        <button
          type="button"
          aria-label={`Increase ${label}`}
          onClick={() => {
            if (value == null) {
              onChange(min)
            } else if (value < max) {
              onChange(value + 1)
            }
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border/60 text-sm font-bold text-muted-foreground hover:text-foreground disabled:opacity-30"
          disabled={value != null && value >= max}
        >
          +
        </button>
      </div>

      {helperText && (
        <p className="text-[11px] text-muted-foreground">{helperText}</p>
      )}
    </div>
  )
}
