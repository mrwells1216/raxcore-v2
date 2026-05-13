export function getReviewCompleteness(measurements: any): number {
  if (!measurements) return 0

  let total = 0
  let filled = 0

  const check = (val: any) => {
    total++
    if (typeof val === 'number') filled++
  }

  // Core measurements
  check(measurements.insideSpread ?? measurements.inside_spread)
  check(measurements.mainBeamLeft ?? measurements.main_beam_left)
  check(measurements.mainBeamRight ?? measurements.main_beam_right)

  // Tines (G1-G5 left and right)
  const tineKeys = ['g1', 'g2', 'g3', 'g4', 'g5']
  for (const key of tineKeys) {
    check(measurements[`${key}_left`] ?? measurements[`${key}Left`])
    check(measurements[`${key}_right`] ?? measurements[`${key}Right`])
  }

  // Mass measurements (H1-H4 left and right)
  const massKeys = ['h1', 'h2', 'h3', 'h4']
  for (const key of massKeys) {
    check(measurements[`${key}_left`] ?? measurements[`${key}Left`])
    check(measurements[`${key}_right`] ?? measurements[`${key}Right`])
  }

  // Handle array-based formats
  if (Array.isArray(measurements.beams)) {
    measurements.beams.forEach((b: any) => check(b?.length ?? b))
  }

  if (Array.isArray(measurements.tines)) {
    measurements.tines.forEach((side: any[]) => {
      if (Array.isArray(side)) {
        side.forEach((t: any) => check(t?.length ?? t))
      }
    })
  }

  if (Array.isArray(measurements.mass)) {
    measurements.mass.forEach((side: any[]) => {
      if (Array.isArray(side)) {
        side.forEach((m: any) => check(m))
      }
    })
  }

  if (!total) return 0

  return Math.round((filled / total) * 100)
}

export function isOfficialScore(completeness: number): boolean {
  return completeness >= 90
}
