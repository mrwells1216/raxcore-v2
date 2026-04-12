export type ReferenceType =
  | 'none'
  | 'ruler'
  | 'credit_card'
  | 'coin'
  | 'aruco_marker'
  | 'other_known_object'

export type ReferenceModeSummary = {
  precisionModeEnabled: boolean
  referenceType: ReferenceType
  referencePresent: boolean
  referenceNotes: string | null
  shouldBoostConfidenceLater: boolean
}

export function buildReferenceModeSummary(params: {
  precisionModeEnabled?: boolean | null
  referenceType?: ReferenceType | null
  referenceNotes?: string | null
}): ReferenceModeSummary {
  const precisionModeEnabled = Boolean(params.precisionModeEnabled)
  const referenceType = params.referenceType ?? 'none'
  const referenceNotes =
    typeof params.referenceNotes === 'string' && params.referenceNotes.trim()
      ? params.referenceNotes.trim()
      : null

  const referencePresent =
    precisionModeEnabled && referenceType !== 'none'

  const shouldBoostConfidenceLater =
    referencePresent &&
    ['ruler', 'credit_card', 'aruco_marker'].includes(referenceType)

  return {
    precisionModeEnabled,
    referenceType,
    referencePresent,
    referenceNotes,
    shouldBoostConfidenceLater,
  }
}
