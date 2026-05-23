'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Share2, Trash2, Loader2, Shield, Star, Brain } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import type { TrophyRoomEntry, TrophyMeasurements } from '@/lib/trophy-room/types'

const SCORING_LABEL: Record<string, string> = {
  bc_typical: 'B&C Typical',
  bc_nontypical: 'B&C Non-Typical',
  py_typical: 'P&Y Typical',
  py_nontypical: 'P&Y Non-Typical',
}

const FRACTION_MAP: Record<number, string> = { 1: '⅛', 2: '¼', 3: '⅜', 4: '½', 5: '⅝', 6: '¾', 7: '⅞' }

function formatScore(n: number): string {
  const whole = Math.floor(n)
  const eighths = Math.round((n - whole) * 8)
  if (eighths === 0) return `${whole}`
  if (eighths === 8) return `${whole + 1}`
  return `${whole} ${FRACTION_MAP[eighths]}`
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toFixed(1) + '"'
}

function fmtSum(a: number | null | undefined, b: number | null | undefined): string {
  if (a == null && b == null) return '—'
  return ((a ?? 0) + (b ?? 0)).toFixed(1) + '"'
}

// B&C tier classification for whitetail typical
function getScoreTier(gross: number): { label: string; color: string } {
  if (gross >= 170) return { label: 'All-Time Record Class', color: '#f59e0b' }
  if (gross >= 150) return { label: 'Exceptional Trophy', color: '#f97316' }
  if (gross >= 130) return { label: 'Trophy Quality', color: '#22c55e' }
  if (gross >= 115) return { label: 'Very Good Buck', color: '#3b82f6' }
  return { label: 'Good Buck', color: '#8b5cf6' }
}

function ScoreThermometer({ gross }: { gross: number }) {
  const MAX_SCORE = 220
  const pct = Math.min(gross / MAX_SCORE, 1)
  const tier = getScoreTier(gross)

  const markers = [
    { score: 115, label: '115"' },
    { score: 130, label: '130"' },
    { score: 150, label: '150"' },
    { score: 170, label: '170"' },
  ]

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
        <span>0"</span>
        <span style={{ color: tier.color }} className="font-semibold">{tier.label}</span>
        <span>220"</span>
      </div>
      <div className="relative h-5 rounded-full overflow-visible bg-gradient-to-r from-purple-900/60 via-blue-900/60 via-green-900/60 via-orange-900/60 to-amber-900/60 border border-white/10">
        {/* Zone fills */}
        <div className="absolute inset-0 rounded-full overflow-hidden flex">
          <div className="h-full bg-purple-800/40" style={{ width: `${115/MAX_SCORE*100}%` }} />
          <div className="h-full bg-blue-700/40" style={{ width: `${15/MAX_SCORE*100}%` }} />
          <div className="h-full bg-green-700/40" style={{ width: `${20/MAX_SCORE*100}%` }} />
          <div className="h-full bg-orange-600/40" style={{ width: `${20/MAX_SCORE*100}%` }} />
          <div className="h-full bg-amber-500/40" style={{ flex: 1 }} />
        </div>

        {/* Tick marks */}
        {markers.map(m => (
          <div
            key={m.score}
            className="absolute top-0 bottom-0 w-px bg-white/20"
            style={{ left: `${m.score / MAX_SCORE * 100}%` }}
          />
        ))}

        {/* Buck marker */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10"
          style={{ left: `${pct * 100}%` }}
        >
          <div
            className="w-4 h-6 rounded-sm shadow-lg border-2 border-white"
            style={{ background: tier.color }}
          />
        </div>
      </div>

      {/* Labels */}
      <div className="relative h-5 text-[10px] text-muted-foreground">
        {markers.map(m => (
          <span
            key={m.score}
            className="absolute -translate-x-1/2 whitespace-nowrap"
            style={{ left: `${m.score / MAX_SCORE * 100}%` }}
          >
            {m.label}
          </span>
        ))}
      </div>

      {/* Score callout */}
      <div className="text-center">
        <span className="text-4xl font-bold tabular-nums" style={{ color: tier.color }}>
          {formatScore(gross)}&quot;
        </span>
        <span className="ml-2 text-sm text-muted-foreground">gross</span>
      </div>
    </div>
  )
}

// Schematic antler SVG diagram with tine labels
function AntlerDiagram({ m }: { m: TrophyMeasurements }) {
  const hasData = m.g1_left != null || m.g2_left != null || m.g3_left != null

  if (!hasData) return null

  return (
    <div className="relative w-full max-w-sm mx-auto select-none">
      <svg viewBox="0 0 300 280" className="w-full" aria-label="Antler diagram">
        {/* Left beam */}
        <path d="M150 240 Q120 200 100 160 Q85 120 90 80 Q92 60 100 40" stroke="#d97706" strokeWidth="6" fill="none" strokeLinecap="round" />
        {/* Right beam */}
        <path d="M150 240 Q180 200 200 160 Q215 120 210 80 Q208 60 200 40" stroke="#d97706" strokeWidth="6" fill="none" strokeLinecap="round" />

        {/* Brow tines (G1) */}
        <path d="M112 195 Q95 180 80 165" stroke="#22c55e" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M188 195 Q205 180 220 165" stroke="#22c55e" strokeWidth="4" fill="none" strokeLinecap="round" />

        {/* G2 */}
        <path d="M104 155 Q82 145 65 130" stroke="#3b82f6" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M196 155 Q218 145 235 130" stroke="#3b82f6" strokeWidth="4" fill="none" strokeLinecap="round" />

        {/* G3 */}
        <path d="M100 115 Q78 108 60 95" stroke="#8b5cf6" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M200 115 Q222 108 240 95" stroke="#8b5cf6" strokeWidth="4" fill="none" strokeLinecap="round" />

        {/* G4 */}
        {(m.g4_left != null || m.g4_right != null) && <>
          <path d="M97 80 Q80 72 66 58" stroke="#ec4899" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M203 80 Q220 72 234 58" stroke="#ec4899" strokeWidth="4" fill="none" strokeLinecap="round" />
        </>}

        {/* Inside spread indicator */}
        <line x1="135" y1="250" x2="165" y2="250" stroke="#f59e0b" strokeWidth="2" strokeDasharray="4 2" />

        {/* Tine length labels */}
        {m.g1_left != null && <text x="65" y="170" fill="#22c55e" fontSize="11" fontWeight="600">{m.g1_left.toFixed(1)}&quot;</text>}
        {m.g1_right != null && <text x="215" y="170" fill="#22c55e" fontSize="11" fontWeight="600">{m.g1_right.toFixed(1)}&quot;</text>}
        {m.g2_left != null && <text x="42" y="132" fill="#3b82f6" fontSize="11" fontWeight="600">{m.g2_left.toFixed(1)}&quot;</text>}
        {m.g2_right != null && <text x="228" y="132" fill="#3b82f6" fontSize="11" fontWeight="600">{m.g2_right.toFixed(1)}&quot;</text>}
        {m.g3_left != null && <text x="38" y="94" fill="#8b5cf6" fontSize="11" fontWeight="600">{m.g3_left.toFixed(1)}&quot;</text>}
        {m.g3_right != null && <text x="235" y="94" fill="#8b5cf6" fontSize="11" fontWeight="600">{m.g3_right.toFixed(1)}&quot;</text>}
        {m.g4_left != null && <text x="50" y="57" fill="#ec4899" fontSize="11" fontWeight="600">{m.g4_left.toFixed(1)}&quot;</text>}
        {m.g4_right != null && <text x="228" y="57" fill="#ec4899" fontSize="11" fontWeight="600">{m.g4_right.toFixed(1)}&quot;</text>}

        {/* Beam labels */}
        {m.main_beam_left != null && <text x="78" y="260" fill="#d97706" fontSize="11" fontWeight="600">MB {m.main_beam_left.toFixed(1)}&quot;</text>}
        {m.main_beam_right != null && <text x="182" y="260" fill="#d97706" fontSize="11" fontWeight="600">MB {m.main_beam_right.toFixed(1)}&quot;</text>}

        {/* Inside spread label */}
        {m.inside_spread != null && <text x="120" y="275" fill="#f59e0b" fontSize="11" fontWeight="600">{m.inside_spread.toFixed(1)}&quot; spread</text>}

        {/* Legend dots */}
        <circle cx="12" cy="168" r="4" fill="#22c55e" />
        <text x="19" y="172" fill="#22c55e" fontSize="9">G1</text>
        <circle cx="12" cy="182" r="4" fill="#3b82f6" />
        <text x="19" y="186" fill="#3b82f6" fontSize="9">G2</text>
        <circle cx="12" cy="196" r="4" fill="#8b5cf6" />
        <text x="19" y="200" fill="#8b5cf6" fontSize="9">G3</text>
        <circle cx="12" cy="210" r="4" fill="#ec4899" />
        <text x="19" y="214" fill="#ec4899" fontSize="9">G4</text>
      </svg>
    </div>
  )
}

function MeasurementTable({ m, gross, net }: { m: TrophyMeasurements; gross: number; net: number | null }) {
  const rows: { label: string; left?: number | null; right?: number | null; single?: number | null; color?: string }[] = [
    { label: 'Main Beam', left: m.main_beam_left, right: m.main_beam_right, color: '#d97706' },
    { label: 'G1 Brow Tine', left: m.g1_left, right: m.g1_right, color: '#22c55e' },
    { label: 'G2', left: m.g2_left, right: m.g2_right, color: '#3b82f6' },
    { label: 'G3', left: m.g3_left, right: m.g3_right, color: '#8b5cf6' },
    { label: 'G4', left: m.g4_left, right: m.g4_right, color: '#ec4899' },
    ...(m.g5_left != null || m.g5_right != null ? [{ label: 'G5', left: m.g5_left, right: m.g5_right, color: '#14b8a6' }] : []),
    { label: 'H1 Circumference', left: m.h1_left, right: m.h1_right },
    { label: 'H2 Circumference', left: m.h2_left, right: m.h2_right },
    { label: 'H3 Circumference', left: m.h3_left, right: m.h3_right },
    { label: 'H4 Circumference', left: m.h4_left, right: m.h4_right },
    { label: 'Inside Spread', single: m.inside_spread },
    { label: 'Abnormal Points', single: m.abnormal_points ?? 0 },
  ]

  const deductions = m.deductions ?? 0

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/5">
            <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Field</th>
            <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Left</th>
            <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Right</th>
            <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const total = row.single != null
              ? row.single
              : (row.left ?? 0) + (row.right ?? 0)
            const asymm = row.left != null && row.right != null && Math.abs(row.left - row.right) > 1.0
            return (
              <tr key={row.label} className={i % 2 === 0 ? 'bg-white/[0.02]' : ''}>
                <td className="px-4 py-2.5 font-medium flex items-center gap-2">
                  {row.color && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: row.color }} />}
                  <span>{row.label}</span>
                  {asymm && (
                    <span
                      className="text-[10px] text-amber-400 border border-amber-400/40 rounded px-1 py-0.5 leading-none cursor-help"
                      title={`Left and right differ by ${Math.abs((row.left ?? 0) - (row.right ?? 0)).toFixed(1)}"`}
                      aria-label="Left and right asymmetry over 1 inch"
                    >
                      ≠
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                  {row.single != null ? '—' : fmt(row.left)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                  {row.single != null ? '—' : fmt(row.right)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                  {row.single != null ? fmt(row.single) : fmtSum(row.left, row.right)}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-white/10 bg-amber-500/10">
            <td colSpan={3} className="px-4 py-2.5 font-bold text-amber-300 uppercase text-xs tracking-wider">Gross Total</td>
            <td className="px-4 py-2.5 text-right font-bold text-amber-300 tabular-nums text-base">{gross.toFixed(1)}&quot;</td>
          </tr>
          {deductions > 0 && (
            <tr className="border-t border-white/5">
              <td colSpan={3} className="px-4 py-2.5 text-muted-foreground text-xs">Deductions</td>
              <td className="px-4 py-2.5 text-right text-red-400 tabular-nums text-sm">−{deductions.toFixed(1)}&quot;</td>
            </tr>
          )}
          {net != null && (
            <tr className="border-t border-white/10 bg-white/5">
              <td colSpan={3} className="px-4 py-2.5 font-bold text-foreground uppercase text-xs tracking-wider">Net Total</td>
              <td className="px-4 py-2.5 text-right font-bold tabular-nums text-base">{net.toFixed(1)}&quot;</td>
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  )
}

interface Props {
  entry: TrophyRoomEntry
  measurements: TrophyMeasurements | null
}

export function TrophyDetailClient({ entry: initial, measurements }: Props) {
  const router = useRouter()
  const [entry, setEntry] = useState(initial)
  const [deleting, setDeleting] = useState(false)

  // Poll for watermark completion
  useEffect(() => {
    if (entry.watermark_status === 'ready' || entry.watermark_status === 'failed') return
    const interval = setInterval(async () => {
      const res = await fetch(`/api/trophy-room/${entry.id}`)
      if (res.ok) {
        const fresh = await res.json() as TrophyRoomEntry
        setEntry(fresh)
        if (fresh.watermark_status === 'ready' || fresh.watermark_status === 'failed') {
          clearInterval(interval)
        }
      }
    }, 4000)
    return () => clearInterval(interval)
  }, [entry.id, entry.watermark_status])

  const imageUrl =
    entry.watermark_status === 'ready' && entry.watermarked_url ? entry.watermarked_url : entry.display_photo_url

  const tier = getScoreTier(entry.display_gross)

  async function handleShare() {
    if (!entry.watermarked_url) {
      toast.error('Watermark still generating')
      return
    }
    try {
      await navigator.clipboard.writeText(entry.watermarked_url)
      toast.success('Link copied to clipboard')
    } catch {
      toast.error('Failed to copy link')
    }
  }

  async function handleDownload() {
    if (!entry.watermarked_url) return
    const res = await fetch(entry.watermarked_url)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${entry.display_label?.replace(/[^\w-]+/g, '_') ?? 'trophy'}-${entry.id.slice(0, 8)}.jpg`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function handleDelete() {
    if (!confirm('Remove this entry from your Trophy Room?')) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/trophy-room/${entry.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      toast.success('Removed')
      router.push('/trophy-room')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Hero image */}
      <div className="rounded-2xl overflow-hidden bg-black border border-white/10 relative shadow-2xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={entry.display_label ?? 'Trophy'} className="w-full max-h-[70vh] object-contain" />

        {/* Score overlay */}
        {entry.watermark_status !== 'ready' && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-6">
            <div className="text-5xl font-black tabular-nums" style={{ color: tier.color }}>
              {formatScore(entry.display_gross)}&quot;
            </div>
            <div className="text-sm font-medium tracking-widest uppercase mt-1" style={{ color: `${tier.color}99` }}>
              {SCORING_LABEL[entry.scoring_system] ?? entry.scoring_system}
            </div>
            {entry.display_net != null && (
              <div className="text-sm text-white/60 mt-0.5">Net {entry.display_net.toFixed(1)}&quot;</div>
            )}
          </div>
        )}

        {/* Verified badge */}
        {entry.is_verified_score && (
          <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-amber-500 text-black text-xs font-bold px-2.5 py-1.5 rounded-full shadow-lg">
            <Shield className="h-3 w-3" />
            VERIFIED
          </div>
        )}

        {/* Watermark loading */}
        {(entry.watermark_status === 'pending' || entry.watermark_status === 'generating') && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 text-amber-200 text-xs px-2.5 py-1.5 rounded-full">
            <Loader2 className="h-3 w-3 animate-spin" />
            Generating watermark…
          </div>
        )}
        {entry.watermark_status === 'failed' && (
          <div className="absolute top-3 left-3 bg-red-900/80 text-red-200 text-xs px-2.5 py-1.5 rounded-full">
            Watermark failed
          </div>
        )}
      </div>

      {/* Buck name */}
      {entry.display_label && (
        <h1 className="text-2xl font-serif font-semibold text-center">{entry.display_label}</h1>
      )}

      {/* Score Thermometer */}
      <div className="rounded-2xl border border-white/10 bg-black/40 p-5 space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Score Range</h2>
        <ScoreThermometer gross={entry.display_gross} />
      </div>

      {/* Antler diagram + B&C breakdown */}
      {measurements && (
        <>
          <div className="rounded-2xl border border-white/10 bg-black/40 p-5 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Antler Breakdown</h2>
            <AntlerDiagram m={measurements} />
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/40 p-5 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">B&amp;C Score Sheet</h2>
            <MeasurementTable m={measurements} gross={entry.display_gross} net={entry.display_net} />
          </div>
        </>
      )}

      {/* Stats + confidence */}
      <div className="rounded-2xl border border-white/10 bg-black/40 p-5 space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Details</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">Scoring System</div>
            <div className="font-semibold">{SCORING_LABEL[entry.scoring_system] ?? entry.scoring_system}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">Confidence</div>
            <div className="font-semibold flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                entry.confidence_tier === 'very_high' ? 'bg-green-400' :
                entry.confidence_tier === 'high' ? 'bg-amber-400' : 'bg-zinc-400'
              }`} />
              {entry.confidence_tier === 'very_high' ? 'Very High' :
               entry.confidence_tier === 'high' ? 'High' :
               entry.confidence_tier}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">Status</div>
            <div className="font-semibold flex items-center gap-1.5">
              {entry.is_verified_score ? (
                <><Shield className="h-3.5 w-3.5 text-amber-400" /><span className="text-amber-400">Verified</span></>
              ) : (
                <><Star className="h-3.5 w-3.5 text-muted-foreground" /><span>AI Estimated</span></>
              )}
            </div>
          </div>
        </div>
        <div className="text-xs text-muted-foreground border-t border-white/10 pt-3">
          Added {new Date(entry.approved_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </div>

        {/* Learning contribution note */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-primary/5 rounded-lg px-3 py-2">
          <Brain className="h-3.5 w-3.5 text-primary flex-shrink-0" />
          <span>This score is contributing to AI accuracy training — corrections you make improve future results.</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={handleShare} disabled={!entry.watermarked_url} variant="outline">
          <Share2 className="h-4 w-4 mr-2" />Share link
        </Button>
        <Button onClick={handleDownload} disabled={!entry.watermarked_url} variant="outline">
          <Download className="h-4 w-4 mr-2" />Download
        </Button>
        <Button onClick={handleDelete} disabled={deleting} variant="destructive" className="ml-auto">
          <Trash2 className="h-4 w-4 mr-2" />
          {deleting ? 'Removing…' : 'Delete'}
        </Button>
      </div>
    </div>
  )
}
