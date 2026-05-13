/**
 * Subject Validation Layer
 * 
 * Pre-score validation to filter out non-deer / non-antler submissions
 * before they reach the scoring pipeline.
 * 
 * ARCHITECTURE NOTES (for future ML integration):
 * ─────────────────────────────────────────────────────────────────────
 * - Future: On-device deer classifier (TFLite/CoreML) for real-time detection
 * - Future: Antler presence detector for frame-by-frame validation
 * - Future: Usable-frame classifier (blur, exposure, occlusion scoring)
 * - Current: Rule-based heuristics using image metadata + user-declared sections
 * ─────────────────────────────────────────────────────────────────────
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type SubjectKind = 'deer' | 'antlers_only' | 'non_deer' | 'unknown'

export type ValidationSeverity = 'pass' | 'warn' | 'fail'

export interface SubjectValidationResult {
  /** Detected subject type */
  subjectKind: SubjectKind
  /** Confidence score 0-1 */
  confidence: number
  /** Whether a visible rack was detected or declared */
  hasVisibleRack: boolean
  /** Whether head/skull context is present */
  hasHeadOrSkull: boolean
  /** Whether this submission is likely usable for scoring */
  likelyUsable: boolean
  /** List of issues found */
  issues: string[]
  /** Overall severity */
  severity: ValidationSeverity
}

export type ImageSectionType = 'full_rack' | 'left_antler' | 'right_antler' | 'detail' | 'unknown'

export interface ValidationInput {
  /** Number of images in submission */
  imageCount: number
  /** User-declared section types */
  declaredSections: ImageSectionType[]
  /** Whether AI vision response detected a deer (if available) */
  aiDetectedDeer?: boolean
  /** Whether AI vision response detected antlers (if available) */
  aiDetectedAntlers?: boolean
  /** Average image quality score 0-1 (if available) */
  avgQualityScore?: number
  /** Whether this is from smart scan mode */
  isSmartScanMode: boolean
  /** Coverage zones satisfied (if available) */
  coverageZones?: {
    full_rack: boolean
    left_antler: boolean
    right_antler: boolean
  }
}

// ─── Validation Function ─────────────────────────────────────────────────────

/**
 * Validates whether a submission appears to contain a scorable deer/antler subject.
 * 
 * This is a rule-based validation layer that can be swapped for ML models later.
 * Currently uses:
 * - Image count requirements
 * - Section coverage heuristics
 * - AI detection signals (when available)
 * - Quality thresholds
 */
export function validateSubject(input: ValidationInput): SubjectValidationResult {
  const issues: string[] = []
  let confidence = 0.5 // Start neutral
  let subjectKind: SubjectKind = 'unknown'
  let hasVisibleRack = false
  let hasHeadOrSkull = false

  // ─── Rule 1: Minimum image count ────────────────────────────────────────────
  if (input.imageCount === 0) {
    issues.push('No images provided')
    return {
      subjectKind: 'unknown',
      confidence: 0,
      hasVisibleRack: false,
      hasHeadOrSkull: false,
      likelyUsable: false,
      issues,
      severity: 'fail',
    }
  }

  if (input.isSmartScanMode && input.imageCount < 2) {
    issues.push('Smart scan requires at least 2 captures')
    confidence -= 0.2
  }

  // ─── Rule 2: Section coverage ───────────────────────────────────────────────
  const hasFullRack = input.declaredSections.includes('full_rack')
  const hasLeftAntler = input.declaredSections.includes('left_antler')
  const hasRightAntler = input.declaredSections.includes('right_antler')
  
  if (hasFullRack) {
    hasVisibleRack = true
    hasHeadOrSkull = true // Full rack implies head context
    confidence += 0.15
    subjectKind = 'deer'
  }

  if (hasLeftAntler || hasRightAntler) {
    hasVisibleRack = true
    confidence += 0.1
    if (subjectKind === 'unknown') {
      subjectKind = 'antlers_only'
    }
  }

  // Coverage zones from smart scan
  if (input.coverageZones) {
    if (input.coverageZones.full_rack) {
      hasVisibleRack = true
      hasHeadOrSkull = true
      confidence += 0.1
      subjectKind = 'deer'
    }
    if (input.coverageZones.left_antler && input.coverageZones.right_antler) {
      confidence += 0.1
    }
  }

  // ─── Rule 3: AI detection signals ───────────────────────────────────────────
  if (input.aiDetectedDeer !== undefined) {
    if (input.aiDetectedDeer) {
      subjectKind = 'deer'
      hasHeadOrSkull = true
      confidence += 0.2
    } else {
      // AI says no deer - significant negative signal
      confidence -= 0.25
      if (subjectKind === 'unknown') {
        subjectKind = 'non_deer'
        issues.push('No deer detected in images')
      }
    }
  }

  if (input.aiDetectedAntlers !== undefined) {
    if (input.aiDetectedAntlers) {
      hasVisibleRack = true
      confidence += 0.15
    } else if (!hasVisibleRack) {
      issues.push('No visible antlers detected')
      confidence -= 0.15
    }
  }

  // ─── Rule 4: Quality threshold ──────────────────────────────────────────────
  if (input.avgQualityScore !== undefined) {
    if (input.avgQualityScore < 0.3) {
      issues.push('Image quality too low for reliable scoring')
      confidence -= 0.2
    } else if (input.avgQualityScore < 0.5) {
      issues.push('Image quality may affect accuracy')
      confidence -= 0.1
    } else if (input.avgQualityScore > 0.7) {
      confidence += 0.1
    }
  }

  // ─── Rule 5: No rack visible ────────────────────────────────────────────────
  if (!hasVisibleRack && input.imageCount >= 1) {
    issues.push('Unable to confirm visible rack')
    confidence -= 0.15
  }

  // ─── Clamp confidence ───────────────────────────────────────────────────────
  confidence = Math.max(0, Math.min(1, confidence))

  // ─── Determine severity ─────────────────────────────────────────────────────
  let severity: ValidationSeverity = 'pass'
  const likelyUsable = confidence >= 0.4 && hasVisibleRack

  if (!likelyUsable) {
    if (confidence < 0.25 || subjectKind === 'non_deer') {
      severity = 'fail'
    } else {
      severity = 'warn'
    }
  }

  return {
    subjectKind,
    confidence,
    hasVisibleRack,
    hasHeadOrSkull,
    likelyUsable,
    issues,
    severity,
  }
}

// ─── User-Friendly Messages ──────────────────────────────────────────────────

export function getValidationMessage(result: SubjectValidationResult): string {
  if (result.severity === 'pass') {
    return 'Ready for scoring'
  }

  if (result.subjectKind === 'non_deer') {
    return "This doesn't appear to be a deer or usable antler image."
  }

  if (!result.hasVisibleRack) {
    return "We couldn't confirm a visible rack. Try capturing the full rack first."
  }

  if (result.issues.length > 0) {
    // Return the most actionable issue
    const actionableIssues = result.issues.filter(
      i => i.includes('quality') || i.includes('captures') || i.includes('antlers')
    )
    if (actionableIssues.length > 0) {
      return actionableIssues[0]
    }
    return result.issues[0]
  }

  return 'Additional photos may improve accuracy'
}

// ─── Quick Validation Helpers ────────────────────────────────────────────────

/**
 * Quick check if minimum requirements are met for scoring.
 * Used before allowing form submission.
 */
export function canProceedToScoring(result: SubjectValidationResult): boolean {
  return result.likelyUsable || result.severity !== 'fail'
}

/**
 * Maps GridImage sections to validation section types
 */
export function mapGroupToSection(
  group: 'full_rack' | 'left_antler' | 'right_antler' | null | undefined
): ImageSectionType {
  if (group === 'full_rack') return 'full_rack'
  if (group === 'left_antler') return 'left_antler'
  if (group === 'right_antler') return 'right_antler'
  return 'unknown'
}

/**
 * Maps scan angle to validation section type
 */
export function mapScanAngleToSection(
  angle: 'front' | 'left' | 'right' | 'detail' | 'full-rack' | 'left-antler' | 'right-antler'
): ImageSectionType {
  switch (angle) {
    case 'front':
    case 'full-rack':
      return 'full_rack'
    case 'left':
    case 'left-antler':
      return 'left_antler'
    case 'right':
    case 'right-antler':
      return 'right_antler'
    case 'detail':
      return 'detail'
    default:
      return 'unknown'
  }
}
