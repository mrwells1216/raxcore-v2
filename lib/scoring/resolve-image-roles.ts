/**
 * Shared image-role resolver.
 *
 * Used by both the capture-quality summary (client) and can be called server-
 * side to ensure capture metadata and the actual scoring image roles always
 * agree on which image is front/left/right.
 *
 * Priority order for resolving a role:
 *   1. angle_type field
 *   2. angleType field (camelCase variant)
 *   3. angle field
 *   4. side field
 *
 * After an explicit pass, any remaining "unknown" slots are filled with the
 * roles that were not claimed yet, in front → left → right order.
 */

export type ResolvedImageAngle = 'front' | 'left' | 'right' | 'unknown'

export interface ImageRoleCandidate {
  angle_type?: string | null
  angleType?: string | null
  angle?: string | null
  side?: string | null
}

export interface ResolvedImageRole<T> {
  image: T
  resolvedAngle: ResolvedImageAngle
}

// ── normalizer ────────────────────────────────────────────────────────────────

function normalizeAngle(value: unknown): ResolvedImageAngle | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()

  if (v === 'front' || v === 'frontal' || v === 'front_center') return 'front'
  if (v === 'left' || v === 'left_side' || v === 'left-profile' || v === 'left_antler') return 'left'
  if (v === 'right' || v === 'right_side' || v === 'right-profile' || v === 'right_antler') return 'right'

  return null
}

function resolveExplicit(image: ImageRoleCandidate): ResolvedImageAngle | null {
  return (
    normalizeAngle(image.angle_type) ??
    normalizeAngle(image.angleType) ??
    normalizeAngle(image.angle) ??
    normalizeAngle(image.side)
  )
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Resolve the role (front / left / right / unknown) for each image in the
 * supplied array.
 *
 * Each explicit angle is claimed at most once. If the same role appears on
 * multiple images, only the first one keeps it; subsequent duplicates fall
 * through to "unknown" and are then backfilled with unclaimed roles.
 */
export function resolveImageRoles<T extends ImageRoleCandidate>(
  images: T[],
): Array<ResolvedImageRole<T>> {
  const claimed = new Set<ResolvedImageAngle>()

  // First pass: honour explicit metadata, claim each role at most once
  const firstPass: Array<ResolvedImageRole<T>> = images.map((image) => {
    const explicit = resolveExplicit(image)

    if (explicit && explicit !== 'unknown' && !claimed.has(explicit)) {
      claimed.add(explicit)
      return { image, resolvedAngle: explicit }
    }

    return { image, resolvedAngle: 'unknown' as ResolvedImageAngle }
  })

  // Second pass: fill unknown slots with unclaimed roles in canonical order
  const unclaimed: ResolvedImageAngle[] = (
    ['front', 'left', 'right'] as ResolvedImageAngle[]
  ).filter((role) => !claimed.has(role))

  let fillIndex = 0

  for (let i = 0; i < firstPass.length; i++) {
    if (firstPass[i].resolvedAngle === 'unknown' && fillIndex < unclaimed.length) {
      firstPass[i] = { image: firstPass[i].image, resolvedAngle: unclaimed[fillIndex] }
      fillIndex++
    }
  }

  return firstPass
}
