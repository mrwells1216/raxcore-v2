import { describe, it, expect } from 'vitest'
import { buildVisionPrompt, type VisionScoringInput } from '@/lib/scoring/vision-scorer'
import { buildLandmarkDetectionPrompt } from '@/lib/scoring/landmark-prompt'
import { DETECTION_SYSTEM_PROMPT } from '@/lib/detection/detect-rack-with-openai'
import { PROMPT_STYLE_VERSION, PROMPT_SECTIONS } from '@/lib/scoring/prompt-style'

function makeMinimalVisionInput(): VisionScoringInput {
  return {
    images: [
      { imageUrl: 'https://example.test/img.jpg', angleType: 'front', width: 1024, height: 1024 },
    ],
    state: null,
    rackType: 'typical',
  }
}

describe('prompt-style', () => {
  it('exposes a frozen style version label for prompt-version pinning', () => {
    expect(PROMPT_STYLE_VERSION).toBe('surgical-precision-v1')
  })

  it('exposes the shared section labels used by all three prompts', () => {
    expect(PROMPT_SECTIONS.ROLE).toBe('ROLE')
    expect(PROMPT_SECTIONS.INPUT).toBe('INPUT CONTRACT')
    expect(PROMPT_SECTIONS.OUTPUT).toBe('OUTPUT CONTRACT')
    expect(PROMPT_SECTIONS.SELF_CHECK).toBe('SELF-CHECK')
    expect(PROMPT_SECTIONS.REFUSE).toBe('REFUSE')
  })
})

describe('buildVisionPrompt', () => {
  const prompt = buildVisionPrompt(makeMinimalVisionInput())

  it('opens with the measurement role-isolation paragraph', () => {
    expect(prompt.startsWith('You are a whitetail B&C measurement estimator.')).toBe(true)
  })

  it('contains every load-bearing section header', () => {
    for (const section of [
      'INPUT CONTRACT',
      'OUTPUT CONTRACT',
      'SCALING DECISION TREE',
      'MEASUREMENT RULES',
      'PLAUSIBILITY RULES',
      'SELF-CHECK',
      'REFUSE',
    ]) {
      expect(prompt).toContain(section)
    }
  })

  it('preserves the existing tine and circumference range hints', () => {
    expect(prompt).toContain('G1 3-6"')
    expect(prompt).toContain('G2 8-12"')
    expect(prompt).toContain('H1 4-5.5"')
    expect(prompt).toContain('Mature 22-28"')
  })

  it('drops the legacy expert-flattery preamble and decorative bars', () => {
    expect(prompt).not.toContain('decades of experience')
    expect(prompt).not.toContain('═══')
  })

  it('stays within the surgical-precision token budget', () => {
    expect(prompt.length).toBeGreaterThan(2000)
    expect(prompt.length).toBeLessThan(8000)
  })
})

describe('buildLandmarkDetectionPrompt', () => {
  const prompt = buildLandmarkDetectionPrompt({
    imageWidth: 1024,
    imageHeight: 1024,
    angleType: 'front',
    landmarkList: 'pedicle_left, pedicle_right, burr_left, burr_right',
  })

  it('opens with the landmark role-isolation paragraph', () => {
    expect(prompt.startsWith('ROLE')).toBe(true)
  })

  it('has the new harmonized headers', () => {
    expect(prompt).toContain('MISSING/OCCLUDED')
    expect(prompt).not.toContain('MISSING / OCCLUDED LANDMARKS')
    expect(prompt).toContain('REFUSE')
    expect(prompt).toContain('\nSELF-CHECK\n')
    expect(prompt).not.toContain('SELF-CHECK (perform before returning)')
  })

  it('stays compact', () => {
    expect(prompt.length).toBeGreaterThan(1500)
    expect(prompt.length).toBeLessThan(4000)
  })
})

describe('DETECTION_SYSTEM_PROMPT', () => {
  it('opens with ROLE', () => {
    expect(DETECTION_SYSTEM_PROMPT.trim().startsWith('ROLE')).toBe(true)
  })

  it('contains the load-bearing sections', () => {
    for (const section of [
      'INPUT CONTRACT',
      'OUTPUT CONTRACT',
      'REJECT CRITERIA',
      'CONFIDENCE GUIDANCE',
      'SELF-CHECK',
    ]) {
      expect(DETECTION_SYSTEM_PROMPT).toContain(section)
    }
  })

  it('drops the legacy "strict antler-detection analyst" opener', () => {
    expect(DETECTION_SYSTEM_PROMPT).not.toContain('strict antler-detection analyst')
  })

  it('stays compact', () => {
    expect(DETECTION_SYSTEM_PROMPT.length).toBeGreaterThan(900)
    expect(DETECTION_SYSTEM_PROMPT.length).toBeLessThan(2400)
  })
})
