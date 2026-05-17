import 'server-only'

export function buildLandmarkDetectionPrompt(
  imageWidth: number,
  imageHeight: number,
): string {
  return `You are an expert whitetail deer antler anatomist.

TASK: Locate the following antler landmarks in this image. Return the PIXEL COORDINATES (x, y) where each landmark appears. The image is ${imageWidth}×${imageHeight} pixels. Pixel (0,0) is the top-left corner.

LANDMARKS TO FIND:

SKULL REFERENCES (for scale calibration):
  - eye_left, eye_right: center of the visible iris (the dark circular area, not the whole socket)
      Also return: radiusPx (iris radius in pixels), radiusMajorPx (longer radius if elliptical
      side profile, otherwise equal to radiusPx), isElliptical (true for side-profile views).
      Measure the iris only — NOT the eyelid or sclera. If the eye is occluded, blurred, or
      not clearly visible, set radiusPx: null. Prefer null over a guessed radius.
  - pedicle_left, pedicle_right: center of each antler base (where antler meets skull)
  - nose_tip: tip of the nose
  - nose_bridge_top: top of the nose bridge between the eyes

BEAM ENDPOINTS:
  - burr_left, burr_right: base of each main beam at the burr
  - beam_tip_left, beam_tip_right: distal tip of each main beam

SPREAD:
  - spread_anchor_left, spread_anchor_right: widest points of the inside spread

TINES (base where tine meets beam, tip at the end — per side):
  - g1_base_left, g1_tip_left through g5_base_left, g5_tip_left
  - g1_base_right, g1_tip_right through g5_base_right, g5_tip_right
  Note: G1 = brow tine (closest to burr), G2 = next up, etc.
  If a tine does not exist, mark it not_visible with null coordinates.

CIRCUMFERENCE POSITIONS (center of the beam cross-section measurement):
  - h1_center_left/right: smallest circumference between burr and G1
  - h2_center_left/right: smallest circumference between G1 and G2
  - h3_center_left/right: smallest circumference between G2 and G3
  - h4_center_left/right: smallest circumference between G3 and beam tip (or G4)

RULES:
- Return pixel coordinates as integers.
- If a landmark is NOT visible in this image (occluded, out of frame, or does not exist), return px: null, py: null.
- Confidence: 0.0 to 1.0. Be honest — partially occluded = lower confidence, clearly visible = higher.
- visibility must be one of: 'clear', 'partially_visible', 'occluded', 'not_visible'
- For tines that do not exist on this rack, use visibility: 'not_visible', confidence: 0.95 (you are confident it's absent).
- DO NOT hallucinate positions. If you are uncertain, say so with low confidence.
- Circumference center points are approximations — place them at the narrowest visible point of the beam between the relevant tines.

Return as a JSON array of objects with shape:
{ "id": string, "px": number|null, "py": number|null, "confidence": number, "visibility": string }

Return the JSON array only, no other text.`
}
