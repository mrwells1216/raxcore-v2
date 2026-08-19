import { describe, it, expect } from 'vitest'
import { officialImageTypeToAngle } from '@/lib/training/official-measurements'

/**
 * The previous inline mapping in run-ai only recognised `includes('side')`,
 * so every other tag silently became 'front'. For a guide buck shot from many
 * positions that mislabelled most of the set, which would have made any
 * per-angle accuracy report meaningless.
 */
describe('officialImageTypeToAngle', () => {
  it('maps the plain front tag', () => {
    expect(officialImageTypeToAngle('front')).toBe('front')
  })

  it('maps both 90-degree side tags', () => {
    expect(officialImageTypeToAngle('side_left')).toBe('left')
    expect(officialImageTypeToAngle('side_right')).toBe('right')
  })

  it('maps the oblique front angles to their side', () => {
    expect(officialImageTypeToAngle('front_left_45')).toBe('left')
    expect(officialImageTypeToAngle('front_right_45')).toBe('right')
  })

  it('treats rear tags as back rather than as a side', () => {
    // 'rear_left_135' contains "left", so a naive includes() check would call
    // it a left profile. It is predominantly a rear aspect.
    expect(officialImageTypeToAngle('rear')).toBe('back')
    expect(officialImageTypeToAngle('rear_left_135')).toBe('back')
    expect(officialImageTypeToAngle('rear_right_135')).toBe('back')
  })

  it('does NOT claim context tags are front-on views', () => {
    // These describe the situation, not the camera angle. Calling them
    // 'front' is a lie the scorer would act on.
    for (const t of ['live', 'mounted', 'harvest', 'trail_cam', 'angled', 'elevated']) {
      expect(officialImageTypeToAngle(t)).toBe('other')
    }
  })

  it('is case-insensitive', () => {
    expect(officialImageTypeToAngle('SIDE_LEFT')).toBe('left')
    expect(officialImageTypeToAngle('Rear')).toBe('back')
  })

  it('degrades to other for missing or empty tags', () => {
    expect(officialImageTypeToAngle(null)).toBe('other')
    expect(officialImageTypeToAngle(undefined)).toBe('other')
    expect(officialImageTypeToAngle('')).toBe('other')
    expect(officialImageTypeToAngle('   ')).toBe('other')
  })

  it('maps every front camera position to a side or front', () => {
    expect(officialImageTypeToAngle('front_center')).toBe('front')
    expect(officialImageTypeToAngle('front_top_center')).toBe('front')
    expect(officialImageTypeToAngle('front_bottom_center')).toBe('front')
    expect(officialImageTypeToAngle('front_center_left')).toBe('left')
    expect(officialImageTypeToAngle('front_top_left')).toBe('left')
    expect(officialImageTypeToAngle('front_bottom_left')).toBe('left')
    expect(officialImageTypeToAngle('front_center_right')).toBe('right')
    expect(officialImageTypeToAngle('front_top_right')).toBe('right')
    expect(officialImageTypeToAngle('front_bottom_right')).toBe('right')
  })

  it('maps every back camera position to back, including the left/right ones', () => {
    // back_center_left contains "left" but is a rear aspect — the same trap
    // that rear_left_135 set.
    for (const t of [
      'back_center', 'back_center_left', 'back_center_right',
      'back_top_center', 'back_top_left', 'back_top_right',
      'back_bottom_center', 'back_bottom_left', 'back_bottom_right',
    ]) {
      expect(officialImageTypeToAngle(t)).toBe('back')
    }
  })

  it('treats an irregular-point close-up as carrying no angle', () => {
    expect(officialImageTypeToAngle('irregular_points')).toBe('other')
  })

  it('never returns a value outside the production AngleType union', () => {
    const allowed = new Set(['front', 'left', 'right', 'back', 'other'])
    for (const t of [
      'front', 'front_left_45', 'side_left', 'rear_left_135', 'rear',
      'rear_right_135', 'side_right', 'front_right_45', 'elevated',
      'angled', 'live', 'mounted', 'harvest', 'trail_cam', 'nonsense',
      'front_center', 'front_center_left', 'front_center_right',
      'front_top_center', 'front_top_left', 'front_top_right',
      'front_bottom_center', 'front_bottom_left', 'front_bottom_right',
      'back_center', 'back_center_left', 'back_center_right',
      'back_top_center', 'back_top_left', 'back_top_right',
      'back_bottom_center', 'back_bottom_left', 'back_bottom_right',
      'irregular_points',
    ]) {
      expect(allowed.has(officialImageTypeToAngle(t))).toBe(true)
    }
  })
})
