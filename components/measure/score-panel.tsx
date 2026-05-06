'use client'

import { useRef, useMemo, useState } from 'react'
import { useMeasureStore, FIELD_DEFS, type FieldId } from './measure-store'
import { computeVerifiedScoreStatus } from '@/lib/advanced-scoring/cross-validation'
import { computeSessionConfidence, confidenceTier } from '@/lib/advanced-scoring/confidence'
import type { AdvancedMeasurementSession, Calibration2D, Calibration3D } from '@/lib/advanced-scoring/types'
import { buildVerifiedPdfExportData } from '@/lib/export/build-verified-pdf-data'
import { buildVerifiedScorePdf } from '@/lib/export/score-pdf-builder'

// ─── Confidence indicator ─────────────────────────────────────────────────────

function ConfidenceDot({ level }: { level: 'high' | 'medium' | 'low' | 'none' }) {
  const color =
    level === 'high'   ? '#4fc36e' :
    level === 'medium' ? '#fbbf24' :
    level === 'low'    ? '#f87171' :
    'rgba(255,255,255,0.15)'
  return (
    <span
      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
      style={{ background: color }}
      title={level === 'none' ? 'Not measured' : `${level} confidence`}
    />
  )
}

// ─── Method badge ─────────────────────────────────────────────────────────────

function MethodBadge({ method }: { method: string }) {
  const label =
    method === 'photo_polyline'         ? '2D' :
    method === 'three_d_point_cloud'    ? '3D' :
    method === 'three_d_mesh_fallback'  ? 'mesh' :
    method === 'quick_ai'               ? 'AI' :
    method === 'manual_entry'           ? 'man' : '?'
  const color =
    method === 'three_d_point_cloud'    ? '#4fc36e' :
    method === 'photo_polyline'         ? '#4a90d9' :
    method === 'three_d_mesh_fallback'  ? '#e0a030' :
    'rgba(255,255,255,0.3)'

  return (
    <span
      className="text-xs font-mono px-1 rounded"
      style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}
    >
      {label}
    </span>
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
  method: string
  warnings: string[]
}

function buildRows(
  measurements2D: ReturnType<typeof useMeasureStore.getState>['measurements2D'],
  measurements3D: ReturnType<typeof useMeasureStore.getState>['measurements3D'],
): RowData[] {
  const pairs: Array<{
    left: FieldId; right: FieldId | null
    label: string; shortLabel: string; color: string
  }> = [
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
    const getBest = (fid: FieldId) => {
      const m3 = measurements3D[fid]
      const m2 = measurements2D[fid]
      // Prefer finalized 3D with real length
      if (m3.finalized && m3.inchLength > 0) {
        return { len: m3.inchLength, conf: m3.confidence, method: m3.method, warnings: m3.warnings }
      }
      // Prefer any 3D in progress over 2D if it has more points
      if (m3.points.length >= 2 && m3.inchLength > 0) {
        return { len: m3.inchLength, conf: m3.confidence, method: m3.method, warnings: m3.warnings }
      }
      if (m2.points.length >= 2) {
        return { len: m2.inchLength, conf: m2.confidence, method: m2.method, warnings: m2.warnings }
      }
      return { len: 0, conf: 'none' as const, method: 'none', warnings: [] }
    }

    const lData = getBest(p.left)
    const rData = p.right ? getBest(p.right) : null
    const diff = rData && rData.len > 0 && lData.len > 0
      ? Math.abs(lData.len - rData.len)
      : 0

    const confOrder = { high: 3, medium: 2, low: 1, none: 0 }
    const lConf = lData.conf as keyof typeof confOrder
    const rConf = (rData?.conf ?? 'none') as keyof typeof confOrder
    const worstConf = !p.right
      ? lConf
      : confOrder[lConf] <= confOrder[rConf] ? lConf : rConf

    const combinedWarnings = [
      ...lData.warnings,
      ...(rData?.warnings ?? []),
    ].filter((w, i, arr) => arr.indexOf(w) === i)

    return {
      id: p.left,
      label: p.label,
      shortLabel: p.shortLabel,
      color: p.color,
      left: lData.len,
      right: rData?.len ?? null,
      diff,
      confidence: worstConf as RowData['confidence'],
      method: lData.method,
      warnings: combinedWarnings,
    }
  })
}

// ─── Verified badge ───────────────────────────────────────────────────────────

function VerifiedBadge({ verified, reasons }: { verified: boolean; reasons: string[] }) {
  if (!verified) return null
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-bold"
      style={{ background: 'rgba(79,195,110,0.15)', color: '#4fc36e', border: '1px solid rgba(79,195,110,0.4)' }}
      title={`Verified: ${reasons.length === 0 ? 'All checks passed' : reasons.join('; ')}`}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
      Verified Score
    </div>
  )
}

// ─── Calibration & source warning ─────────────────────────────────────────────

function CalibrationWarning() {
  const calibration = useMeasureStore(s => s.calibration)
  if (calibration.finalized && calibration.source === 'physical_reference') return null
  if (!calibration.finalized) {
    return (
      <p className="text-xs px-3 py-2 rounded" style={{ background: 'rgba(251,191,36,0.08)', color: '#fbbf24' }}>
        Calibration not set — measurements are in pixels, not inches.
      </p>
    )
  }
  return (
    <p className="text-xs px-3 py-2 rounded" style={{ background: 'rgba(251,191,36,0.08)', color: '#fbbf24' }}>
      Estimated calibration — physical reference required for Verified Score.
    </p>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ScorePanel() {
  const scoreCardRef = useRef<HTMLDivElement>(null)
  const [pdfExportError, setPdfExportError] = useState<string | null>(null)

  // Use stable selectors — no getState() during render
  const measurements2D = useMeasureStore(s => s.measurements2D)
  const measurements3D = useMeasureStore(s => s.measurements3D)
  const calibration    = useMeasureStore(s => s.calibration)
  const calibration3D  = useMeasureStore(s => s.calibration3D)
  const getAdvancedMeasurements = useMeasureStore(s => s.getAdvancedMeasurements)
  const photoDataUrl = useMeasureStore(s => s.photoDataUrl)
  const reconstructionJob = useMeasureStore(s => s.reconstructionJob)
  const reconstructionAssets = useMeasureStore(s => s.reconstructionAssets)
  const pointCloud = useMeasureStore(s => s.pointCloud)

  const rows = useMemo(
    () => buildRows(measurements2D, measurements3D),
    [measurements2D, measurements3D],
  )

  // ── Scoring math ─────────────────────────────────────────────────────────────
  const grossScore = useMemo(() => {
    let sum = 0
    for (const row of rows) {
      sum += row.left
      if (row.right !== null) sum += row.right
    }
    return sum
  }, [rows])

  const totalDeductions = useMemo(
    () => rows.reduce((acc, r) => acc + (r.right !== null ? r.diff : 0), 0),
    [rows],
  )

  const netScore = grossScore - totalDeductions

  // ── Completeness ──────────────────────────────────────────────────────────────
  const filledFields  = rows.filter(r => r.left > 0).length
  const completeness  = filledFields / rows.length

  // ── Session confidence via advanced-scoring engine ─────────────────────────
  const sessionConfidence = useMemo(() => {
    const advMeasurements = getAdvancedMeasurements()
    return computeSessionConfidence(advMeasurements, FIELD_DEFS.length)
  }, [getAdvancedMeasurements, measurements2D, measurements3D])

  const overallConfTier = confidenceTier(sessionConfidence)

  // ── Verified status ────────────────────────────────────────────────────────
  const verifiedStatus = useMemo((): ReturnType<typeof computeVerifiedScoreStatus> => {
    const advMeasurements = getAdvancedMeasurements()
    const session: AdvancedMeasurementSession = {
      sessionId: 'current',
      calibration2D: calibration.finalized
        ? {
            photoId: 'primary',
            pixelsPerInch: calibration.pixelsPerInch,
            referenceLengthInches: calibration.realInches,
            referenceLine: {
              start: calibration.linePoints[0] ?? { x: 0, y: 0 },
              end:   calibration.linePoints[1] ?? { x: 0, y: 0 },
            },
            source: calibration.source,
          }
        : null,
      calibration3D: calibration3D.finalized
        ? { unitsPerInch: calibration3D.unitsPerInch, referenceLengthInches: 1, source: calibration3D.source }
        : null,
      measurements: advMeasurements,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    return computeVerifiedScoreStatus(session)
  }, [getAdvancedMeasurements, calibration, calibration3D, measurements2D, measurements3D])

  const buildCalibration2D = (): Calibration2D | null => (
    calibration.finalized
      ? {
          photoId: 'primary',
          pixelsPerInch: calibration.pixelsPerInch,
          referenceLengthInches: calibration.realInches,
          referenceLine: {
            start: calibration.linePoints[0] ?? { x: 0, y: 0 },
            end: calibration.linePoints[1] ?? { x: 0, y: 0 },
          },
          source: calibration.source,
        }
      : null
  )

  const buildCalibration3D = (): Calibration3D | null => (
    calibration3D.finalized
      ? {
          unitsPerInch: calibration3D.unitsPerInch,
          referenceLengthInches: 1,
          source: calibration3D.source,
        }
      : null
  )

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const handleExportVerifiedPDF = async () => {
    setPdfExportError(null)
    try {
      const advMeasurements = getAdvancedMeasurements()
      const exportData = buildVerifiedPdfExportData({
        grossScore,
        netScore,
        verifiedStatus,
        measurements: advMeasurements,
        fieldDefinitions: FIELD_DEFS.map((field) => ({
          measurementField: field.measurementField,
          label: field.label,
        })),
        calibration2D: buildCalibration2D(),
        calibration3D: buildCalibration3D(),
        reconstructionJob,
        reconstructionAssets,
        pointCloudPointCount: pointCloud.points.length,
        overallConfidence: sessionConfidence,
        photoThumbnails: photoDataUrl ? [photoDataUrl] : [],
      })
      const blob = await buildVerifiedScorePdf(exportData)
      downloadBlob(blob, verifiedStatus.verified ? 'rax-core-verified-score.pdf' : 'rax-core-advanced-score.pdf')
    } catch (error) {
      setPdfExportError(error instanceof Error ? error.message : 'PDF export failed.')
    }
  }

  // ── PDF export ────────────────────────────────────────────────────────────────
  const handleExportPDF = async () => {
    const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
      import('jspdf'),
      import('html2canvas'),
    ])
    const el = scoreCardRef.current
    if (!el) return
    const canvas  = await html2canvas(el, { backgroundColor: '#0d0a06', scale: 2, useCORS: true })
    const imgData = canvas.toDataURL('image/jpeg', 0.95)
    const pdf     = new jsPDF({ orientation: 'portrait', unit: 'px', format: [canvas.width / 2, canvas.height / 2] })
    pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width / 2, canvas.height / 2)
    pdf.save('draft-antler-score.pdf')
  }

  // ── Session export ────────────────────────────────────────────────────────────
  const handleExportJSON = () => {
    const state = useMeasureStore.getState()  // OK in event handler, not during render
    const data = {
      measurements2D: state.measurements2D,
      measurements3D: state.measurements3D,
      calibration: state.calibration,
      calibration3D: state.calibration3D,
      advancedMeasurements: state.getAdvancedMeasurements(),
      grossScore,
      netScore,
      completeness,
      sessionConfidence,
      verified: verifiedStatus.verified,
      reconstructionJob: state.reconstructionJob,
      reconstructionAssets: state.reconstructionAssets,
      exportedAt: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'antler-session.json'; a.click()
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
        {/* Title + verified */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs tracking-widest uppercase" style={{ color: 'rgba(200,169,110,0.5)' }}>
              Boone &amp; Crockett Score
            </p>
            <h2 className="text-3xl font-mono font-bold mt-0.5" style={{ color: '#c8a96e' }}>
              {netScore > 0 ? netScore.toFixed(2) : '--'}
            </h2>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="text-right">
              <p className="text-xs" style={{ color: 'rgba(200,169,110,0.5)' }}>Gross</p>
              <p className="text-lg font-mono" style={{ color: '#c8a96e' }}>{fmt(grossScore)}</p>
            </div>
            <VerifiedBadge verified={verifiedStatus.verified} reasons={verifiedStatus.reasons} />
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
              <ConfidenceDot level={overallConfTier} />
              <span
                className="text-xs capitalize font-medium"
                style={{
                  color: overallConfTier === 'high' ? '#4fc36e' :
                         overallConfTier === 'medium' ? '#fbbf24' : '#f87171'
                }}
              >
                {overallConfTier}
              </span>
              <span className="text-xs font-mono" style={{ color: 'rgba(255,255,255,0.3)' }}>
                ({(sessionConfidence * 100).toFixed(0)}%)
              </span>
            </div>
          </div>
        </div>

        {/* Score table */}
        <div>
          <div
            className="grid text-xs font-semibold pb-1 mb-1"
            style={{
              gridTemplateColumns: '1fr 3.5rem 3.5rem 3rem 1.25rem',
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

          {rows.map(row => (
            <div key={row.id}>
              <div
                className="grid items-center py-1 text-xs"
                style={{
                  gridTemplateColumns: '1fr 3.5rem 3.5rem 3rem 1.25rem',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}
              >
                <span className="flex items-center gap-1.5 min-w-0 font-medium" style={{ color: 'rgba(255,255,255,0.75)' }}>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: row.color }} />
                  <span className="truncate">{row.label}</span>
                </span>
                <span className="text-right font-mono" style={{ color: row.left > 0 ? '#e8d8b8' : 'rgba(255,255,255,0.2)' }}>
                  {fmt(row.left)}
                </span>
                <span className="text-right font-mono" style={{ color: row.right !== null && row.right > 0 ? '#e8d8b8' : 'rgba(255,255,255,0.2)' }}>
                  {row.right !== null ? fmt(row.right) : '--'}
                </span>
                <span className="text-right font-mono" style={{ color: row.diff > 0.5 ? '#f87171' : row.diff > 0 ? '#fbbf24' : 'rgba(255,255,255,0.2)' }}>
                  {row.diff > 0 ? row.diff.toFixed(2) : '--'}
                </span>
                <span className="flex justify-end">
                  <ConfidenceDot level={row.confidence} />
                </span>
              </div>
              {/* Method badge + per-row warnings */}
              {(row.left > 0 || (row.right !== null && row.right > 0)) && (
                <div className="flex items-center gap-1.5 pb-1 pl-3">
                  <MethodBadge method={row.method} />
                  {row.warnings.slice(0, 1).map((w, i) => (
                    <span key={i} className="text-xs" style={{ color: '#fbbf24' }}>{w}</span>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Deductions */}
          <div
            className="grid items-center py-1.5 text-xs mt-1"
            style={{ gridTemplateColumns: '1fr 3.5rem 3.5rem 3rem 1.25rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}
          >
            <span style={{ color: 'rgba(255,255,255,0.5)' }}>Total Deductions</span>
            <span /><span />
            <span className="text-right font-mono font-bold" style={{ color: '#f87171' }}>
              {totalDeductions > 0 ? `- ${totalDeductions.toFixed(2)}` : '--'}
            </span>
            <span />
          </div>

          {/* Net score */}
          <div
            className="grid items-center py-1.5 text-sm font-bold"
            style={{ gridTemplateColumns: '1fr 3.5rem 3.5rem 3rem 1.25rem', borderTop: '1px solid rgba(200,169,110,0.2)' }}
          >
            <span style={{ color: '#c8a96e' }}>Net Score</span>
            <span /><span />
            <span className="text-right font-mono" style={{ color: '#c8a96e' }}>
              {netScore > 0 ? netScore.toFixed(2) : '--'}
            </span>
            <span />
          </div>
        </div>

        {/* Verified reasons (if not verified) */}
        {!verifiedStatus.verified && verifiedStatus.reasons.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>Verified Score requires:</p>
            {verifiedStatus.reasons.slice(0, 3).map((r, i) => (
              <p key={i} className="text-xs pl-2" style={{ color: '#f87171' }}>
                &bull; {r}
              </p>
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
          {([['high', 'High confidence'], ['medium', 'Medium'], ['low', 'Low / discrepancy']] as const).map(([d, label]) => (
            <span key={d} className="flex items-center gap-1 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
              <ConfidenceDot level={d} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <button
          onClick={handleExportVerifiedPDF}
          className="w-full py-2 rounded text-sm font-medium transition-all"
          style={{ background: verifiedStatus.verified ? '#4fc36e' : '#c8a96e', color: '#0d0a06' }}
        >
          {verifiedStatus.verified ? 'Export Verified Score PDF' : 'Export Advanced Score PDF'}
        </button>
        <button
          onClick={handleExportPDF}
          className="w-full py-2 rounded text-sm font-medium transition-all"
          style={{ background: 'rgba(200,169,110,0.18)', color: '#c8a96e', border: '1px solid rgba(200,169,110,0.22)' }}
        >
          Export Draft PDF Score Sheet
        </button>
        {pdfExportError && (
          <p className="text-xs px-3 py-2 rounded" style={{ background: 'rgba(200,50,50,0.1)', color: '#f87171' }}>
            {pdfExportError}
          </p>
        )}
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

      {/* Calibration status */}
      <CalibrationWarning />
    </div>
  )
}
