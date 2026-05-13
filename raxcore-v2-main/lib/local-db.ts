import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { Buck, BuckImage, GroundTruthScore, ModelVersion, Prediction, Profile, TrainingExample } from '@/lib/types'

interface LocalDb {
  bucks: Buck[]
  buck_images: BuckImage[]
  predictions: Prediction[]
  ground_truth_scores: GroundTruthScore[]
  training_examples: TrainingExample[]
  model_versions: ModelVersion[]
  profiles: Profile[]
}

const dataDir = path.join(process.cwd(), '.data')
const dbPath = path.join(dataDir, 'db.json')

function now() {
  return new Date().toISOString()
}

function defaultDb(): LocalDb {
  const ts = now()
  return {
    bucks: [],
    buck_images: [],
    predictions: [],
    ground_truth_scores: [],
    training_examples: [],
    model_versions: [
      {
        id: randomUUID(),
        version_name: 'rutai-v1-local',
        description: 'Local heuristic scorer with persistent verified-learning loop',
        is_active: true,
        training_data_count: 0,
        avg_gross_error: null,
        avg_net_error: null,
        created_at: ts,
        updated_at: ts,
      },
    ],
    profiles: [
      {
        id: 'local-admin',
        display_name: 'Local Admin',
        is_admin: true,
        created_at: ts,
        updated_at: ts,
      },
    ],
  }
}

function migrateDb(raw: Partial<LocalDb>): LocalDb {
  const db = {
    ...defaultDb(),
    ...raw,
  } as LocalDb

  db.bucks = (raw.bucks || []).map((buck) => ({
    capture_device: null,
    harvest_year: null,
    main_frame_points: null,
    ...buck,
  })) as Buck[]

  db.buck_images = (raw.buck_images || []) as BuckImage[]
  db.predictions = (raw.predictions || []) as Prediction[]
  db.ground_truth_scores = (raw.ground_truth_scores || []) as GroundTruthScore[]
  db.training_examples = (raw.training_examples || []) as TrainingExample[]
  db.model_versions = (raw.model_versions && raw.model_versions.length ? raw.model_versions : defaultDb().model_versions) as ModelVersion[]
  db.profiles = (raw.profiles && raw.profiles.length ? raw.profiles : defaultDb().profiles) as Profile[]

  return db
}

async function ensureDb() {
  await fs.mkdir(dataDir, { recursive: true })
  try {
    await fs.access(dbPath)
  } catch {
    await fs.writeFile(dbPath, JSON.stringify(defaultDb(), null, 2), 'utf8')
  }
}

export async function readDb(): Promise<LocalDb> {
  await ensureDb()
  const raw = JSON.parse(await fs.readFile(dbPath, 'utf8')) as Partial<LocalDb>
  const db = migrateDb(raw)
  return db
}

export async function writeDb(db: LocalDb) {
  await ensureDb()
  await fs.writeFile(dbPath, JSON.stringify(db, null, 2), 'utf8')
}

export async function createBuckRecord(input: Omit<Buck, 'id' | 'created_at' | 'updated_at'>) {
  const db = await readDb()
  const buck: Buck = { id: randomUUID(), created_at: now(), updated_at: now(), ...input }
  db.bucks.unshift(buck)
  await writeDb(db)
  return buck
}

export async function updateBuckStatus(id: string, status: Buck['status']) {
  const db = await readDb()
  const buck = db.bucks.find((b) => b.id === id)
  if (!buck) return null
  buck.status = status
  buck.updated_at = now()
  await writeDb(db)
  return buck
}

export async function addBuckImageRecord(input: Omit<BuckImage, 'id' | 'created_at'>) {
  const db = await readDb()
  const image: BuckImage = { id: randomUUID(), created_at: now(), ...input }
  db.buck_images.push(image)
  await writeDb(db)
  return image
}

export async function getActiveModel() {
  const db = await readDb()
  return db.model_versions.find((m) => m.is_active) || db.model_versions[0] || null
}

export async function addPredictionRecord(input: Omit<Prediction, 'id' | 'created_at'>) {
  const db = await readDb()
  const prediction: Prediction = { id: randomUUID(), created_at: now(), ...input }
  db.predictions.unshift(prediction)
  await writeDb(db)
  return prediction
}

export async function addGroundTruthRecord(input: Omit<GroundTruthScore, 'id' | 'created_at' | 'updated_at'>) {
  const db = await readDb()
  const gt: GroundTruthScore = { id: randomUUID(), created_at: now(), updated_at: now(), ...input }
  db.ground_truth_scores.unshift(gt)
  await writeDb(db)
  return gt
}

export async function addTrainingExampleRecord(input: Omit<TrainingExample, 'id' | 'created_at'>) {
  const db = await readDb()
  const example: TrainingExample = { id: randomUUID(), created_at: now(), ...input }
  db.training_examples.unshift(example)
  await refreshModelMetricsInDb(db)
  await writeDb(db)
  return example
}

export async function setTrainingExampleVerified(id: string, verified: boolean) {
  const db = await readDb()
  const example = db.training_examples.find((e) => e.id === id)
  if (!example) return null
  example.verified_for_training = verified
  example.verified_at = now()
  example.verified_by = 'local-admin'
  const groundTruth = db.ground_truth_scores.find((g) => g.id === example.ground_truth_id)
  if (groundTruth) {
    groundTruth.verified = verified
    groundTruth.verified_at = now()
    groundTruth.verified_by = 'local-admin'
    groundTruth.updated_at = now()
  }
  await refreshModelMetricsInDb(db)
  await writeDb(db)
  return example
}

async function refreshModelMetricsInDb(db: LocalDb) {
  const verified = db.training_examples.filter((e) => e.verified_for_training)
  const gross = verified.map((e) => e.abs_gross_error).filter((v): v is number => typeof v === 'number')
  const net = verified.map((e) => e.abs_net_error).filter((v): v is number => typeof v === 'number')
  const avgGross = gross.length ? gross.reduce((a, b) => a + b, 0) / gross.length : null
  const avgNet = net.length ? net.reduce((a, b) => a + b, 0) / net.length : null
  db.model_versions = db.model_versions.map((m) => ({
    ...m,
    training_data_count: verified.length,
    avg_gross_error: avgGross,
    avg_net_error: avgNet,
    updated_at: now(),
  }))
}

export async function listHistory() {
  const db = await readDb()
  return db.bucks
    .slice()
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
    .map((buck) => ({
      ...buck,
      buck_images: db.buck_images.filter((img) => img.buck_id === buck.id),
      predictions: db.predictions.filter((p) => p.buck_id === buck.id).slice(0, 1),
    }))
}

export async function getBuckBundle(id: string) {
  const db = await readDb()
  const buck = db.bucks.find((b) => b.id === id) || null
  const images = db.buck_images.filter((img) => img.buck_id === id)
  const prediction = db.predictions.filter((p) => p.buck_id === id).sort((a,b)=>+new Date(b.created_at)-+new Date(a.created_at))[0] || null
  const groundTruth = db.ground_truth_scores.find((g) => g.buck_id === id) || null
  return { buck, images, prediction, groundTruth }
}

export async function getAdminStats() {
  const db = await readDb()
  const verified = db.training_examples.filter((e) => e.verified_for_training)
  const avgGrossError = verified.length ? verified.reduce((s, e) => s + (e.abs_gross_error || 0), 0) / verified.length : 0
  const avgNetError = verified.length ? verified.reduce((s, e) => s + (e.abs_net_error || 0), 0) / verified.length : 0
  return {
    totalBucks: db.bucks.length,
    totalPredictions: db.predictions.length,
    totalGroundTruth: db.ground_truth_scores.length,
    verifiedTraining: verified.length,
    pendingVerification: db.training_examples.filter((e) => !e.verified_for_training).length,
    recentSubmissions: db.bucks.slice().sort((a,b)=>+new Date(b.created_at)-+new Date(a.created_at)).slice(0,5),
    modelVersion: db.model_versions.find((m) => m.is_active) || null,
    avgGrossError,
    avgNetError,
  }
}

export async function listSubmissions(params: { page?: number; limit?: number; state?: string; rack_type?: string; status?: string }) {
  const db = await readDb()
  const page = params.page || 1
  const limit = params.limit || 20
  let submissions = db.bucks.slice().sort((a,b)=>+new Date(b.created_at)-+new Date(a.created_at))
  if (params.state) submissions = submissions.filter((s) => s.state === params.state)
  if (params.rack_type) submissions = submissions.filter((s) => s.rack_type === params.rack_type)
  if (params.status) submissions = submissions.filter((s) => s.status === params.status)
  const total = submissions.length
  const paged = submissions.slice((page-1)*limit, page*limit).map((buck) => ({
    ...buck,
    predictions: db.predictions.filter((p) => p.buck_id === buck.id).slice(0,1),
    ground_truth_scores: db.ground_truth_scores.filter((g) => g.buck_id === buck.id).slice(0,1),
  }))
  return { submissions: paged, total, page, limit }
}

export async function listTrainingExamples(params: { page?: number; limit?: number; verified?: string }) {
  const db = await readDb()
  const page = params.page || 1
  const limit = params.limit || 20
  let examples = db.training_examples.slice().sort((a,b)=>+new Date(b.created_at)-+new Date(a.created_at))
  if (params.verified === 'true') examples = examples.filter((e) => e.verified_for_training)
  if (params.verified === 'false') examples = examples.filter((e) => !e.verified_for_training)
  const total = examples.length
  const paged = examples.slice((page-1)*limit, page*limit).map((ex) => {
    const prediction = db.predictions.find((p) => p.id === ex.prediction_id)
    const gt = db.ground_truth_scores.find((g) => g.id === ex.ground_truth_id)
    const buck = prediction ? db.bucks.find((b) => b.id === prediction.buck_id) : null
    return {
      ...ex,
      predictions: prediction ? { ...prediction, bucks: buck } : null,
      ground_truth_scores: gt,
    }
  })
  return { examples: paged, total, page, limit }
}

export async function listModelVersions() {
  const db = await readDb()
  return db.model_versions.slice().sort((a,b)=>+new Date(b.created_at)-+new Date(a.created_at))
}

export async function activateModelVersion(id: string) {
  const db = await readDb()
  db.model_versions = db.model_versions.map((m) => ({ ...m, is_active: m.id === id, updated_at: now() }))
  await writeDb(db)
  return db.model_versions
}

export async function exportTrainingData(verifiedOnly: boolean) {
  const db = await readDb()
  const examples = verifiedOnly ? db.training_examples.filter((e) => e.verified_for_training) : db.training_examples
  return examples.map((item) => {
    const prediction = db.predictions.find((p) => p.id === item.prediction_id)
    const groundTruth = db.ground_truth_scores.find((g) => g.id === item.ground_truth_id)
    const buck = prediction ? db.bucks.find((b) => b.id === prediction.buck_id) : null
    const model = prediction ? db.model_versions.find((m) => m.id === prediction.model_version_id) : null
    return {
      training_example_id: item.id,
      buck_id: buck?.id,
      state: buck?.state,
      rack_type: buck?.rack_type,
      harvest_method: buck?.harvest_method,
      source_type: buck?.source_type,
      capture_device: buck?.capture_device,
      ears_fully_visible: buck?.ears_fully_visible,
      harvest_year: buck?.harvest_year,
      main_frame_points: buck?.main_frame_points,
      predicted_gross: prediction?.predicted_gross,
      predicted_net: prediction?.predicted_net,
      confidence_percent: prediction?.confidence_percent,
      images_used: prediction?.images_used,
      angle_diversity_score: prediction?.angle_diversity_score,
      model_version: model?.version_name,
      official_gross: groundTruth?.official_gross,
      official_net: groundTruth?.official_net,
      score_source: groundTruth?.score_source,
      scorer_name: groundTruth?.scorer_name,
      scoring_organization: groundTruth?.scoring_organization,
      ground_truth_verified: groundTruth?.verified,
      gross_error: item.gross_error,
      net_error: item.net_error,
      abs_gross_error: item.abs_gross_error,
      abs_net_error: item.abs_net_error,
      verified_for_training: item.verified_for_training,
      quality_flags: item.quality_flags,
      measurements: prediction?.measurements,
      landmarks: prediction?.landmarks,
      created_at: item.created_at,
    }
  })
}
