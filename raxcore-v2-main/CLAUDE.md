# CLAUDE.md — RAX CORE v2

> This file is read first by Claude Code in plan mode. Treat it as authoritative.
> If anything here conflicts with the handoff document, the handoff document wins
> on intent; this file wins on what actually exists in the code today.

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
- **AI**: OpenAI vision via `@ai-sdk/openai` + `ai` v6, plus a custom `detectRackWithOpenAI` admission layer
- **2D measurement**: Konva 10 + react-konva 19
- **3D**: `three@^0.177`, `@react-three/fiber@9.5`, `@react-three/drei@10.7`
  - These are React 19 compatible. The earlier `ReactSharedInternals.ReactCurrentOwner` crash from R3F v8 is resolved. **Do not downgrade these.**
- **State**: Zustand v5 (`components/measure/measure-store.ts`)
- **Maps**: Leaflet + react-simple-maps
- **PDF**: jspdf, html2canvas
- **Billing**: Stripe
- **Reconstruction**: Luma AI (server-side only via `lib/reconstruction/luma-adapter.ts`); manual upload fallback always available

`next.config.mjs` and `tsconfig.json` are intentionally permissive. `proxy.ts` is a thin proxy. Do not touch any of those without a clear reason.

---

## 3. Top-level layout

```
app/
  page.tsx                         landing
  score/page.tsx                   quick scoring (camera | upload)
  measure/page.tsx                 advanced scoring entry
  precision-marker/                advanced calibration / marker workflow
  results/[id]/                    score result detail
  history/, library/, share/, settings/
  map/                             property + pin map
  admin/                           gold-standard / training / monitoring (huge)
  auth/, render/

  api/
    score/                         main quick-scoring endpoint (POST)
    detect/                        AI rack admission
    scoring/dpad-adjust/           manual nudge
    reconstruction/submit, status  Luma + manual fallback
    map/...                        map CRUD
    calibration/...                calibration profiles
    review/...                     score-sheet review
    reverse/...                    precision-pass / reverse-engineering
    structural/...                 structural-hypothesis pipeline
    training/, training-import     official score sheet import (admin moat)
    admin/...                      ~50+ admin routes
    jobs/...                       worker scheduler
    webhooks/stripe                billing

components/
  scanning/scan-mode-panel.tsx     truthful guided manual capture
  scoring/                         scoring-wizard, scoring-form, scoring-results, etc.
  measure/                         photo-canvas, scene-3d, measure-store, score-panel, ...
  map/                             leaflet map components
  admin/                           admin dashboards
  ui/                              shadcn/ui

lib/
  capture/                         scan-session, subject-validation
  scoring/                         50+ files — the heart of quick scoring
    score-from-graph.ts            graph-native scorer
    score-comparison.ts            graph_native vs legacy decision
    measurement-graph-persistence
    resolve-image-roles.ts         <— the angle-role resolver from the handoff
    landmarks.ts                   heuristic landmark estimator (Phase 42 enhanced)
    next-photo-guidance.ts         WIRED IN lib only, NOT in UI yet
    ai-service.ts                  OpenAI vision orchestration
    real-confidence-engine.ts, calibrated-confidence.ts, segment-confidence-interval.ts
    cross-view-conflict.ts, geometry-consistency.ts, landmark-consistency.ts
    intake-quality.ts, capture-quality.ts, image-diagnostics.ts
  advanced-scoring/
    geometry.ts, calibration.ts, confidence.ts
    cross-validation.ts            <— Verified Score rules
    point-cloud.ts                 spatial index, snapping, density
    types.ts
  confidence/engine.ts             quick-scoring confidence engine
  detection/
    detect-rack-with-openai.ts     OpenAI admission control
    build-antler-graph.ts          builds detection graph from analyses
    detection-to-scan-feedback.ts  available, NOT wired to UI yet
    subject-validation.ts          available, NOT wired to UI yet
  measure/graph-builder.ts         Zustand state → canonical MeasurementGraph
  reconstruction/
    luma-adapter.ts                server-only, errors gracefully
    types.ts
  export/
    score-pdf-builder.ts           jsPDF Verified PDF
    build-verified-pdf-data.ts     pure data shaping
    score-pdf-types.ts
  storage/, supabase/, billing/, usage/, notifications/, monitoring/
  training/, training-packs/, benchmark/, validation/
  supervision/                     Phase 52 supervision events (already shipped)
  reverse-engineering/, structural-hypothesis/, multiview/, calibration/
  rules-engine/, sandbox/, jobs/, retraining/, influence/
  mapping/, render/, review/, release/, health/, auxiliary-labels/
  collections/, notifications/, stripe/

scripts/                           build / migration scripts
proxy.ts                           thin proxy file
```

---

## 4. What is already done (do not rebuild this)

### 4.1. Truthful guided manual capture ✓
The surgical scan fix from the handoff is applied:
- `lib/capture/scan-session.ts`:
  - `analyseFrame` does **optical-quality only** (brightness, contrast, edge energy, over/underexposure). `hasDeer` and `hasRack` are hard-coded `false` and the docstring explicitly forbids fake detection.
  - `shouldAutoCaptureFrame` is preserved as a kept-for-backcompat export and is **not called** by the live camera.
  - `buildGuidanceState` returns truthful copy: "Manually capture the full front rack" etc.
  - Coverage is `N/3 views captured`, not a fake percent.
- `components/scanning/scan-mode-panel.tsx`:
  - Live RAF loop only updates `validation` from `analyseFrame` — no auto-capture, no `stableCount`, no timer.
  - Capture only fires on `handleManualCapture` (a button press).
  - Camera unmount/AbortError is handled silently.
  - Front/left/right slot UI; "Switch to Upload" fallback always available.
- `lib/scoring/resolve-image-roles.ts`:
  - Resolves `angle_type | angleType | angle | side` → `'front' | 'left' | 'right' | 'unknown'`, with second-pass backfill, claim-once.
  - Used by `components/scoring/scoring-wizard.tsx` (twice — submit + display) so `selected_image_angles` is never `[null, null, null]`.

**Do not** reintroduce auto-capture, fake percentage, or "live rack detection". Deer/rack admission happens **after upload** in `/api/score` via `detectRackWithOpenAI`.

### 4.2. Detection-gated quick scoring ✓
`POST /api/score`:
1. Validates env (`hasRequiredServerEnv`).
2. Rate-limits + billing checks (`checkUserLimit`, `checkGuestLimit`).
3. Uploads images via `uploadBuckImage` → Supabase storage.
4. Calls `detectRackWithOpenAI(storedImageUrls)` → `buildMultiImageDetectionSummary`. If `!accepted`, marks buck `failed` and returns **422** with `errorType: 'detection_rejected'`. The wizard surfaces `userMessage`.
5. Calls `scoreBuck` (the legacy AI vision scorer in `lib/scoring/ai-service.ts`).
6. Calls `persistInitialMeasurementGraph` to write the detection graph.
7. Calls `loadEffectiveMeasurementGraph` → `scoreFromGraphNative` to produce a graph-native score.
8. Calls `buildScoreComparison` to decide `activeSource: 'graph_native' | 'legacy'`.
9. Active-source rules (in `lib/scoring/score-comparison.ts`):
   - `graph_native` requires graph source ∈ {persisted_graph, prediction_graph}, completeness ≥ 0.75, finite positive `graphGross`, and **not** (gross delta > 18" while confidence < 45%).
   - Otherwise → `legacy`, with a `reason` string.
10. Confidence engine runs over all signals, including `graphEvidence`.
11. Response shape is documented in `ScoringResult` in `lib/types.ts` and includes `scoreComparison`, `effectiveGraph`, `effectiveGraphSource`, `effectiveGraphVersion`, `confidenceEvidence`.

### 4.3. Advanced scoring + Verified Score ✓
`lib/advanced-scoring/cross-validation.ts` implements the strict Verified Score rules from the handoff:
- Each required B&C field must have **≥2 independent measurement methods**.
- One must be `photo_polyline`, one must be `three_d_point_cloud`.
- Max pairwise disagreement ≤ 3%.
- Calibration 2D and 3D must both be `source: 'physical_reference'`.
- No source can have confidence < 0.5.
- No session warnings can be unresolved.
- `quick_ai` alone never verifies. `three_d_mesh_fallback` alone never verifies.

`lib/advanced-scoring/confidence.ts` ranks methods correctly: point cloud (0.92) > photo (0.78) > manual (0.65) > **mesh circumference (0.70)** > mesh fallback (0.50) > quick AI (0.45). Mesh fallback gets an extra 0.80× penalty if not snapped, sparse density (<50 points) costs 0.25×, calibration estimated costs 0.18×, warnings compound. `three_d_mesh_circumference` is accepted as a second source (alongside `photo_polyline`) for H1–H4 circumference fields when its computed confidence ≥ 0.6.

`lib/advanced-scoring/point-cloud.ts` has a spatial-cell index (`createPointCloudIndex`, `findNearestPointCloudAnchorIndexed`, `estimatePointDensityAroundIndexed`) so snapping works on 10k–250k points without scanning linearly. Rendering can downsample to 120k points; snapping must use the full index.

### 4.4. Reconstruction (Luma + manual) ✓
- `lib/reconstruction/luma-adapter.ts` is `server-only`. `LUMA_API_KEY`, `LUMA_RECON_SUBMIT_URL`, `LUMA_RECON_STATUS_URL` are all env-required. If any is missing, throws `LumaConfigurationError`.
- `POST /api/reconstruction/submit`:
  - Requires ≥1 image; ≥8 unless `allowLowPhotoCount: true`; recommends 12+.
  - If Luma is unconfigured or submit throws → returns a job with `provider: 'manual'`, `status: 'requires_manual_upload'`, message explaining the fallback. **Never invents asset URLs.**
- Asset types normalized to one of: `mesh_glb | point_cloud_xyz | point_cloud_ply | point_cloud_csv | gaussian_splat | preview_image | unknown`.
- Manual upload fallback is **always** acceptable.

### 4.5. Verified PDF export ✓
- `lib/export/score-pdf-builder.ts` + `build-verified-pdf-data.ts` + `score-pdf-types.ts`.
- Title flips: "Verified Score - internally cross-validated" vs "Unverified Advanced Score".
- Per-field table shows photo / pointcloud / mesh fallback / manual / quick-AI values side by side with confidence and tier.
- Verification reasons list every blocker when unverified.
- Reconstruction summary shows `hasMesh / hasPointCloud / hasSplat` truthfully.
- Disclaimer: "RAX CORE measurements are AI-assisted and user-verified. Official acceptance depends on governing organization rules." This is **the only** disclaimer text — do not change it.
- Note line: "Mesh fallback measurements are explicitly lower-confidence and inferred. Gaussian splats are visual evidence only in this build."

### 4.6. Map ✓
`GET /api/map/properties` returns `{ properties: [] }` with a warn log on storage errors instead of 500. The pattern is to copy: try → on catch warn → return empty. Already done in this file; do the same for `pins`, `bucks` if missing.

### 4.7. Phase 52 supervision events ✓
`PHASE_52_PATCH_2_IMPLEMENTATION.md` documents what shipped. Three hooks exist:
- Benchmark regression → `evaluateGuardrails()` auto-emits `benchmark_failure_cluster` / `segment_regression_detected`.
- `onIntervalMiss` — call from the validation-result recording pipeline.
- `onHighConfidenceMiss` — call from prediction completion handlers.
- `updatePatternFromAccumulatedEvents` — call from pattern discovery jobs.

These hooks are **defined but not yet called by application code**. That's intentional and the wiring is a separate task.

### 4.9. Zone overlay + provenance badges ✓
- `lib/scoring/measurement-zones.ts`: `buildMeasurementZones(measurements2D, measurements3D) → MeasurementZone[]`. Provenance: `quick_ai` → `'ai'`, `photo_polyline | three_d_point_cloud | manual_entry` → `'human'`, else `'heuristic'`. Badge text: `'AI' | 'Heuristic' | 'Human'`.
- `components/measure/photo-canvas.tsx`: hover-pulse layer (150ms setInterval, opacity 0.45↔0.85) for `hoveredZoneId`; `showZones` renders all zones at 0.4 opacity.
- `components/measure/scene-3d.tsx`: `AntlerModel` clones hovered zone with pulsing `emissiveIntensity` via `useFrame`. `hoveredZoneId` propagated from store → `<AntlerModel hoveredZoneId={...} />`.
- `components/measure/score-panel.tsx`: rows fire `setHoveredZoneId` on mouse enter/leave; hovered row gets `outline: '1px solid ' + row.color`.
- `lib/export/score-pdf-types.ts`: `source?: 'ai' | 'heuristic' | 'human'` and `meshCircumferenceValue?: number` added to `VerifiedPdfMeasurementRow`.
- `lib/export/build-verified-pdf-data.ts`: populates `source` from method; populates `meshCircumferenceValue` from `three_d_mesh_circumference` measurements.

### 4.10. Mesh-plane circumference engine ✓
- `lib/advanced-scoring/mesh-circumference.ts`: pure mesh-plane intersection → ring stitching → `MeshCircumferenceResult`. Confidence: starts 0.70, `-0.10` non-manifold, `-0.10` sparse, `-0.15` per significant open ring. `perimeter: null` for open rings (never invented).
- `MeasurementMethod` extended with `'three_d_mesh_circumference'` (types.ts, confidence.ts, cross-validation.ts).
- `CIRCUMFERENCE_FIELDS` set in cross-validation; Verified Score accepts `photo_polyline` + `three_d_mesh_circumference` (confidence ≥ 0.6) as valid for H1–H4.
- `components/measure/scene-3d.tsx`: "Record Circumference" `<Html>` button renders when `crossSectionPoints.length === 2` and `activeField` type is `'circumference'`. On click: traverses `threeScene`, builds flat position array, calls `computeMeshCircumference`, guards `closedRingCount === 0`, picks longest closed ring, converts via `unitsToInches`, calls `setMeshCircumferenceMeasurement`, clears cross-section. Shows error label inline on failure.
- `score-panel.tsx` MethodBadge: `three_d_mesh_circumference` → label `'Mesh Circ'`, color `'#d94a4a'`.
- `measure-store.ts`: `setMeshCircumferenceMeasurement` guards `isFiniteNumber && inchLength > 0 && ringClosed`. Open rings are rejected at the store level.

### 4.11. Admin training import (full flow) ✓
- `components/admin/training-import-form.tsx`: structured per-field inputs for all 19 B&C fields via `REQUIRED_BC_FIELDS`. Image types: live/mounted/harvest/front/side/angled/trail_cam. Preview table shows filled fields. `isBenchmark` checkbox with confirm Dialog that shows disclaimer copy before submission.
- `app/admin/training-import/page.tsx`: server-side auth guard (redirect to `/auth/login` if no session, redirect to `/` if not admin), disclaimer note, link back to `/admin/supervision`.
- `app/api/admin/training-import/route.ts`: accepts `is_benchmark` flag, passes to DB insert. **Note**: requires `ALTER TABLE official_score_sheets ADD COLUMN IF NOT EXISTS is_benchmark BOOLEAN DEFAULT FALSE;` migration.

### 4.12. Capture validation + retake intelligence ✓
- `app/api/detect/route.ts`: size/count guard — max 6 images, each ≤ 8 MB.
- `components/scoring/scoring-wizard.tsx`: `runPreScoreDetection` debounced 1200ms on `gridImages`; calls `/api/detect`, maps result through `detectionToScanFeedback` + `validateSubject`; shows colored status (green/yellow/red), retake button on rejection, soft suggestions. Submit blocked only when `subjectBlocked` (AI-detected failure); network errors never block.

### 4.13. Luma webhook + asset auto-wiring ✓
- `lib/reconstruction/webhook-cache.ts`: module-level in-memory Map, 30s TTL.
- `app/api/reconstruction/webhook/route.ts`: validates optional `LUMA_WEBHOOK_SECRET` header, stores result in cache.
- `app/api/reconstruction/status/route.ts`: checks webhook cache first, skips Luma API call within 30s TTL.
- `components/measure/photogrammetry-panel.tsx`: `useEffect` fires on `reconstructionStatus → 'completed'`; auto-sets `glbUrl` from `mesh_glb` asset, auto-calls `loadPointCloudText` for point cloud assets.

### 4.14. Verified PDF multi-thumbnail ✓
- `components/measure/score-panel.tsx`: collects up to 4 sources (`photoDataUrl` + `reconstructionAssets.type === 'preview_image'`), resizes each to ≤256px JPEG 70% via `<canvas>`, passes to `photoThumbnails`. Failures are silently skipped.

### 4.15. Phase 52 supervision hooks ✓
All five supervision hooks in `lib/supervision/hooks.ts` are now wired:
- `onReversePassComplete` — called from `lib/reverse-engineering/service.ts` at the end of `executePrecisionPass`.
- `onConflictDetected` — called from `lib/scoring/multi-view-service.ts`.
- `onStructuralSolverComplete` — called from `lib/structural-hypothesis/service.ts`.
- `onIntervalMiss` and `onHighConfidenceMiss` — called from `lib/validation/service.ts` inside `createValidationResult`. The function accepts optional `predictionId`, `predictedIntervalLow/High`, `confidenceTier`, `trustTier`, `segment` params; when supplied, both hooks fire after the row insert. Each hook gates internally on meaningful deviation (interval miss ≥ 0.25 in, high-conf miss ≥ 1.0 in + tier ∈ {high, very_high, extreme}). Hook failures are caught and logged, never thrown — they never block the validation insert.

The `createValidationResult` function is defined but has no production callers yet — once an admin route or worker wires it up with the optional supervision context, supervision events will flow automatically.

### 4.8. Render-time Zustand safety ✓
`useMeasureStore.getState()` is called in 4 places:
- `score-panel.tsx:331` — inside `handleExportJSON` (event handler, OK).
- `scene-3d.tsx:737` — inside a useEffect cleanup branch (OK).
- `photo-canvas.tsx:197/202/203/215` — inside pointer handlers (OK).

All other consumers use the subscription selector (`useMeasureStore(s => s.foo)`). Do not introduce `getState()` calls at render time.

---

## 5. What is partially done

### 5.1. Landmark / measurement-zone intelligence (partial)
- `lib/scoring/landmarks.ts` implements `estimateLandmarks` (procedural, NOT real CV — and the docstring says so explicitly) plus Phase 42 `computeEnhancedLandmarks` with per-landmark quality tiers.
- `lib/detection/build-antler-graph.ts` builds an `AntlerMeasurementGraph` from per-image detection landmarks.
- `lib/measure/graph-builder.ts` converts the measure-store state into a canonical `MeasurementGraph` for `scoreFromGraphNative`.
- Zone overlay, provenance badges, hover pulse: **DONE** — see §4.9.
- **Remaining**: Landmarks in `landmarks.ts` produce fixed normalized coordinates ("burr_left at (0.3, 0.15)") rather than real positions. This is a heuristic prior used as a fallback signal for confidence math, not a measurement source. Keep it that way until real CV lands.

### 5.2. `next-photo-guidance.ts`
Implemented in `lib/scoring/next-photo-guidance.ts` but never imported by any component or API route. It's a ready-to-use retake-recommendation engine.

---

## 6. What is NOT built yet

These are the explicit gaps from the handoff that have no implementation today.

### 6.1. Real terrain (low priority)
- `lib/mapping/` and the map UI handle 2D properties / pins. No elevation source is wired. Do not fake 3D terrain. `not_started` is the honest label.

### 6.2. DB migration for `is_benchmark`
The training-import API route accepts `is_benchmark` but the DB column must be added:
```sql
ALTER TABLE official_score_sheets ADD COLUMN IF NOT EXISTS is_benchmark BOOLEAN DEFAULT FALSE;
```
This is the only outstanding DB migration from the market-ready push.

### 6.3. `next-photo-guidance.ts` wiring
`lib/scoring/next-photo-guidance.ts` (`computeNextPhotoGuidance`) is implemented but not called. Wiring it into `/api/score/route.ts` requires computing four server-side pre-requisites that aren't currently produced in that route: `SegmentConfidenceIntervalResult`, `GeometryConsistencyResult`, `TrustScoreResult`, `LandmarksDetected`. Punt until a deliberate refactor adds those upstream — partial wiring would either produce misleading recommendations or silently no-op.

---

## 7. Critical coding rules (read this every plan)

### Truth and provenance
- Inferred values are tagged inferred. Estimated calibration is tagged estimated. Missing fields are tagged missing.
- Heuristic landmarks are not "AI". `source: 'heuristic'` is the correct label.
- Verified Score appears only when `computeVerifiedScoreStatus` returns `{ verified: true }`. There is no other path.
- "Official certification" / "B&C accepted" / "P&Y accepted" must never appear in copy. The only acceptable phrasing is the disclaimer from `score-pdf-builder.ts`.

### Safety
- Guard every numeric path with `isFiniteNumber` (`lib/advanced-scoring/geometry.ts`). No NaN or Infinity in scores, ever.
- API keys (Luma, OpenAI, FRED, anything) are server-side only. No `NEXT_PUBLIC_*` for secrets.
- Map / Supabase / external errors degrade to **empty fallback with warn log**, not 500.

### Architecture
- `lib/advanced-scoring/*` types are additive. Do not modify `lib/types.ts` `MeasurementGraph` types to fit advanced needs — extend, don't break.
- Backward-compat response shapes on `/api/score` must be preserved. Many clients read `prediction.*`.
- Route handlers stay thin. Math lives in `lib/...`.
- Three.js scene cleanup goes in useEffect cleanup. Dispose geometry/materials/textures.
- Never call `useMeasureStore.getState()` during render. Only in event handlers and effects.
- Zustand state changes that affect rendering should not be wrapped in `requestAnimationFrame` inside reducers — `scoring-wizard.tsx:84` does that on grid changes deliberately, do not generalize the pattern.

### Refactor discipline
- Surgical patches over broad refactors. The handoff is explicit: do not start a new v0 project, do not rewrite unrelated files.
- If a file is unrelated to the task, do not touch it. Even formatting.
- Keep existing fallback paths. Quick scoring must not break when advanced features are added.

### React 19 + R3F
- The repo is on R3F 9.5 + drei 10.7 + three 0.177. These versions are React 19 compatible. The earlier crash is gone.
- Do not casually upgrade or downgrade these three packages. If you need to, verify against `@react-three/fiber` release notes for React 19 first.

### Files that must not be casually changed
- `lib/capture/scan-session.ts` (truthful capture contract).
- `lib/scoring/resolve-image-roles.ts` (angle-role resolver contract).
- `lib/advanced-scoring/cross-validation.ts` (Verified Score rules + `REQUIRED_BC_FIELDS`).
- `lib/advanced-scoring/confidence.ts` (method base confidence).
- `lib/advanced-scoring/mesh-circumference.ts` (ring-closure algorithm — changes affect H1–H4 Verified Score eligibility).
- `lib/reconstruction/luma-adapter.ts` (server-only contract).
- `lib/export/score-pdf-builder.ts` disclaimer text.
- `next.config.mjs`, `tsconfig.json`, `proxy.ts`.

---

## 8. Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | All Supabase | client-safe |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All Supabase | client-safe |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | **server-only** |
| `OPENAI_API_KEY` | Quick scoring, detection | **server-only** |
| `LUMA_API_KEY` | Reconstruction | **server-only**; absent ⇒ manual fallback |
| `LUMA_RECON_SUBMIT_URL` | Reconstruction | absent ⇒ manual fallback |
| `LUMA_RECON_STATUS_URL` | Reconstruction | absent ⇒ manual fallback |
| `STRIPE_SECRET_KEY` | Billing | **server-only** |
| `STRIPE_WEBHOOK_SECRET` | Billing webhook | **server-only** |

`hasRequiredServerEnv` in `lib/env.ts` is the canonical validator. The score route returns a structured 500 listing what's missing.

---

## 9. Validation routine after any change

Run this checklist after **any** change in plan mode:

App routes (load without crashing):
- `/` `/score` `/score?mode=upload` `/measure` `/map` `/results/[any]` `/library` `/history` `/settings`
- `/admin/training-import` (if admin) `/admin/supervision` `/admin/calibration`

Camera (`/score`):
- No auto-capture occurs.
- No fake percentage shown.
- N/3 views counter increases only on user button press.
- "Switch to Upload" fallback works.
- Captured files flow into the scoring submission.

Quick scoring (`POST /api/score`):
- A non-deer image returns `422` with `errorType: 'detection_rejected'`.
- A good image returns `200` with `scoreComparison`, `effectiveGraph`, `confidence_explanation`, `disclaimer`.
- `selected_image_angles` in the request is never `[null, null, null]`.

Advanced scoring (`/measure`):
- Photo polyline measurements update inches via calibration.
- Uncalibrated measurements warn (and `Calibration2D.source === 'estimated'` is reflected in confidence).
- 3D scene loads with a GLB upload; falls back gracefully if no point cloud.
- Point-cloud snap distance is respected; sparse-density warning surfaces.
- Mesh fallback measurements show lower confidence than photo + point cloud.

Verified Score:
- Returns `verified: false` if any of: missing calibration, estimated calibration, missing photo or point-cloud source for any required B&C field, disagreement > 3%, low-confidence source, unresolved warnings.
- Returns `verified: true` only when all gates pass.

PDF export:
- Generates a PDF without throwing.
- Title says "Unverified Advanced Score" when `verified: false`.
- Disclaimer text is present and matches `lib/export/score-pdf-builder.ts`.

Map:
- Loads on dev even when Supabase tables don't exist (warn + empty list).
- No fake terrain rendered.

Build / typecheck:
- `pnpm tsc --noEmit` clean (or matches the current baseline if there are pre-existing errors).
- `pnpm build` succeeds.

---

## 10. Priority order (for any work session)

All 6 market-ready work items from the original plan are **DONE** (WI-1 through WI-6 per §4.9–§4.14).

**P1. Production validation-result writer — DONE**
`POST /api/admin/validation/record-result` wires `createValidationResult` with full supervision context. Admin-gated. Accepts `predictionId + runId + groundTruthGross` (+ optional intervals/tiers/segment). Looks up the prediction's `predicted_gross/net/confidence/scoring_method/state/rack_type` and the linked `training_example`, then fires `onIntervalMiss` / `onHighConfidenceMiss` if context is supplied.

**P2. `next-photo-guidance.ts` wiring — DONE (lightweight path)**
A new `computeLightweightPhotoGuidance` export in `lib/scoring/next-photo-guidance.ts` synthesizes the segment-confidence input from overall confidence, then runs the real coverage + quality + guidance pipeline. `/api/score/route.ts` computes `checkGeometryConsistency` (cheap, needs only measurements + landmarks + angles) and feeds it in. Response includes `photoGuidance: PhotoGuidanceMetadata | null`. Full segment-confidence wiring is still available for future upgrade — it just isn't required to get useful guidance to the UI today.

**P3. Map elevation source decision — DECISION NEEDED (no code yet)**
Pick one of these DEM providers, then wiring is straightforward:

| Provider | Cost | Coverage | Resolution | Notes |
|---|---|---|---|---|
| USGS 3DEP (Elevation Point Query Service) | Free | US only | ~10m | Public, no key. Best for US-first MVP. |
| Open-Elevation | Free | Global | ~30m (SRTM) | Self-hostable or public endpoint; rate-limited on public host. |
| Mapbox Terrain-RGB tiles | $0.50 / 1k tile requests after free tier | Global | ~10–30m | Already a Mapbox account if you add Mapbox layers. Best UX. |
| Google Elevation API | $5 / 1k requests after free tier | Global | varies | Most accurate, most expensive. Overkill for hunting maps. |

Recommendation: USGS 3DEP for v1 (US-only deer hunting market), upgrade to Mapbox Terrain-RGB when international users matter. Until decided, `not_started` is the honest label — do not fake 3D terrain.

**P4. Official sheet OCR / PDF transcription**
The admin training import form has per-field entry. Adding OCR (e.g. via OpenAI vision) to auto-transcribe uploaded official PDF score sheets would reduce manual entry friction.

---

## 11. Repository-specific tips

- `pnpm` is the lockfile. Use it.
- The `RAXCORE-main.zip` at the repo root is a snapshot artifact, not a build input.
- `tsconfig.tsbuildinfo` is committed for incremental builds.
- The `vercel.json` is a thin file — most cron and infra lives in the Vercel project config, not the repo.
- v0.app is linked. Commits to `main` deploy automatically. If you must push, do so in a feature branch.
- Phase markers (Phase 42, Phase 47, Phase 52, "Build B", "Part 3") appear in code comments and docs. Treat them as historical waypoints, not as required versioning.

---

## 12. North star (re-read before merging anything)

Every change must answer **yes** to:
1. Does this make a measurement more accurate or more honest about its accuracy?
2. Does this respect the provenance chain (`source`, `origin`, `visibility`, `calibrationSource`)?
3. Does this preserve graceful empty-state fallback when external services are absent?
4. Does this avoid claiming official certification?
5. Does this avoid auto-capture, fake detection, or fake percentages?

If any answer is no, the change is wrong even if the diff looks clean.
