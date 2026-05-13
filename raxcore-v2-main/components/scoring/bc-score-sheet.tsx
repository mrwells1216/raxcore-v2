'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, AlertCircle, CheckCircle, HelpCircle, Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ScoreSheet, MeasurementLine, MeasurementConfidence, AntlerSideMeasurements } from '@/lib/scoring/score-sheet'
import { formatMeasurement } from '@/lib/scoring/score-sheet'

interface BCScoreSheetProps {
  scoreSheet: ScoreSheet
  className?: string
  defaultExpanded?: boolean
}

/**
 * Confidence indicator icon
 */
function ConfidenceIcon({ confidence }: { confidence: MeasurementConfidence }) {
  switch (confidence) {
    case 'high':
      return <CheckCircle className="h-3 w-3 text-green-500" />
    case 'medium':
      return <Info className="h-3 w-3 text-amber-500" />
    case 'low':
      return <AlertCircle className="h-3 w-3 text-orange-500" />
    case 'estimated':
      return <HelpCircle className="h-3 w-3 text-muted-foreground" />
  }
}

/**
 * Confidence badge color
 */
function getConfidenceBadgeVariant(confidence: MeasurementConfidence): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (confidence) {
    case 'high':
      return 'default'
    case 'medium':
      return 'secondary'
    case 'low':
      return 'destructive'
    case 'estimated':
      return 'outline'
  }
}

/**
 * Single measurement cell with optional tooltip
 */
function MeasurementCell({ 
  line, 
  label,
  showConfidence = true,
  className
}: { 
  line: MeasurementLine
  label?: string
  showConfidence?: boolean
  className?: string
}) {
  const content = (
    <div className={cn("flex items-center gap-1 font-mono text-sm", className)}>
      <span className={cn(
        line.confidence === 'estimated' && "text-muted-foreground italic"
      )}>
        {formatMeasurement(line.value)}
      </span>
      {showConfidence && <ConfidenceIcon confidence={line.confidence} />}
    </div>
  )

  if (line.note) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="cursor-help">{content}</div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="text-xs">{line.note}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return content
}

/**
 * Measurement row in the score sheet table
 */
function MeasurementRow({
  label,
  leftLine,
  rightLine,
  difference,
  description
}: {
  label: string
  leftLine: MeasurementLine
  rightLine: MeasurementLine
  difference?: number
  description?: string
}) {
  return (
    <tr className="border-b border-border/50 hover:bg-muted/30">
      <td className="py-2 px-3 text-sm font-medium">
        {description ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help underline decoration-dotted">{label}</span>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                <p className="text-xs">{description}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          label
        )}
      </td>
      <td className="py-2 px-3 text-right">
        <MeasurementCell line={leftLine} />
      </td>
      <td className="py-2 px-3 text-right">
        <MeasurementCell line={rightLine} />
      </td>
      <td className="py-2 px-3 text-right font-mono text-sm text-muted-foreground">
        {difference !== undefined ? formatMeasurement(difference) : '—'}
      </td>
    </tr>
  )
}

/**
 * Calculate difference between left and right values
 */
function getDifference(left: MeasurementLine, right: MeasurementLine): number | undefined {
  if (left.value === null || right.value === null) return undefined
  return Math.abs(left.value - right.value)
}

/**
 * Boone & Crockett Style Score Sheet Display
 */
export function BCScoreSheet({ scoreSheet, className, defaultExpanded = true }: BCScoreSheetProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const { left, right, spread, deductions, totals, abnormal_points, metadata } = scoreSheet

  return (
    <Card className={cn("overflow-hidden", className)}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader className="pb-2">
          <CollapsibleTrigger asChild>
            <button className="flex items-center justify-between w-full text-left">
              <div className="space-y-1">
                <CardTitle className="text-base flex items-center gap-2">
                  B&C Score Sheet
                  <Badge variant={getConfidenceBadgeVariant(metadata.overall_confidence)}>
                    {metadata.overall_confidence} confidence
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  {metadata.main_frame_points}-point {metadata.rack_type} • Scaled using {metadata.scaling_reference}
                </CardDescription>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-lg font-bold">{formatMeasurement(totals.gross.value)}</div>
                  <div className="text-xs text-muted-foreground">Gross</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold">{formatMeasurement(totals.net.value)}</div>
                  <div className="text-xs text-muted-foreground">Net</div>
                </div>
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </button>
          </CollapsibleTrigger>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            {/* Main Measurements Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-border">
                    <th className="py-2 px-3 text-left font-semibold">Measurement</th>
                    <th className="py-2 px-3 text-right font-semibold">Left</th>
                    <th className="py-2 px-3 text-right font-semibold">Right</th>
                    <th className="py-2 px-3 text-right font-semibold text-muted-foreground">Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Spread */}
                  <tr className="border-b border-border/50 bg-muted/20">
                    <td className="py-2 px-3 text-sm font-medium" colSpan={3}>
                      Inside Spread
                    </td>
                    <td className="py-2 px-3 text-right">
                      <MeasurementCell line={spread.inside} />
                    </td>
                  </tr>
                  <tr className="border-b border-border/50 bg-muted/20">
                    <td className="py-2 px-3 text-sm font-medium text-muted-foreground pl-6" colSpan={3}>
                      Spread Credit
                    </td>
                    <td className="py-2 px-3 text-right">
                      <MeasurementCell line={spread.credit} />
                    </td>
                  </tr>

                  {/* Main Beams */}
                  <MeasurementRow
                    label="Main Beam"
                    leftLine={left.main_beam}
                    rightLine={right.main_beam}
                    difference={getDifference(left.main_beam, right.main_beam)}
                    description="Length from burr to tip along outside curve"
                  />

                  {/* Tines */}
                  <MeasurementRow
                    label="G1 (Brow)"
                    leftLine={left.g1}
                    rightLine={right.g1}
                    difference={getDifference(left.g1, right.g1)}
                    description="First tine above burr, also called brow tine"
                  />
                  <MeasurementRow
                    label="G2"
                    leftLine={left.g2}
                    rightLine={right.g2}
                    difference={getDifference(left.g2, right.g2)}
                    description="Second tine, typically the longest"
                  />
                  <MeasurementRow
                    label="G3"
                    leftLine={left.g3}
                    rightLine={right.g3}
                    difference={getDifference(left.g3, right.g3)}
                    description="Third tine"
                  />
                  <MeasurementRow
                    label="G4"
                    leftLine={left.g4}
                    rightLine={right.g4}
                    difference={getDifference(left.g4, right.g4)}
                    description="Fourth tine (may be 0 for 8-pointers)"
                  />
                  {(left.g5.value || right.g5.value) && (
                    <MeasurementRow
                      label="G5"
                      leftLine={left.g5}
                      rightLine={right.g5}
                      difference={getDifference(left.g5, right.g5)}
                      description="Fifth tine if present"
                    />
                  )}

                  {/* Circumferences */}
                  <tr className="border-b border-border">
                    <td colSpan={4} className="py-1 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide bg-muted/30">
                      Circumferences (Mass)
                    </td>
                  </tr>
                  <MeasurementRow
                    label="H1"
                    leftLine={left.h1}
                    rightLine={right.h1}
                    difference={getDifference(left.h1, right.h1)}
                    description="Smallest circumference between burr and G1"
                  />
                  <MeasurementRow
                    label="H2"
                    leftLine={left.h2}
                    rightLine={right.h2}
                    difference={getDifference(left.h2, right.h2)}
                    description="Smallest circumference between G1 and G2"
                  />
                  <MeasurementRow
                    label="H3"
                    leftLine={left.h3}
                    rightLine={right.h3}
                    difference={getDifference(left.h3, right.h3)}
                    description="Smallest circumference between G2 and G3"
                  />
                  <MeasurementRow
                    label="H4"
                    leftLine={left.h4}
                    rightLine={right.h4}
                    difference={getDifference(left.h4, right.h4)}
                    description="Smallest circumference between G3 and G4"
                  />
                </tbody>
              </table>
            </div>

            {/* Totals and Deductions */}
            <div className="grid grid-cols-2 gap-4">
              {/* Side Totals */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Side Totals</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Left:</span>
                    <span className="font-mono">{formatMeasurement(totals.left_total)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Right:</span>
                    <span className="font-mono">{formatMeasurement(totals.right_total)}</span>
                  </div>
                </div>
                <div className="flex justify-between text-sm pt-1 border-t">
                  <span className="text-muted-foreground">Subtotal:</span>
                  <span className="font-mono font-medium">{formatMeasurement(totals.subtotal)}</span>
                </div>
              </div>

              {/* Deductions */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Deductions</h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Symmetry:</span>
                    <MeasurementCell line={deductions.symmetry_total} showConfidence={false} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Abnormal:</span>
                    <MeasurementCell line={deductions.abnormal_deduction} showConfidence={false} />
                  </div>
                </div>
              </div>
            </div>

            {/* Abnormal Points */}
            {abnormal_points.count > 0 && (
              <div className="p-3 bg-muted/30 rounded-lg space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Abnormal Points</span>
                  <Badge variant="secondary">{abnormal_points.count} detected</Badge>
                </div>
                <div className="text-sm text-muted-foreground">
                  Total length: <span className="font-mono">{formatMeasurement(abnormal_points.total_length.value)}</span>
                </div>
                {abnormal_points.notes?.map((note, i) => (
                  <p key={i} className="text-xs text-muted-foreground">{note}</p>
                ))}
              </div>
            )}

            {/* Final Scores */}
            <div className="flex justify-center gap-8 py-3 bg-muted/30 rounded-lg">
              <div className="text-center">
                <div className="text-2xl font-bold">{formatMeasurement(totals.gross.value)}</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Gross Score</div>
              </div>
              <div className="w-px bg-border" />
              <div className="text-center">
                <div className="text-2xl font-bold">{formatMeasurement(totals.net.value)}</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Net Score</div>
              </div>
            </div>

            {/* Notes */}
            {metadata.notes.length > 0 && (
              <div className="text-xs text-muted-foreground space-y-1">
                {metadata.notes.map((note, i) => (
                  <p key={i} className="flex items-start gap-1">
                    <Info className="h-3 w-3 mt-0.5 shrink-0" />
                    {note}
                  </p>
                ))}
              </div>
            )}

            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground border-t pt-3">
              <span className="font-medium">Confidence:</span>
              <span className="flex items-center gap-1"><CheckCircle className="h-3 w-3 text-green-500" /> High</span>
              <span className="flex items-center gap-1"><Info className="h-3 w-3 text-amber-500" /> Medium</span>
              <span className="flex items-center gap-1"><AlertCircle className="h-3 w-3 text-orange-500" /> Low</span>
              <span className="flex items-center gap-1"><HelpCircle className="h-3 w-3 text-muted-foreground" /> Estimated</span>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
