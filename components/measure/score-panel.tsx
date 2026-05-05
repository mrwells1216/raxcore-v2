'use client'

import { useRef, useMemo } from 'react'
import { useMeasureStore, FIELD_DEFS, type FieldId } from './measure-store'

// ─── Confidence indicator ────────────────────────────────────────────────────

function ConfidenceDot({ level }: { level: 'high' | 'medium' | 'low' | 'none' }) {
  const color = level === 'high' ? '#4fc36e' : level === 'medium' ? '#fbbf24' : level === 'low' ? '#f87171' : 'rgba(255,255,255,0.15)'
  return (
    <span
      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
      style={{ background: color }}
      title={level === 'none' ? 'Not measured' : `${level} confidence`}
    />
  )
}

// ─── Row helpers ──────────────────────────────────────────────────────────────

interface RowData {
  id: FieldId
  label: string
  shortLabel: string
  color: string
  left: number
  right: number | null
  diff: number
  confidence: 'high' | 'medium' | 'low' | 'none'
}

function buildRows(
  measurements2D: ReturnType<typeof useMeasureStore.getState>['measurements2D'],
  measurements3D: ReturnType<typeof useMeasureStore.getState>['measurements3D'],
): RowData[] {
  // For each unique measurement group (beams, G1-G4, H1-H4, spread)
  // We fold left/right pairs into one row
  const pairs: Array<{ left: FieldId; right: FieldId | null; label: string; shortLabel: string; color: string }> = [
    { left: 'beam-left', right: 'beam-right', label: 'Main Beam',    shortLabel: 'Beam',  color: '#4a90d9' },
    { left: 'g1-left',   right: 'g1-right',   label: 'G-1 Tine',    shortLabel: 'G1',    color: '#4fc36e' },
    { left: 'g2-left',   right: 'g2-right',   label: 'G-2 Tine',    shortLabel: 'G2',    color: '#7bc950' },
    { left: 'g3-left',   right: 'g3-right',   label: 'G-3 Tine',    shortLabel: 'G3',    color: '#e0a030' },
    { left: 'g4-left',   right: 'g4-right',   label: 'G-4 Tine',    shortLabel: 'G4',    color: '#d08820' },
    { left: 'h1-left',   right: 'h1-right',   label: 'H-1 Circ.',   shortLabel: 'H1',    color: '#d94a4a' },
    { left: 'h2-left',   right: 'h2-right',   label: 'H-2 Circ.',   shortLabel: 'H2',    color: '#c43a3a' },
    { left: 'h3-left',   right: 'h3-right',   label: 'H-3 Circ.',   shortLabel: 'H3',    color: '#b42c2c' },
    { left: 'h4-left',   right: 'h4-right',   label: 'H-4 Circ.',   shortLabel: 'H4',    color: '#a41e1e' },
    { left: 'spread',    right: null,          label: 'Inside Spread', shortLabel: 'Spread', color: '#40c8c8' },
  ]

  return pairs.map(p => {
    const getLen = (fid: FieldId) => {
      const m2 = measurements2D[fid]
      const m3 = measurements3D[fid]
      // Prefer 3D if available, else 2D
      if (m3.points.length >= 2) return { len: m3.inchLength, conf: m3.confidence }
      if (m2.points.length >= 2) return { len: m2.inchLength, conf: m2.confidence }
      return { len: 0, conf: 'none' as const }
    }

    const lData = getLen(p.left)
    const rData = p.right ? getLen(p.right) : null

    const left  = lData.len
    const right = rData?.len ?? null

    // Difference (for deductions)
    const diff = right !== null ? Math.abs(left - right) : 0

    // Confidence: use lowest of left/right
    const confOrder = { high: 3, medium: 2, low: 1, none: 0 }
    const lConf = lData.conf as keyof typeof confOrder
    const rConf = (rData?.conf ?? 'none') as keyof typeof confOrder
    const worstConf = confOrder[lConf] <= confOrder[rConf] ? lConf : rConf

    return {
      id: p.left,
      label: p.label,
      shortLabel: p.shortLabel,
      color: p.color,
      left,
      right,
      diff,
      confidence: worstConf as RowData['confidence'],
    }
  })
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ScorePanel() {
  const scoreCardRef = useRef<HTMLDivElement>(null)
  const { measurements2D, measurements3D } = useMeasureStore()

  const rows = useMemo(
    () => buildRows(measurements2D, measurements3D),
    [measurements2D, measurements3D],
  )

  // ── Scoring math ────────────────────────────────────────────────────────────
  const grossScore = useMemo(() => {
    let sum = 0
    for (const row of rows) {
      sum += row.left
      if (row.right !== null) sum += row.right
    }
    return sum
  }, [rows])

  const totalDeductions = useMemo(() => {
    let sum = 0
    for (const row of rows) {
      if (row.right !== null) sum += row.diff
    }
    return sum
  }, [rows])

  const netScore = grossScore - totalDeductions

  // ── Completeness ─────────────────────────────────────────────────────────────
  const filledFields = rows.filter(r => r.left > 0).length
  const completeness = filledFields / rows.length

  // ── Overall confidence ──────────────────────────────────────────────────────
  const confOrder = { high: 3, medium: 2, low: 1, none: 0 }
  const avgConf = rows.reduce((acc, r) => acc + (confOrder[r.confidence] ?? 0), 0) / rows.length
  const overallConf: 'high' | 'medium' | 'low' = avgConf >= 2.5 ? 'high' : avgConf >= 1.5 ? 'medium' : 'low'

  // ── PDF export ───────────────────────────────────────────────────────────────
  const handleExportPDF = async () => {
    const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
      import('jspdf'),
      import('html2canvas'),
    ])

    const el = scoreCardRef.current
    if (!el) return

    const canvas = await html2canvas(el, {
      backgroundColor: '#0d0a06',
      scale: 2,
      useCORS: true,
    })

    const imgData = canvas.toDataURL('image/jpeg', 0.95)
    const pdf     = new jsPDF({ orientation: 'portrait', unit: 'px', format: [canvas.width / 2, canvas.height / 2] })
    pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width / 2, canvas.height / 2)
    pdf.save('antler-score.pdf')
  }

  // ── Session export ──────────────────────────────────────────────────────────
  const handleExportJSON = () => {
    const state = useMeasureStore.getState()
    const data = {
      measurements2D: state.measurements2D,
      measurements3D: state.measurements3D,
      calibration: state.calibration,
      grossScore,
      netScore,
      completeness,
      exportedAt: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = 'antler-session.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const fmt = (v: number) => v > 0 ? v.toFixed(2) : '--'

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto p-4">
      {/* Score header */}
      <div
        ref={scoreCardRef}
        className="rounded-lg p-4 flex flex-col gap-4"
        style={{ background: '#100d08', border: '1px solid rgba(200,169,110,0.15)' }}
      >
        {/* Title */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs tracking-widest uppercase" style={{ color: 'rgba(200,169,110,0.5)' }}>
              Boone &amp; Crockett Score
            </p>
            <h2 className="text-3xl font-mono font-bold mt-0.5" style={{ color: '#c8a96e' }}>
              {netScore > 0 ? netScore.toFixed(2) : '--'}
            </h2>
          </div>
          <div className="text-right">
            <p className="text-xs" style={{ color: 'rgba(200,169,110,0.5)' }}>Gross</p>
            <p className="text-lg font-mono" style={{ color: '#c8a96e' }}>{fmt(grossScore)}</p>
          </div>
        </div>

        {/* Completeness + confidence */}
        <div className="flex gap-4">
          <div className="flex-1">
            <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Completeness</p>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${completeness * 100}%`, background: '#c8a96e' }}
              />
            </div>
            <p className="text-xs mt-1 font-mono" style={{ color: '#c8a96e' }}>
              {Math.round(completeness * 100)}%
            </p>
          </div>
          <div>
            <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Confidence</p>
            <div className="flex items-center gap-1.5 mt-1">
              <ConfidenceDot level={overallConf} />
              <span className="text-xs capitalize font-medium" style={{ color: overallConf === 'high' ? '#4fc36e' : overallConf === 'medium' ? '#fbbf24' : '#f87171' }}>
                {overallConf}
              </span>
            </div>
          </div>
        </div>

        {/* Score table */}
        <div>
          {/* Table header */}
          <div
            className="grid text-xs font-semibold pb-1 mb-1"
            style={{
              gridTemplateColumns: '1fr 3.5rem 3.5rem 3.5rem 1.25rem',
              color: 'rgba(200,169,110,0.5)',
              borderBottom: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            <span>Measurement</span>
            <span className="text-right">Left</span>
            <span className="text-right">Right</span>
            <span className="text-right">Diff</span>
            <span />
          </div>

          {/* Rows */}
          {rows.map(row => (
            <div
              key={row.id}
              className="grid items-center py-1 text-xs"
              style={{
                gridTemplateColumns: '1fr 3.5rem 3.5rem 3.5rem 1.25rem',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
              }}
            >
              {/* Label with color swatch */}
              <span className="flex items-center gap-1.5 min-w-0 font-medium" style={{ color: 'rgba(255,255,255,0.75)' }}>
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: row.color }} />
                <span className="truncate">{row.label}</span>
              </span>
              {/* Left */}
              <span className="text-right font-mono" style={{ color: row.left > 0 ? '#e8d8b8' : 'rgba(255,255,255,0.2)' }}>
                {fmt(row.left)}
              </span>
              {/* Right */}
              <span className="text-right font-mono" style={{ color: row.right !== null && row.right > 0 ? '#e8d8b8' : 'rgba(255,255,255,0.2)' }}>
                {row.right !== null ? fmt(row.right) : '--'}
              </span>
              {/* Diff */}
              <span className="text-right font-mono" style={{ color: row.diff > 0.5 ? '#f87171' : row.diff > 0 ? '#fbbf24' : 'rgba(255,255,255,0.2)' }}>
                {row.diff > 0 ? row.diff.toFixed(2) : '--'}
              </span>
              {/* Confidence dot */}
              <span className="flex justify-end">
                <ConfidenceDot level={row.confidence} />
              </span>
            </div>
          ))}

          {/* Deductions row */}
          <div
            className="grid items-center py-1.5 text-xs mt-1"
            style={{
              gridTemplateColumns: '1fr 3.5rem 3.5rem 3.5rem 1.25rem',
              borderTop: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <span style={{ color: 'rgba(255,255,255,0.5)' }}>Total Deductions</span>
            <span />
            <span />
            <span className="text-right font-mono font-bold" style={{ color: '#f87171' }}>
              {totalDeductions > 0 ? `- ${totalDeductions.toFixed(2)}` : '--'}
            </span>
            <span />
          </div>

          {/* Net score row */}
          <div
            className="grid items-center py-1.5 text-sm font-bold"
            style={{
              gridTemplateColumns: '1fr 3.5rem 3.5rem 3.5rem 1.25rem',
              borderTop: '1px solid rgba(200,169,110,0.2)',
            }}
          >
            <span style={{ color: '#c8a96e' }}>Net Score</span>
            <span />
            <span />
            <span className="text-right font-mono" style={{ color: '#c8a96e' }}>
              {netScore > 0 ? netScore.toFixed(2) : '--'}
            </span>
            <span />
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
          {[
            { dot: 'high',   label: 'High confidence' },
            { dot: 'medium', label: 'Medium' },
            { dot: 'low',    label: 'Low / discrepancy' },
          ].map(item => (
            <span key={item.dot} className="flex items-center gap-1 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
              <ConfidenceDot level={item.dot as 'high' | 'medium' | 'low'} />
              {item.label}
            </span>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <button
          onClick={handleExportPDF}
          className="w-full py-2 rounded text-sm font-medium transition-all"
          style={{ background: '#c8a96e', color: '#0d0a06' }}
        >
          Export PDF Score Sheet
        </button>
        <button
          onClick={handleExportJSON}
          className="w-full py-2 rounded text-sm transition-all"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(200,169,110,0.7)',
          }}
        >
          Save Session (JSON)
        </button>
      </div>

      {/* Calibration reminder */}
      {!useMeasureStore.getState().calibration.finalized && (
        <p className="text-xs px-3 py-2 rounded" style={{ background: 'rgba(251,191,36,0.08)', color: '#fbbf24' }}>
          Calibration not set — measurements are in pixels, not inches.
        </p>
      )}
    </div>
  )
}
