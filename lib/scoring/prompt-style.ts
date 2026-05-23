import 'server-only'

export const PROMPT_STYLE_VERSION = 'surgical-precision-v1'

export const PROMPT_SECTIONS = {
  ROLE: 'ROLE',
  INPUT: 'INPUT CONTRACT',
  OUTPUT: 'OUTPUT CONTRACT',
  RULES: 'MEASUREMENT RULES',
  PLACEMENT: 'LANDMARK PLACEMENT RULES',
  MISSING: 'MISSING/OCCLUDED',
  PLAUSIBILITY: 'PLAUSIBILITY RULES',
  SCALING: 'SCALING DECISION TREE',
  REFUSE: 'REFUSE',
  SELF_CHECK: 'SELF-CHECK',
} as const

export type PromptRole = 'admission' | 'landmark' | 'measurement'

export function roleIsolationParagraph(role: PromptRole): string {
  switch (role) {
    case 'admission':
      return [
        `You are an antler-admission analyst. You decide whether the image is`,
        `usable for downstream B&C scoring. You do NOT score, measure, or rank.`,
      ].join('\n')
    case 'landmark':
      return [
        `You are a whitetail-deer-antler measurement landmark detector. Your job`,
        `is to LOCATE and IDENTIFY landmarks. You do NOT estimate scores. You do`,
        `NOT estimate inches. You do NOT comment on rack quality. Downstream`,
        `geometry computes inches from your pixel coordinates; do not anticipate`,
        `or infer that.`,
      ].join('\n')
    case 'measurement':
      return [
        `You are a whitetail B&C measurement estimator. Detection ran upstream`,
        `(admission gate). Landmark localization ran upstream (per-image`,
        `landmarks). Your single job: output inches and confidence. Do not`,
        `re-litigate detection. Do not relocate landmarks. Do not opine on`,
        `rack quality.`,
      ].join('\n')
  }
}
