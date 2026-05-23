import 'server-only'

/**
 * Build the per-image landmark detection prompt.
 *
 * Principle: the LLM identifies and locates; geometry computes inches; score
 * is derived downstream. The model is explicitly forbidden from estimating
 * inches or scores so its job stays bounded to spatial localization.
 *
 * @param imageWidth   pixel width of the source image (for coordinate context)
 * @param imageHeight  pixel height of the source image
 * @param angleType    declared viewing angle, lets the model anchor sourceAngle
 *                     instead of guessing
 * @param landmarkList comma-separated list of every requested landmark id
 */
export function buildLandmarkDetectionPrompt(args: {
  imageWidth: number
  imageHeight: number
  angleType: 'front' | 'left' | 'right' | 'unknown'
  landmarkList: string
}): string {
  const { imageWidth, imageHeight, angleType, landmarkList } = args

  const angleAnchor =
    angleType === 'unknown'
      ? `The viewing angle is unspecified. Infer it from the deer's head orientation and set sourceAngle accordingly.`
      : `This image is the ${angleType.toUpperCase()} view. Set sourceAngle = "${angleType}" on every landmark.`

  return [
    `ROLE`,
    `You are a whitetail-deer-antler measurement landmark detector. Your job is to`,
    `LOCATE and IDENTIFY landmarks. You do NOT estimate scores. You do NOT estimate`,
    `inches. You do NOT comment on rack quality. Downstream geometry computes`,
    `inches from your pixel coordinates; do not anticipate or infer that.`,
    ``,
    `INPUT CONTRACT`,
    imageWidth > 0 && imageHeight > 0
      ? `Image dimensions: ${imageWidth} x ${imageHeight} pixels. Coordinate origin (0, 0) is the top-left corner. X increases right, Y increases down.`
      : `Coordinate origin (0, 0) is the top-left corner. X increases right, Y increases down. Report the actual image's pixel dimensions in the imageWidth and imageHeight fields.`,
    `${angleAnchor}`,
    ``,
    `OUTPUT CONTRACT`,
    `Return one entry per landmark in the JSON array. Coordinates are PIXEL`,
    `coordinates as floating-point numbers with one decimal place — subpixel`,
    `precision matters for downstream measurements. Do NOT round to integers.`,
    ``,
    `Per-landmark fields:`,
    `  id          — exact landmark id from the list below`,
    `  px, py      — pixel coordinates (float, one decimal). null if not_visible.`,
    `  confidence  — 0.0 to 1.0. Be honest. Partial occlusion -> < 0.6.`,
    `  visibility  — one of: "clear" | "partially_visible" | "occluded" | "not_visible"`,
    `  sourceAngle — set per the angle anchor above`,
    ``,
    `Also include the image's actual dimensions as imageWidth and imageHeight.`,
    ``,
    `EYE-CIRCLE FIELDS (anatomical scale calibration)`,
    `Report two additional fields alongside the landmarks array:`,
    `  eyeCircleLeftRadiusPx, eyeCircleRightRadiusPx — pixel radius of each iris`,
    `  (colored ring around the pupil), positive float, one decimal. Return null`,
    `  when only the pupil is visible, the iris is occluded by the lid, or the`,
    `  eye is closed/turned away. Radii are independent of the eye_left/eye_right`,
    `  positions and do NOT replace them. Do NOT estimate pixels-per-inch.`,
    ``,
    `LANDMARK PLACEMENT RULES`,
    `- Eye centers: pupil center, not the outer eyelid corner.`,
    `- Pedicle centers: centroid of the circular base where the antler joins the`,
    `  skull. NOT the rim. NOT the burr.`,
    `- Burr: the bony ring just above the pedicle (where the polished antler`,
    `  begins). Distinct from pedicle.`,
    `- Beam tip: the literal distal end of the main beam, not anywhere along it.`,
    `- Tine base: where the tine first becomes distinguishable from the main beam,`,
    `  not where the tine "visually starts".`,
    `- Tine tip: the literal point at the tip of the tine.`,
    `- Ear base (skull-fixed): where the ear attaches to the skull, NOT the`,
    `  outermost edge of the ear flap.`,
    `- Spread anchors: the widest points of the inside spread, on the inside`,
    `  surfaces of the main beams.`,
    `- Circumference centers (h1..h4): the narrowest visible point of the beam`,
    `  between the relevant tines.`,
    ``,
    `MISSING/OCCLUDED`,
    `- If a tine does not exist on this rack: visibility = "not_visible",`,
    `  px = null, py = null, confidence = 0.95 (you are confident it is absent).`,
    `- If a landmark exists but is off-frame, blurred, or fully obscured by`,
    `  another body part: visibility = "not_visible" or "occluded", px = null,`,
    `  py = null. DO NOT GUESS positions for invisible landmarks.`,
    ``,
    `REFUSE`,
    `If this image does NOT show a whitetail deer with antlers, return an`,
    `empty landmarks array — do not invent points.`,
    ``,
    `SELF-CHECK`,
    `1. Are the two pedicle centers approximately symmetric about the visible`,
    `   skull midline? If they are not, you have probably misidentified one.`,
    `   Recheck before returning.`,
    `2. Is each burr near its corresponding pedicle (not on the opposite side)?`,
    `3. For every tine you marked visible, is the tip clearly above/forward of`,
    `   the corresponding base? If not, you may have swapped them.`,
    ``,
    `LANDMARKS TO LOCATE`,
    landmarkList,
  ].join('\n')
}
