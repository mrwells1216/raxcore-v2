# CLAUDE.md — RAX CORE v2

> This file is read first by Claude Code in plan mode. Treat it as authoritative.
> If anything here conflicts with the handoff document, the handoff document wins
> on intent; this file wins on what actually exists in the code today.
> Always commit directly to `main`. Never create feature branches.

---

## 1. Mission

Build the most accurate deer antler scoring app on the market.

- Accuracy first, gimmicks never.
- Measurement truth over visual flash.
- Confidence honesty over fake certainty.
- Correction workflow over black-box AI.
- Graph-native structure over loose JSON.
- Inferred is labeled inferred. Estimated is labeled estimated. Missing is labeled missing. Unverified is labeled unverified.

If a feature looks impressive but does not improve measurement truth, do not ship it. Label it, or remove it.

---

## 2. Stack

- **Framework**: Next.js 16 (App Router), React 19.2, TypeScript 5.7, Tailwind 4
- **Auth + DB + Storage**: Supabase (`@supabase/ssr`, `@supabase/supabase-js`)
- **AI**: OpenAI vision via `@ai-sdk/openai` + `ai` v6, plus a custom `detectRackWithOpenAI` admission layer. Anthropic + Gemini keys are env-ready for future ensemble scoring but not yet wired.
- **2D measurement**: Konva 10 + react-konva 19
- **3D**: `three@^0.177`, `@react-three/fiber@9.5`, `@react-three/drei@10.7`
  - React 19 compatible. The earlier `ReactSharedInternals.ReactCurrentOwner` crash from R3F v8 is resolved. **Do not downgrade these.**
- **State**: Zustand v5 (`components/measure/measure-store.ts`)
- **Jobs**: QStash (Upstash) — replaces Vercel cron. Routes: `/api/jobs/scheduler` (every minute), `/api/jobs/worker` (every 5 min). `vercel.json` crons block is REMOVED.
- **Maps**: Leaflet (imperative, dynamically imported — NOT react-leaflet). Full satellite + hillshade + elevation layers. `react-simple-maps` is installed but unused.
- **PDF**: jspdf, html2canvas
- **Billing**: Stripe
- **Reconstruction**: Luma AI (server-side only via `lib/reconstruction/luma-adapter.ts`); manual upload fallback always available
- **Image processing**: `sharp` (installed) — Trophy Room watermarks, HEIC depth extraction

`next.config.mjs`, `tsconfig.json`, and `proxy.ts` are intentionally permissive. Do not touch without a clear reason.

---

## 3. What is shipped (do not rebuild)

### 3.1. Truthful guided manual capture ✓ (PR #14)
- `lib/capture/scan-session.ts` — `analyseFrame` does optical-quality only. `hasDeer` / `hasRack` are hard-coded `false`. `shouldAutoCaptureFrame` is kept for backcompat but never called.
- `components/scanning/scan-mode-panel.tsx` — no auto-capture, no stableCount, no fake percent. RAF loop only updates optical validation. Capture fires only on `handleManualCapture`.
- `lib/scoring/resolve-image-roles.ts` — resolves angle fields to `'front' | 'left' | 'right' | 'unknown'` with claim-once backfill. Used twice in `scoring-wizard.tsx` so `selected_image_angles` is never `[null, null, null]`.

**Do not** reintroduce auto-capture, fake percentage, or live rack detection.

### 3.2. Detection-gated quick scoring ✓ (PR #14)
`POST /api/score` flow:
1. Rate-limit + billing
2. Upload images → Supabase
3. `detectRackWithOpenAI` — 422 with `errorType: 'detection_rejected'` if fails
4. `scoreBuck` (AI vision)
5. `persistInitialMeasurementGraph`
6. `scoreFromGraphNative` → `buildScoreComparison` → `activeSource: 'graph_native' | 'legacy'`
7. Confidence engine over all signals

### 3.3. Advanced scoring + Verified Score ✓ (PR #11)
`lib/advanced-scoring/cross-validation.ts` — strict Verified Score rules:
- ≥2 independent methods per B&C field; one must be `photo_polyline`, one `three_d_point_cloud`
- ≤3% pairwise disagreement
- Both calibrations must be `physical_reference`
- No source confidence < 0.5; no unresolved warnings
- `quick_ai` alone never verifies; `three_d_mesh_fallback` alone never verifies

`lib/advanced-scoring/confidence.ts` — method ranking: point cloud (0.92) > photo (0.78) > manual (0.65) > mesh fallback (0.50) > quick AI (0.45).
`lib/advanced-scoring/point-cloud.ts` — spatial-cell index for snapping up to 250k points.

### 3.4. Reconstruction (Luma + manual) ✓
`lib/reconstruction/luma-adapter.ts` is `server-only`. Missing env → `LumaConfigurationError` → manual fallback job. Never invents asset URLs.

### 3.5. Verified PDF export ✓
`lib/export/score-pdf-builder.ts` — title flips verified/unverified, per-field evidence table, disclaimer: *"RAX CORE measurements are AI-assisted and user-verified. Official acceptance depends on governing organization rules."* This is the only disclaimer text. Do not change it.

### 3.6. Ring + hat reference in Precision Mode ✓ (PR #17, #19)
`reference_type` in the scoring form now includes `'wedding_ring'` and `'hat'`. Sub-forms appear when selected. Confidence is always `'estimated'`. Never unlocks Verified Score alone.

### 3.7. AI Learning Flywheel WI-1 through WI-6 ✓ (PR #18)
- Supervision hooks wired: `onReversePassComplete`, `onStructuralSolverComplete`, `onIntervalMiss`, `onHighConfidenceMiss`
- `correction_events` table + `lib/training/correction-events.ts` — unified correction capture from all 4 sources (score editor, dpad, precision pass, review sheet)
- Prompt bias correction (`lib/scoring/prompt-bias-correction.ts`) — fires after 30+ corrections per field
- Admin accuracy dashboard at `/admin/accuracy`
- Roboflow seed dataset infrastructure (`/admin/seed-dataset`)
- QStash migration: `lib/jobs/qstash-verify.ts`, scheduler + worker routes updated, `vercel.json` crons removed

### 3.8. Hat reference + Trophy Room ✓ (PR #19, #20)
- `trophy_room_entries` table with watermark generation, approval workflow, soft delete
- `lib/trophy-room/` — eligibility, watermark, service
- Eligibility: Verified Score OR `confidence_tier` in `{'high', 'very_high'}`
- Watermark: server-side `sharp`, stored in `trophy-watermarks` bucket
- Scoring results shows eligibility CTA; gallery at `/trophy-room`

### 3.9. LiDAR depth auto-calibration + landmark pixel detection ✓ (PR #21)
- `lib/calibration/depth-extractor.ts` — HEIC auxiliary depth map extraction
- `lib/calibration/depth-calibration.ts` — pixelsPerInch from depth + EXIF focal length
- `lib/scoring/landmark-detection.ts` — `AntlerLandmarkId` types, zone colors, `LandmarkDetection` shape
- `lib/scoring/landmark-prompt.ts` — prompt builder for pixel coordinate detection
- `lib/scoring/landmark-geometry.ts` — pixel distance → inch measurements, curvature correction
- `lib/scoring/calibration-resolver.ts` — depth > reference object > anatomical priors
- Landmark overlay on scoring results (Trace-style colored bounding boxes)
- Drag-to-correct feeds `correction_events`

### 3.10. QStash + scoring form UX ✓ (PR #22)
- Main Frame Points replaced with chip grid (not dropdown)
- Ring/hat in Precision Mode section (not a separate section)
- `vercel.json` crons removed; QStash fires routes externally

### 3.11. Elevation map ✓ (PR #23)
`components/map/map-viewer.tsx` — full Leaflet map:
- Satellite, Satellite+Labels, Topo, Terrain, Elevation Heat base layers
- Hillshade + Slope Shadow overlays (ESRI — free, no key)
- Live USGS 3DEP elevation on click
- Deer terrain intelligence zones (Bottom/Creek → High Country)
- All free, no API keys. Leaflet dynamically imported. `react-leaflet` NOT installed.
- Props + exports unchanged: `{ pins, onPinClick, onMapClick, selectedPinId }`, `LOCATION_TYPE_COLORS`, `LOCATION_TYPE_LABELS`

### 3.12. Render-time Zustand safety ✓
`useMeasureStore.getState()` only in event handlers and effect cleanups. Never at render time.

### 3.13. Crop box pinch-to-resize + bidirectional edge sliders ✓
`components/scoring/antler-crop-box.tsx` — removed expand-only arrow pad; added two-finger pinch-to-resize and four per-edge range sliders (Top/Bottom/Left/Right) that each control that edge bidirectionally. activePointersRef tracks pointer IDs for pinch detection. RAF-throttled onChange preserved.

### 3.14. Point count dual sliders ✓
Replaced 8-14pt chip grid with two `PointCountSlider` components (total 4-30; main frame 6-16, shown only when total >= 6; auto-corrects if main frame > total). New `total_points` field threads through ScoringFormData, wizard FormData, ScoringInput, VisionScoringInput, and the vision prompt. Files: new `components/scoring/point-count-slider.tsx`; modified `scoring-form.tsx`, `lib/types.ts`, `scoring-wizard.tsx`, `app/api/score/route.ts`, `lib/scoring/ai-service.ts`, `lib/scoring/vision-scorer.ts`.

### 3.16. Precision mode always visible + form reorganize ✓
Merged the toggle-gated Precision Mode card (8 reference types: none/ruler/card/coin/aruco/other/ring/hat) with the old limited ring/hat-only Reference Object section into one always-visible "Reference Object" section. Removed the `precision_mode_enabled` toggle from the UI; `scoring-wizard.tsx` now sends reference fields whenever `reference_type !== 'none'` (passes `precision_mode_enabled: 'true'` to the API so the existing API contract is unchanged). Removed the Ears Visible toggle (landmark detection handles it automatically). Made Optional Details (method/year/notes) a collapsible section moved after Irregular Points. New section order: Rack Info → Image Context → Reference Object → Known Measurements → Irregular Points → Optional Details. Files: `components/scoring/scoring-form.tsx`, `components/scoring/scoring-wizard.tsx`.

### 3.15. Pre-AI manual measurements panel ✓
Optional collapsible "Known Measurements" section in the scoring form lets users enter tape-measured B&C fields (main beams, G1–G4, H1–H4, inside spread) before submission. Non-null values are serialized to JSON in the wizard, parsed in route.ts, passed to `scoreBuck` → `VisionScoringInput`, and injected into the vision prompt as "USER-PROVIDED MEASUREMENTS (treat as ground truth) — DO NOT contradict them." Values are also stored in a new `user_measurements_metadata` JSONB column on `predictions`. Plausibility warnings shown inline; amber highlight on entered fields. Files: new `components/scoring/pre-scoring-measurements.tsx`, new `supabase/migrations/20260518_user_measurements_metadata.sql`; modified `lib/types.ts`, `lib/scoring/vision-scorer.ts`, `lib/scoring/ai-service.ts`, `app/api/score/route.ts`, `lib/storage/service.ts`, `components/scoring/scoring-form.tsx`, `components/scoring/scoring-wizard.tsx`.

### 3.17. Landmark dot position fix + trophy room overhaul + learning pipeline gaps ✓
- **Landmark dot fix**: `LandmarkOverlay` now computes object-contain letterbox/pillarbox offsets so colored dots and connector lines land on the actual antler pixels regardless of container aspect ratio. `scoring-results.tsx` uses `ResizeObserver` to pass actual rendered container dimensions instead of original image pixel dimensions. Also fixes drag-to-correct coordinate math (subtract offset before dividing by scale). Files: `components/scoring/landmark-overlay.tsx`, `components/scoring/scoring-results.tsx`.
- **Trophy room visual overhaul**: `TrophyDetailClient` fully redesigned with: (a) score thermometer chart (0–220" SVG gradient bar, tier markers at 115/130/150/170", animated buck marker); (b) schematic antler SVG diagram with tine lengths labeled by B&C zone color; (c) full B&C score sheet breakdown table (left/right per field, asymmetry ≠ indicators, gross/net totals); (d) learning contribution note. `TrophyCard` improved with mini score position bar, confidence color dot, verified shield badge, and hover glow. `lib/trophy-room/service.ts` adds `getTrophyEntryWithMeasurements()` joining predictions table. `lib/trophy-room/types.ts` adds `TrophyMeasurements` and `TrophyRoomEntryWithMeasurements`. Detail page uses new service function. Files: `components/trophy-room/trophy-detail-client.tsx`, `components/trophy-room/trophy-card.tsx`, `lib/trophy-room/service.ts`, `lib/trophy-room/types.ts`, `app/trophy-room/[id]/page.tsx`.
- **Learning pipeline**: `dpad-adjust/route.ts` now computes and records `confidence_tier_before` in correction_events. Bias corrections pre-loaded in `scoreBuck` and injected into the vision prompt (new `fieldBiases` field on `VisionScoringInput`) so AI pre-compensates for known systematic biases before generating numbers — closes the correction→prompt feedback loop. Admin accuracy dashboard shows bias correction report via `getBiasReport()`. Files: `app/api/scoring/dpad-adjust/route.ts`, `lib/scoring/vision-scorer.ts`, `lib/scoring/ai-service.ts`, `app/admin/accuracy/page.tsx`.

### 3.29. Admin gold standard — confirmed shipped ✓ (§4.8)
Final entry in the §4 close-out campaign. CLAUDE.md §4.8 was marked as
PARTIAL ("basic JSON paste, full UI missing") but audit on 2026-05-23 found
the entire workstream was already shipped: full B&C/P&Y field-by-field form
with per-image type tagging (`components/admin/training-import-form.tsx`,
455 lines), POST `/api/admin/training-import` to ingest sheets, GET
`/admin/training-import/[id]` with the AI-vs-official comparison table
(`components/admin/official-vs-ai-table.tsx`), POST
`/api/admin/training-import/[id]/run-ai` (calls `scoreBuck` and stores
deltas in `ai_run_result`), POST `/api/admin/training-import/[id]/promote`
(sets `is_benchmark`, creates/adds-to a benchmark pack via
`lib/training-packs/service.ts`). The pending sheet list and gold standard
list are both rendered on the main admin page. Tables in use:
`official_score_sheets` (with `is_benchmark`, `ai_run_result`,
`promoted_at`, `promoted_by` columns), `official_score_images`, and the
benchmark_pack infra under `training-packs/`. This entry exists only to
reconcile CLAUDE.md with reality — no new code was added for §4.8. The
remaining campaign closeout (this commit) updates §4 to mark the queue
empty.

### 3.28. Vanishing-point cross-check ✓ (§4.7)
Sixth entry in the §4 close-out campaign. NOT a primary calibration source —
standalone confidence would only be 0.30–0.55 and the algorithm's
absolute-degree estimates are biased without a known camera focal length.
Per CLAUDE.md §4.7, its job is to **disagree loudly** with the primary
calibration when perspective tilt is severe. New
`lib/scoring/vanishing-point-types.ts` defines `ParallelLinePair`,
`VanishingPointResult`, `PerspectiveDisagreement`, and the warn/crit
thresholds (35% / 50% of a 30° reference scale). New
`lib/scoring/vanishing-point-geometry.ts` is pure math: `lineIntersection`,
`analyzeVanishingPoint` (multi-pair fusion via median), `comparePerspectiveTilt`
(diff against an inferred primary tilt). New `vanishing_point`
`CalibrationSourceTag` value added to the resolver's union — reserved for
future use when a known-length object is supplied along one of the line
pairs. For now the public surface is `computeVanishingPointWarnings()`,
called by `app/api/score/route.ts` after the primary `resolveCalibration`
returns; appends any disagreement messages to `calibration.warnings` (never
overrides the primary). Landmark prompt extended with an optional
`parallelLinePairs` schema field (≤2 pairs) for fence rails / truck bed /
barn boards; model is explicitly told to omit when no clear pair is
visible, never invent. Prompt length budget bumped 4000 → 4500 chars to
accommodate the new section (still well under the original verbose
baseline). Per-image landmark result now carries the optional
`parallelLinePairs` field; vision-scorer maps the Zod schema into
`PerImageLandmarkResult.parallelLinePairs`. Verified Score gates unchanged
— vanishing-point is explicitly NOT `physical_reference`. Tests: 16 new
specs in `__tests__/scoring/vanishing-point.test.ts` cover line
intersection (parallel/non-finite/diagonal), VP analysis (empty/parallel/
centered/edge/multi-pair fusion), and perspective-tilt comparison
(no-pairs/agree/warn/critical/non-finite). Files: new
`lib/scoring/vanishing-point-types.ts`, new
`lib/scoring/vanishing-point-geometry.ts`, new
`__tests__/scoring/vanishing-point.test.ts`; modified
`lib/scoring/landmark-prompt.ts`, `lib/scoring/landmark-detection.ts`,
`lib/scoring/vision-scorer.ts`, `lib/scoring/calibration-resolver.ts`,
`app/api/score/route.ts`, `__tests__/scoring/prompt-snapshots.test.ts`.

### 3.27. Sub-pixel point refinement wiring ✓ (§4.6)
Fifth entry in the §4 close-out campaign. The math has been in
`lib/scoring/subpixel-refine.ts` (Sobel + Gaussian-2D / parabolic-fallback
peak fit) and `lib/advanced-scoring/subpixel-refine.ts` (line-aware
projection) with passing tests since §3 was built out; the Advanced Scoring
photo canvas just wasn't calling it for individual measurement-point
placement. Now wired: new POST route
`app/api/measure/refine-point/route.ts` decodes the in-browser photo data
URL via sharp, calls `refineSinglePoint`, and returns `{x, y, method,
refinementConfidence, deltaPx}`. New helper `refineMeasurementPoint()` in
`components/measure/photo-canvas.tsx` fires after each `addPoint2D` and uses
the existing `movePoint2D` store action to snap the placed point to the
gradient peak when (a) the user didn't already snap to an existing vertex,
(b) `refinementConfidence ≥ 0.4`, (c) `method !== 'unchanged'`, and (d) the
user hasn't already nudged that point manually (delta > 1px from raw =
skip). The existing `refineCalibrationLine` flow (server endpoint
`/api/measure/refine-reference`, store action
`applyRefinedCalibrationPoints`) is untouched — this is additive for
non-calibration points. Provenance: refined points end up in the same
`measurements2D[fieldId].points` array as raw points, no separate flag is
needed because the snap is sub-pixel; the existing `confidence` and
`calibrationSource` on the field already encode trust correctly. NEVER
unlocks Verified Score — Verified still requires the full
`physical_reference` calibration path. Tests: 5 new specs in
`__tests__/scoring/refine-point-flow.test.ts` cover flat-neighborhood
unchanged, edge-of-image unchanged, NaN/Infinity input coercion to 0,
synthetic strong-edge stays finite, and confidence band invariants. Files:
new `app/api/measure/refine-point/route.ts`, new
`__tests__/scoring/refine-point-flow.test.ts`; modified
`components/measure/photo-canvas.tsx`.

### 3.26. Circumference taper assist ✓ (§4.5)
Fourth entry in the §4 close-out campaign. NOT a new calibration source — a
post-score refinement that takes one tape-measured H1 (60 seconds with a soft
tape) and derives H2/H3/H4 plus the opposite-side ladder via published
whitetail taper ratios. Roughly halves circumference error, which today is the
least-accurate B&C field class. New `lib/scoring/circumference-taper.ts`
defines the constants (`TAPER_RATIOS.H2 = 0.94`, `H3 = 0.88`, `H4 = 0.84`),
exposes `deriveCircumferences(measuredInches, side)` and a helper
`applyTaperToMeasurements()` that splices the derived ladder into an existing
Measurements record. Sanity band 1.0–8.0" enforced by both client and server
(`CircumferenceTaperError`). New POST route
`app/api/scoring/refine-circumference/route.ts` validates the body via Zod,
loads the prediction, applies the taper, recomputes gross/net via the H-field
delta only (other fields untouched), and persists. Persistence reuses the
existing `user_measurements_metadata` JSONB column on `predictions` (added in
§3.15) under a new `circumferenceTaper` subkey — no migration. New
`components/scoring/circumference-taper-card.tsx` is the UI: collapsible
under the Measurement Breakdown card, side selector, H1 input, live preview
of the derived ladder, submit POSTs and reloads on success. Derived values
are tagged `source: 'derived_taper'` per CLAUDE.md §5 (never call them
"measured"); this NEVER unlocks Verified Score — only `physical_reference`
via Advanced Scoring does. Tests: 9 new specs in
`__tests__/scoring/circumference-taper.test.ts` cover taper math, opposite-
side mirroring, provenance tagging, out-of-band rejection (low and high),
NaN/Infinity guards, monotonically decreasing ladder, rounding, and the
applyTaperToMeasurements field surgery. Files: new
`lib/scoring/circumference-taper.ts`, new
`app/api/scoring/refine-circumference/route.ts`, new
`components/scoring/circumference-taper-card.tsx`, new
`__tests__/scoring/circumference-taper.test.ts`; modified
`components/scoring/scoring-results.tsx`.

### 3.25. ArUco marker calibration ✓ (§4.2)
Third entry in the §4 close-out campaign. Wires real GPT-4o detection behind
the already-existing `reference_type: 'aruco_marker'` form value. User prints
a free marker at arucogen.com, enters the side length (default 2"), and the
detector returns four pixel corners. Per-image PPI is computed as
`avgSidePx / knownSideInches`; multi-image fusion uses the same median ± 25%
outlier rejection pattern as pedicle dots and eye-circle. New
`aruco_marker` `CalibrationSourceTag` at slot 3 of §8 (between LiDAR and
pedicle dots), confidence lerps 0.55 → 0.72 based on the worst cosTilt across
surviving detections (cos θ ≤ 0.5 floors at 0.55, orthogonal markers hit
0.72). knownSideInches clamped server-side to 0.5–12.0" sanity band. Verified
Score gates unchanged — ArUco is explicitly NOT `physical_reference`.
Detector implementation: `lib/calibration/aruco-detector.ts` calls GPT-4o
with a surgical-precision prompt (`ARUCO_DETECTION_SYSTEM_PROMPT`) that
demands four corners in strict clockwise order, validates convexity via
cross-product signs, and rejects degenerate quadrilaterals before returning.
Detector runs in parallel with per-image landmark detection in
`app/api/score/route.ts` (one extra `Promise.all` task), and ONLY fires when
the user explicitly selected `reference_type === 'aruco_marker'` and supplied
a valid side length — keeps cost flat for the 99% of submissions that don't
use markers. Persistence reuses the existing `landmarks_detected` JSONB on
`buck_images` (no migration); resolver chosen ArUco source is recorded in
`pedicle_calibration_metadata` already-introduced field for traceability
when both are present. Tests: 12 new specs in
`__tests__/scoring/aruco-detector.test.ts` cover invalid knownSideInches,
empty detections, PPI math, confidence ceiling/floor, midpoint lerp,
worst-cosTilt selection, outlier rejection, sanity-band clamp, zero/NaN
guards, and prompt-style snapshot assertions. Files: new
`lib/scoring/aruco-types.ts`, new `lib/calibration/aruco-detector.ts`, new
`__tests__/scoring/aruco-detector.test.ts`; modified
`lib/scoring/calibration-resolver.ts`, `app/api/score/route.ts`.

### 3.24. AR pedicle calibration dots ✓ (§4.4)
Second entry in the §4 close-out campaign; sequenced second by peak confidence
(0.85 with user-supplied measurement — highest non-LiDAR/tape value in the §8
hierarchy). User drags two amber dots onto each antler's burr base, optionally
enters their measured pedicle spacing, and the resolver fuses across images
with the standard median + ±25% outlier rejection. Two new
`CalibrationSourceTag` values: `user_placed_known` (0.85, slot 4) when every
surviving observation came with a known measurement, and
`user_placed_anatomical` (0.68, slot 5) when any observation used the 3.8"
whitetail population average. Mixing demotes to anatomical — never claims a
known reading it can't substantiate. Pedicle dots are placed in priority 2 of
the resolver (just below LiDAR, above reference object and eye-circle). User
input is clamped server-side to a 2.0–8.0" sanity band; out-of-band inputs
fall back to the anatomical default and warn. Verified Score gates unchanged
— user_placed_* is explicitly NOT `physical_reference`. New
`components/scoring/calibration-dots.tsx` is a vanilla-React drag overlay (no
Konva dependency) with `ResizeObserver`-driven letterbox/pillarbox math
borrowed from the §3.17 LandmarkOverlay fix so dots land on actual image
pixels regardless of container aspect ratio. Wizard exposes an opt-in
collapsible "Pedicle Calibration" card under the crop section that renders the
overlay per uploaded image. Coordinates serialized as `pedicle_calibration` on
the API FormData; parsed and threaded through to `resolveCalibration`'s new
optional `pedicleCalibrations` arg. New JSONB column
`pedicle_calibration_metadata` on `predictions` stores the raw inputs alongside
the resolver's chosen source/confidence/PPI for learning-flywheel correlation.
Tests: 10 new specs in `__tests__/scoring/pedicle-calibration.test.ts` cover
empty/null inputs, sub-5px sanity floor, known vs anatomical confidence
selection, out-of-band knownInches clamp, mixed-source demotion, ±25%
outlier rejection across images, >12% disagreement warning, and NaN/Infinity
input guards. Files: new `components/scoring/calibration-dots.tsx`, new
`__tests__/scoring/pedicle-calibration.test.ts`, new migration
`supabase/migrations/20260524_pedicle_calibration_metadata.sql`; modified
`lib/scoring/calibration-resolver.ts`, `app/api/score/route.ts`,
`components/scoring/scoring-wizard.tsx`, `lib/storage/service.ts`.

### 3.23. Eye-circle anatomical calibration ✓ (§4.3)
First entry in the §4 close-out campaign; sequenced first by calibration impact
because it is zero-user-effort and shares the existing per-image landmark
GPT-4o call (no new API spend). Adds a new `eye_circle_anatomical` source to
the calibration resolver at §8 slot 6–7 (0.50–0.72), sitting above the legacy
`anatomical_prior` path because iris diameter varies <10% between adult bucks
versus ~20% for skull-spacing priors. The per-image landmark call now also
asks the model to report `eyeCircleLeftRadiusPx` / `eyeCircleRightRadiusPx`
alongside the existing landmark array; both are optional in the Zod schema so
older responses still parse. New `eyeCircleToPixelsPerInch()` helper in
`landmark-geometry.ts` fuses observations across images with the same median +
±25% relative-deviation outlier rejection pattern as the legacy anatomical
path; both-eyes-agree on a front view tops out at 0.72, single-eye side-view
caps at 0.50. New `CalibrationSourceTag` union exported from
`calibration-resolver.ts` (`'depth_map_lidar' | 'reference_object' |
'eye_circle_anatomical' | 'anatomical_prior'`) replaces the inline union on
`CalibrationResult.source`. `resolveCalibration` now takes an optional
`perImageLandmarks` arg; absent ⇒ eye-circle slot is skipped and behavior is
identical to before. Verified Score gates unchanged — eye-circle is explicitly
NOT `physical_reference`. Cost stays flat (~$0.05/run) because radii ride
along on the existing detection request. New `IRIS_RADIUS = 0.55` constant in
`lib/constants.ts` (whitetail adult iris radius head-on, derived from
1.05–1.15" diameter literature). Persistence reuses the existing
`landmarks_detected` JSONB on `buck_images` — no migration. Tests: 9 new
specs in `__tests__/scoring/eye-circle.test.ts` cover null/empty inputs,
failed-image skips, single-eye front, both-eyes-agree gold case, side-view
cap, outlier rejection, tight-agreement boost, zero/negative radii guards,
and degenerate-fallback path. Prompt-snapshot ceiling held at <4000 chars
after compacting the eye-circle prompt section. Files: modified
`lib/constants.ts`, `lib/scoring/landmark-detection.ts`,
`lib/scoring/landmark-prompt.ts`, `lib/scoring/landmark-geometry.ts`,
`lib/scoring/vision-scorer.ts`, `lib/scoring/calibration-resolver.ts`,
`app/api/score/route.ts`; new `__tests__/scoring/eye-circle.test.ts`.

### 3.22. UI polish + fresh-eyes fine-tune pass ✓
Surgical UI-only cleanup across the recently-shipped surfaces (no scoring/calibration logic touched, no API contracts changed). (a) **Debug noise**: removed 8 leftover `console.log` calls from `scoring-results.tsx` (`extractPrecisionPassPayload`, `extractFieldProvenance`, the two precision-pass override effects) that were leaking to the production console; deleted the stale "Debug logging removed" comment. (b) **Landmark overlay layering**: the absolute canvas previously had no z-index/pointer-events isolation, so it swallowed clicks meant for the carousel arrows and Landmarks toggle. Wrapper is now `pointerEvents:none` + `zIndex:5`, only the canvas itself is `pointerEvents:auto` (drag-to-correct preserved), tooltip dropped to z-2, and the zone legend moved from bottom-right to top-left positioned via the existing letterbox `offsetX/offsetY` so it never overlaps the carousel dots row or the top-right toggle. (c) **Carousel** (`antler-image-carousel.tsx`): desktop prev/next arrows bumped to `z-10` (above the overlay canvas); pagination dots now sit inside a 24×24 tap target (`grid place-items-center w-6 h-6`) with the visible dot kept small, and `aria-current` added. (d) **Per-image consensus card**: fixed a broken `w-full` div nested in a flex row (the excluded-reason note now wraps onto its own line correctly), added `aria-expanded` to both collapsible triggers, added dark-mode variants to the agreement-tier badges / ear-pose warning / excluded-reason text (were light-only `bg-*-50` on a dark UI), tightened the ear-pose copy ("perked ear detected … Ear-tip distance excluded from consensus"), and renamed the `ReferenceRow` prop `ref`→`data` (avoids the React-reserved-word footgun). (e) **Trophy card**: confidence was encoded by color alone (a bare dot with a hover `title`) — added a visible tier label ("Very High"/"High"/"Medium"/"Low") and marked the dot `aria-hidden`. (f) **Trophy detail**: the `≠` asymmetry chip in the score-sheet now has a `title`/`aria-label` explaining it ("Left and right differ by X\""). (g) **Map** (`map-viewer.tsx`): pending-pin pulse rewritten from SMIL `<animate>` to a CSS `transform: scale` keyframe gated behind `@media (prefers-reduced-motion: reduce)`; the redundant "Confirm or cancel" hint is hidden while the confirmation panel is open; the panel now spans full width above the legend on mobile (`left-3 right-3`) and anchors bottom-right only at `sm:`+. Validation: `tsc --noEmit` clean, `pnpm lint` 0 errors (69 pre-existing warnings unchanged), `vitest` 51/51 pass, `pnpm build` succeeds. Files: `components/scoring/scoring-results.tsx`, `components/scoring/landmark-overlay.tsx`, `components/scoring/antler-image-carousel.tsx`, `components/scoring/per-image-consensus-card.tsx`, `components/trophy-room/trophy-card.tsx`, `components/trophy-room/trophy-detail-client.tsx`, `components/map/map-viewer.tsx`.

### 3.21. SVG North American map + ESLint flat config ✓
Replaced the Leaflet elevation map with a self-contained SVG North American map. `components/map/map-viewer.tsx` is now built on `react-simple-maps` (was already a dep, not previously wired) using `geoMercator` centered on `[-95, 48]` with scale 520. Country outlines come from `world-atlas@2/countries-110m.json` filtered by ISO numeric codes to US/Canada/Mexico + Central America + Caribbean — no state borders, no tile servers, no elevation layers. Clicks on the SVG are inverted through the captured d3 projection (`projectionRef`) to produce `[lng, lat]`, surfaced via a confirmation panel before firing `onMapClick`. Pin markers render as colored drops keyed by `LOCATION_TYPE_COLORS`; **at ≥20 placed pins the visualization switches to heat mode** — markers shrink to 2.5px dots and a separate `<g filter="url(#rax-heat-blur)">` layer renders blurred radial-gradient blobs (`stdDeviation=6`, red radial gradient) at each pin to give a harvest-density readout. Mode badge ("Pin View N / 20" → "Heat Map N") sits top-left; legend bar across the bottom is unchanged. Public API preserved: `{ pins, onPinClick, onMapClick, selectedPinId }`, `LOCATION_TYPE_COLORS`, `LOCATION_TYPE_LABELS`. Also fixed `pnpm lint` (the script existed but no ESLint config did) — added `eslint@^9` + `eslint-config-next@16.2.0` as devDeps and authored `eslint.config.mjs` (flat config) that disables `react/no-unescaped-entities`, downgrades `@next/next/no-img-element` and `react-hooks/exhaustive-deps` to warnings, and downgrades the new React Compiler-class rules from `react-hooks` v7 (`purity`, `immutability`, `refs`, `use-memo`, `static-components`, `preserve-manual-memoization`, `component-hook-factories`, `set-state-in-effect`, `error-boundaries`) to warnings so the legacy codebase doesn't fail lint on rules it predates. Lint now reports 0 errors / 79 warnings (down from 118 errors). One real hook-rule bug fixed in `components/measure/scene-3d.tsx` (`MeasurementTube` was calling `useMemo` after a conditional `return null` — moved the early-return after the hooks and folded the empty-points guard inside the `useMemo`). Updated `react-simple-maps.d.ts` shim so `<Geographies>` render-prop type now includes `projection`, `path`, `outline`, `borders` (matches runtime). Files: modified `components/map/map-viewer.tsx`, `react-simple-maps.d.ts`, `components/measure/scene-3d.tsx`, `package.json`, `pnpm-lock.yaml`; new `eslint.config.mjs`.

### 3.20. Surgical Precision prompt rewrite + post-output plausibility validator ✓
Rewrote `buildVisionPrompt` (`lib/scoring/vision-scorer.ts`) and the rack-admission system prompt (`lib/detection/detect-rack-with-openai.ts`) to match the surgical structure of `lib/scoring/landmark-prompt.ts` — explicit ROLE / INPUT CONTRACT / OUTPUT CONTRACT / SCALING DECISION TREE / MEASUREMENT RULES / PLAUSIBILITY RULES / SELF-CHECK / REFUSE sections, imperative voice, no hedging prose, all existing tine/circumference/spread range hints preserved. Main scoring prompt token footprint drops from ~3,800 to ~2,200. Detection acceptance gate held at 0.45 — the new CONFIDENCE GUIDANCE band tightens self-calibration without trading false negatives for false positives. Three micro-edits to the landmark prompt for header consistency (`MISSING/OCCLUDED`, dedicated `REFUSE` section, plain `SELF-CHECK` header). New `lib/scoring/prompt-style.ts` exports `PROMPT_STYLE_VERSION = 'surgical-precision-v1'`, shared `PROMPT_SECTIONS` labels, and `roleIsolationParagraph(role)` so all three prompts share identical headers and role-isolation paragraphs. New `lib/scoring/scoring-plausibility.ts` runs 9 deterministic checks on the parsed `VisionOutput` (beam exceeds tines, paired-field asymmetry warn/crit at 35%/50%, spread present when G2 exists, deductions non-negative, net ≤ gross, gross within 40–280, confidence in 10–95, G2 ≥ G1, H taper distally) with `critical | warning` severity and per-field confidence-delta suggestions. Wired in `ai-service.ts` immediately after `visionResult.output` is parsed; critical violations OR into `selfCheckResult.triggerSecondPass` so the existing two-pass solver re-scores automatically — no changes to `self-check.ts`'s rule set, no changes to `lib/advanced-scoring/confidence.ts` per §7. Detection prompt extracted to `DETECTION_SYSTEM_PROMPT` constant for testability. New tests: `__tests__/scoring/scoring-plausibility.test.ts` (18 cases — one per rule plus aggregation), `__tests__/scoring/prompt-snapshots.test.ts` (14 cases — header presence, range-hint preservation, token-length floors/ceilings). vitest config now shims `server-only` to a noop so server-tagged modules import cleanly in node tests. Files: new `lib/scoring/prompt-style.ts`, new `lib/scoring/scoring-plausibility.ts`, new `__tests__/shims/server-only.ts`, new `__tests__/scoring/scoring-plausibility.test.ts`, new `__tests__/scoring/prompt-snapshots.test.ts`; modified `lib/scoring/vision-scorer.ts`, `lib/detection/detect-rack-with-openai.ts`, `lib/scoring/landmark-prompt.ts`, `lib/scoring/ai-service.ts`, `vitest.config.ts`.

### 3.19. Accuracy audit fix pack ✓
Four-part fix derived from the IMG_6534/IMG_6535 screenshots. (a) **Error-band invariant**: intersecting consensus and legacy error bands with `max(low)/min(high)` could produce a CI window that excluded `predicted_gross` (e.g. range 161–172 with gross 159.3). `ai-service.ts` now widens the intersected band when it excludes the point estimate, logs the disagreement, and surfaces it in the confidence explanations; `scoring-results.tsx` has a defense-in-depth clamp for pre-existing prediction rows; "Precision: -" is now "Precision: not run" so the missing pass is legible. (b) **Anatomical-prior calibration disagreement (141% spread)**: the `skull_width` spec in `per-image-consensus.ts` used the SAME `[pedicle_left, pedicle_right]` endpoint pair as `pedicle_spacing` but divided by a different inch constant — guaranteeing a ~37% mathematical disagreement; removed until a real orbital-ridge landmark pair exists. `EAR_BASE_SPACING` was 7.5" (too large vs published whitetail anatomy ~5.5"), corrected. `calibration-resolver.ts` kept its own local `ANATOMICAL_REFERENCES` table that drifted out of sync with `lib/constants.ts` (local `EYE_BOX_WIDTH=3.5` mislabeled as interocular vs canonical `EYE_TO_EYE=4.3`); now imports the canonical source. Resolver multi-estimate aggregation upgraded from "use highest confidence on >20% disagreement" to **median-based outlier rejection** (tolerates ±25% from median) with an agreement boost when survivors are tight. Each `REFERENCE_SPECS` entry now carries a `viewSensitivity: 'low' | 'medium' | 'high'` tier so future callers can pick the right priors for primary calibration vs cross-check duty (nose_bridge and ear_base_to_tip flagged 'high' — front-projected, need orthogonal views). (c) **Foreshortening correction**: `landmark-geometry.ts` now applies a `cos(θ)` recovery factor per measurement based on principal 3D axis (horizontal / parasagittal / vertical) vs viewing angle, clamped to 2.94× to avoid amplifying noise. Confidence drops as `cos²(θ)` so the correction is honest about its 3D-pose assumption. Only fires when both endpoints share a `sourceAngle`. (d) **Landmark prompt rewrite**: `buildLandmarkDetectionPrompt` (was unused) is now wired into `detectLandmarksForOneImage`, enforces float pixel coordinates with one decimal place (no integer rounding), explicit "you do not estimate scores or inches" role, per-landmark placement rules (pedicle vs burr, tine-base vs visual-start, skull-fixed ear bases), and a 4-step self-check before returning (pedicle symmetry, burr proximity, base/tip ordering, not-a-target guard). Files: modified `lib/scoring/ai-service.ts`, `lib/scoring/per-image-consensus.ts`, `lib/scoring/calibration-resolver.ts`, `lib/scoring/landmark-geometry.ts`, `lib/scoring/landmark-prompt.ts`, `lib/scoring/vision-scorer.ts`, `lib/constants.ts`, `components/scoring/scoring-results.tsx`.

### 3.18. Per-image anatomical reference capture + angle-distortion compensation ✓
Each anatomical reference (nose bridge, eye box, pedicle spacing, eye-to-pedicle, skull width, ear-base spacing, ear-base-to-tip) is now captured **per image** instead of once across the whole submission. The GPT-4o landmark detector runs once per image in parallel via new `detectLandmarkPositionsPerImage`; each call only sees one image so the model cannot mix up which image a coordinate came from. Per-image observations are fused with **median + MAD outlier rejection** (estimates >2.5× MAD from median are dropped with `excludedReason`) and per-reference agreement spread is computed across surviving images. Side-angle photos automatically take a +0.18 distortion bump for references that are only reliable head-on (eye box, pedicle spacing, skull width, nose bridge, ear-base spacing). Ear handling: new `ear_base_*` and `ear_tip_*` landmark IDs let `detectEarPosition()` flag perked/sideways ear poses and exclude `ear_base_to_tip` from the consensus for those images — ear-base spacing (skull-fixed) stays as a reference. Per-image landmarks are persisted into the existing `BuckImage.landmarks_detected` field (was null until now); aggregated `per_image_consensus` blob is cached on `predictions` via a new JSONB column for fast UI reads. The carousel now drives a `currentImageIndex` so `LandmarkOverlay` renders only that image's dots, and a new collapsible "Per-image anatomical references" card surfaces per-reference per-image breakdown with outlier badges and ear-pose warnings. Learning win: correction events now carry `source_image_index` + `sourceAngle` for free, so future bias-correction analytics can learn angle-specific biases ("AI overestimates eye box on left profiles"). Cost: ~$0.05/run vs $0.03 today (N parallel calls, modest prompt overhead duplication). Verified Score gates unchanged. Files: new `lib/scoring/ear-position.ts`, `lib/scoring/per-image-consensus.ts`, `components/scoring/per-image-consensus-card.tsx`, `supabase/migrations/20260520_per_image_consensus.sql`; modified `lib/scoring/landmark-detection.ts` (added ear landmark IDs + `PerImageLandmarkResult` type), `lib/scoring/vision-scorer.ts` (added `detectLandmarkPositionsPerImage`, legacy `detectLandmarkPositions` now a back-compat wrapper), `lib/types.ts` (added `PerImageReferenceObservation`, `PerReferenceFusion`, `PerImageConsensusResult`, `Prediction.per_image_consensus`), `lib/storage/service.ts` (added `updateBuckImageLandmarks`, `updatePredictionPerImageConsensus`, threaded `perImageConsensus` through `CreatePredictionParams`), `app/api/score/route.ts` (calls per-image detector, persists per-image data, exposes `perImageConsensus` and `landmarkDetections.perImage` in response), `components/scoring/scoring-results.tsx` (carousel index threading, per-image landmark overlay slicing), `components/scoring/antler-image-carousel.tsx` (new `onImageChange` callback).

### 3.30. Classroom (RAXam / RAXrs) + global calibration + precision-pass fix ✓
New public `/classroom` tab — a lab for testing and calibrating the scorer —
plus two fixes derived from the IMG_6534/IMG_6535 session (scores ~5-8" low,
precision pass spinning forever).
- **Global + learnable calibration**: `applyCalibration` (`lib/calibration.ts`)
  now supports a multiplicative scale and a seeded default offset
  (`DEFAULT_GLOBAL_GROSS_BIAS = 6`, in new client-safe `lib/calibration-constants.ts`).
  When no learned profile exists it applies the seeded offset so the live
  `/score` tab re-centers up; learned profiles (from ground-truth +
  classroom-rescore deltas via `buildProfileFromRows`) and per-request overrides
  supersede it. `calibrationMeta.source` is `'default' | 'profile' | 'override'`
  — the default is labeled estimated. New `calibration_profiles.gross_multiplier`
  / `net_multiplier` columns (default 1).
- **Per-request feature gating**: optional `experiment_config` FormData field on
  `/api/score` (absent ⇒ identical production behavior). `lib/scoring/experiment-config.ts`
  defines the feature keys (detection gate, landmarks, eye-circle, pedicle, ArUco,
  vanishing-point, per-image consensus, prompt-bias, plausibility, second pass,
  calibration, shadow precision pass), parses/sanitizes the blob, and maps it to
  calibration overrides + AI-service flags. Gates wired into `app/api/score/route.ts`
  and `lib/scoring/ai-service.ts` (bias, plausibility, second pass) + a custom-prompt
  append in `buildVisionPrompt` (`lib/scoring/vision-scorer.ts`).
- **RAXam (exam lab)**: compact reuse of `ScoringWizard` (`classroom` +
  `experimentConfig` props; `ScoringForm` gains `hideOptionalDetails`) with a
  Features &amp; Variables panel. **RAXrs (rescore)**: pick a recent buck
  (`GET /api/classroom/recent`), flag error categories (expected higher/lower,
  left/right antler → tine sub-options), re-run via `/api/score`, and record the
  flags as `correction_events` (`correction_source: 'classroom_rescore'`) via
  `POST /api/classroom/rescore`; compact results show new-vs-old.
- Classroom runs persist as normal predictions but flagged
  `predictions.is_classroom_run` (+ `experiment_config`, `features_used` JSONB) and
  show an asterisk in History.
- **Precision pass fix**: `app/api/reverse/predictions/[predictionId]/precision-pass/route.ts`
  now runs `executePrecisionPass` inline in all environments (was dev/preview only)
  with `maxDuration = 300`; `precision-pass-card.tsx` gained a ~90s poll cap so it
  can never spin forever.
- **Landmark clarity**: `landmark-overlay.tsx` legend now states landmarks are
  scale/QA reference points, not the score.
Verified Score gates unchanged (calibration/experiment overrides never unlock it).
Files: new `lib/calibration-constants.ts`, `lib/scoring/experiment-config.ts`,
`app/classroom/page.tsx`, `components/classroom/{features-panel,raxam-flow,raxrs-flow,classroom-results}.tsx`,
`app/api/classroom/{recent,rescore}/route.ts`, `supabase/migrations/20260524_classroom_predictions.sql`,
`__tests__/scoring/classroom-experiment.test.ts`; modified `lib/calibration.ts`,
`app/api/score/route.ts`, `lib/scoring/ai-service.ts`, `lib/scoring/vision-scorer.ts`,
`lib/storage/service.ts`, `lib/types.ts`, `lib/training/correction-events.ts`,
`components/scoring/{scoring-wizard,scoring-form,landmark-overlay,precision-pass-card}.tsx`,
`components/header.tsx`, `app/history/page.tsx`.

---

## 4. What is NOT built yet

The §4 close-out campaign (2026-05-23) shipped the entire backlog. All
items previously listed here have either landed (§3.23–§3.28 in this
document) or were already complete in the codebase (§3.29). The queue is
empty.

If new initiatives are scoped in the future, add them under this section
with the same numbered structure (4.1, 4.2, …). For now, the next
strategic frontier sits inside the existing flywheel (§3.7) rather than as
a new feature workstream.

---

## 5. Critical coding rules

### Truth and provenance
- Inferred = tagged inferred. Estimated = tagged estimated. Heuristic ≠ AI.
- `source: 'heuristic'` is correct for procedural landmark estimates. Never call them AI.
- Verified Score only from `computeVerifiedScoreStatus() → { verified: true }`. No other path.
- "Official certification" / "B&C accepted" / "P&Y accepted" must never appear in copy.
- Derived circumferences (from taper ratios) must be tagged `source: 'derived_taper'`, not `'measured'`.

### Safety
- Guard every numeric path with `isFiniteNumber` (`lib/advanced-scoring/geometry.ts`). No NaN or Infinity.
- API keys server-side only. No `NEXT_PUBLIC_*` for secrets.
- External failures (Supabase, QStash, USGS, Roboflow) → warn log + empty fallback. Never 500.

### Architecture
- `lib/advanced-scoring/*` types are additive. Do not break `MeasurementGraph` in `lib/types.ts`.
- Backward-compat on `/api/score` — clients read `prediction.*`. Add fields; never rename.
- Route handlers stay thin. Math lives in `lib/`.
- Three.js: dispose geometry/materials/textures in useEffect cleanup.
- Never `useMeasureStore.getState()` at render time. Only in event handlers and effects.
- Leaflet: always dynamically imported. Never `import L from 'leaflet'` at top level.
- QStash: all job routes must call `verifyQStashRequest()` before doing any work.

### Refactor discipline
- Surgical patches. Touch only files named in the plan. No formatting changes to unrelated files.
- Never start a new v0 project. Edit this repo in place.
- Always commit to `main`. Never create feature branches.
- After every work item: `pnpm exec tsc --noEmit && pnpm build`.

### CLAUDE.md maintenance
- After every work item, update Section 3 ("What is shipped") to reflect what was built. Add a new subsection numbered sequentially (3.13, 3.14, …) with: feature name, one-line summary, list of files changed, and any calibration-hierarchy or accuracy notes. Section 3 is the source of truth for what actually exists in the repo and must stay current with every commit to `main`.

### Files that must not be casually changed
- `lib/capture/scan-session.ts`
- `lib/scoring/resolve-image-roles.ts`
- `lib/advanced-scoring/cross-validation.ts`
- `lib/advanced-scoring/confidence.ts`
- `lib/reconstruction/luma-adapter.ts`
- `lib/export/score-pdf-builder.ts` (especially the disclaimer text)
- `next.config.mjs`, `tsconfig.json`, `proxy.ts`

---

## 6. Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | All Supabase | client-safe |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All Supabase | client-safe |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | **server-only** |
| `OPENAI_API_KEY` | Scoring, detection, landmarks | **server-only** |
| `QSTASH_TOKEN` | Job scheduling | **server-only**; absent ⇒ manual trigger only |
| `QSTASH_CURRENT_SIGNING_KEY` | QStash verification | **server-only** |
| `QSTASH_NEXT_SIGNING_KEY` | QStash verification | **server-only** |
| `CRON_SECRET` | Local dev job trigger | **server-only** |
| `LUMA_API_KEY` | Reconstruction | **server-only**; absent ⇒ manual fallback |
| `LUMA_RECON_SUBMIT_URL` | Reconstruction | absent ⇒ manual fallback |
| `LUMA_RECON_STATUS_URL` | Reconstruction | absent ⇒ manual fallback |
| `STRIPE_SECRET_KEY` | Billing | **server-only** |
| `STRIPE_WEBHOOK_SECRET` | Billing webhook | **server-only** |
| `ANTHROPIC_API_KEY` | Future ensemble scoring | **server-only**; not yet wired |
| `GEMINI_API_KEY` | Future ensemble scoring | **server-only**; not yet wired |

Optional keys must not block startup if missing — graceful degradation only.

---

## 7. Validation after every change

```
Routes load:  / /score /measure /map /results/[any] /library /history /settings
              /admin/training-import /admin/supervision /admin/accuracy /trophy-room

Camera:       No auto-capture. N/3 counter only on button press.

Quick score:  Non-deer → 422 detection_rejected
              Good image → 200 with scoreComparison + effectiveGraph + confidence_explanation
              selected_image_angles never [null, null, null]

Calibration:  LiDAR detected → calibration-resolver returns depth_map_lidar
              No LiDAR → falls back to next available source (not crash)
              Ring/hat selected → confidence is 'estimated', not 'physical_reference'

Landmarks:    Overlay renders on scoring result with zone colors
              Drag-to-correct → correction_events row created

Trophy Room:  LOW confidence → eligibility returns eligible: false
              HIGH/VERY_HIGH or Verified → eligible: true
              Approve → watermark generated within 15s
              Delete → soft delete (deleted_at set, not removed)

Verified:     Only true when ALL gates pass in cross-validation.ts
              Ring/hat/LiDAR/ArUco/pedicle alone never unlock it.

PDF:          Generates without throwing. Disclaimer present. Verified/Unverified correct.

Jobs:         /api/jobs/scheduler returns 401 without valid QStash sig or CRON_SECRET
              /api/jobs/worker same

Build:        pnpm exec tsc --noEmit clean
              pnpm build succeeds
```

---

## 8. The calibration hierarchy (always reference this)

| Priority | Source | `calibrationSource` value | Confidence | Notes |
|---|---|---|---|---|
| 1 | User ruler/tape (Advanced Scoring) | `physical_reference` | 0.95 | Only thing that unlocks Verified Score |
| 2 | LiDAR depth map + EXIF | `depth_map_lidar` | 0.85–0.90 | Auto — iPhone Pro Portrait Mode |
| 3 | ArUco marker (GPT-4o detected) | `aruco_marker` | 0.55–0.72 | Print free marker, any phone |
| 4 | Pedicle dots, known spacing | `user_placed_known` | 0.85 | User measured skull plate |
| 5 | Pedicle dots, avg spacing | `user_placed_anatomical` | 0.68 | User placed dots, avg 4.5" |
| 6 | Eye circle (both eyes agree) | `eye_circle_anatomical` | 0.72 | Auto from landmark detection |
| 7 | Eye circle (single eye) | `eye_circle_anatomical` | 0.50–0.65 | Partial face visible |
| 8 | Anatomical priors (eye box) | `anatomical_prior` | 0.50–0.65 | AI-estimated, no user input |
| 9 | Ring reference | `estimated_reference_object` | 0.45 | User selected in Precision Mode |
| 10 | Hat brim reference | `estimated_reference_object` | 0.40 | User selected in Precision Mode |
| 11 | Vanishing point | `vanishing_point` | 0.30–0.55 | Background parallel lines |
| — | None | `none` | 0.25 | Pure AI guess |

**Verified Score requires `physical_reference`.** Nothing else unlocks it alone.

---

## 9. North star

Every change must answer **yes** to:
1. Does this make a measurement more accurate or more honest about its accuracy?
2. Does this respect the provenance chain (`source`, `origin`, `calibrationSource`)?
3. Does this preserve graceful fallback when external services are absent?
4. Does this avoid claiming official certification?
5. Does this avoid auto-capture, fake detection, or fake percentages?
6. Does this let each system do what it's best at? (AI identifies; math measures; human corrects)
7. Does this make the training flywheel turn?

If any answer is no, the change is wrong even if the diff looks clean.
