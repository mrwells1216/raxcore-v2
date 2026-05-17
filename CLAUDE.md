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

---

## 4. What is NOT built yet (the pending plan queue)

These are ordered by the MASTER_HANDOFF.md phases. Each has a dedicated plan file.

### 4.1. Antler crop box (CROP_BOX_PLAN.md) — HIGH PRIORITY
User draws a rectangle around the antlers after upload. Server crops with 12% padding using `sharp`. Cropped version goes to OpenAI; original preserved for display. Gives AI 4–8× more detail. Coordinates stored in prediction metadata.
- New: `components/scoring/antler-crop-box.tsx`, `lib/scoring/crop-image.ts`
- Modified: `scoring-wizard.tsx`, `app/api/score/route.ts`

### 4.2. ArUco marker full detection (ARUCO_MARKER_PLAN.md) — HIGH PRIORITY
The `aruco_marker` option already exists in `reference_type`. This wires real GPT-4o detection behind it. User prints a free marker at arucogen.com, places it near the rack. Corner detection → exact pixelsPerInch. Confidence 0.55–0.72.
- New: `lib/scoring/aruco-types.ts`, `lib/calibration/aruco-detector.ts`
- Modified: `scoring-form.tsx`, `score/route.ts`, `calibration-resolver.ts`

### 4.3. Eye circle calibration (EYE_CIRCLE_CALIBRATION_PLAN.md) — HIGH PRIORITY
Upgrade landmark prompt to return eye iris radius in pixels. Deer iris diameter is a known anatomical reference (~0.55" apparent radius front-facing). Zero extra API calls — piggybacks on existing landmark detection. Both eyes agreeing boosts confidence.
- Modified: `landmark-detection.ts`, `landmark-prompt.ts`, `landmark-geometry.ts`, `calibration-resolver.ts`
- No new files required.

### 4.4. AR calibration dots / pedicle drag (AR_CALIBRATION_DOTS_PLAN.md) — HIGH PRIORITY
Two draggable amber dots overlaid on the photo. User drags them to each antler burr base. Pixel distance ÷ known pedicle spacing (avg 4.5") = pixelsPerInch. Optional: user enters measured spacing for higher confidence (0.85 vs 0.68).
- New: `components/scoring/calibration-dots.tsx`
- Modified: `scoring-wizard.tsx`, `score/route.ts`, `calibration-resolver.ts`

### 4.5. Circumference taper assist (inline in MASTER_HANDOFF.md §9) — HIGH PRIORITY
Post-score card asking for one physical circumference measurement (H1 left). Derives H2–H4 and right-side H1 via published whitetail taper ratios. Single 60-second user action cuts circumference error by ~50%.
- New: `lib/scoring/circumference-taper.ts`, `/api/scoring/refine-circumference/route.ts`
- Modified: `scoring-results.tsx`

### 4.6. Sub-pixel edge refinement (SUBPIXEL_REFINEMENT_PLAN.md) — MEDIUM PRIORITY
When user places a measurement point in Advanced Scoring photo canvas, refine to the nearest high-contrast edge via Sobel gradient + Gaussian fitting. 10× improvement in point placement precision. Zero new packages.
- New: `lib/measure/subpixel-refine.ts`
- Modified: `photo-canvas.tsx`, `measure-store.ts` (additive)

### 4.7. Vanishing point perspective calibration (VANISHING_POINT_PLAN.md) — MEDIUM PRIORITY
Piggybacks on the landmark detection prompt to ask for background parallel lines (fence rails, truck beds, barn boards). Computes vanishing point + tilt angle. Cross-validates other calibration sources. If disagreement >35% warns user.
- New: `lib/scoring/vanishing-point-types.ts`, `lib/scoring/vanishing-point-geometry.ts`
- Modified: `landmark-prompt.ts`, `calibration-resolver.ts`, `ai-service.ts`

### 4.8. Admin gold standard — full build (AI_LEARNING_PLAN.md WI-3) — STRATEGIC PRIORITY
The moat. Expand `app/admin/training-import` from free-form JSON paste to full B&C/P&Y field-by-field form with per-image type tagging, AI vs official comparison table, and "promote to benchmark pack" workflow.
- Modified: `admin/training-import/page.tsx`, `api/admin/training-import/route.ts`
- New: `components/admin/official-vs-ai-table.tsx`, `api/admin/training-import/[id]/run-ai/route.ts`, `api/admin/training-import/[id]/promote/route.ts`

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
