import { createClient } from '@/lib/supabase/server'
import type { 
  ScoringSubmission, 
  TrainingExample, 
  ScoringResult,
  GroundTruthData 
} from '@/lib/types'

// ============================================================================
// BUCKS (Scoring Sessions)
// ============================================================================

export interface CreateBuckParams {
  sessionId: string
  nickname?: string
  location?: string
  harvestDate?: string
  notes?: string
}

export interface BuckRecord {
  id: string
  session_id: string
  nickname: string | null
  location: string | null
  harvest_date: string | null
  notes: string | null
  status: 'pending' | 'processing' | 'completed' | 'failed'
  created_at: string
  updated_at: string
}

export async function createBuck(params: CreateBuckParams): Promise<BuckRecord> {
  const supabase = await createClient()
  
  // Build minimal payload WITHOUT harvest_date first (safest approach)
  const minimalPayload = {
    session_id: params.sessionId,
    nickname: params.nickname || null,
    location: params.location || null,
    notes: params.notes || null,
    status: 'pending' as const
  }
  
  // If harvest_date is provided, try with it first
  if (params.harvestDate) {
    const fullPayload = { ...minimalPayload, harvest_date: params.harvestDate }
    
    const { data, error } = await supabase
      .from('bucks')
      .insert(fullPayload)
      .select()
      .single()
    
    // If schema error, fall back to minimal payload
    if (error) {
      const errMsg = error.message.toLowerCase()
      if (errMsg.includes('harvest_date') || errMsg.includes('schema cache') || errMsg.includes('column')) {
        console.warn('[createBuck] harvest_date column not available, retrying without it')
        // Fall through to minimal insert below
      } else {
        throw new Error(`Failed to create buck: ${error.message}`)
      }
    } else {
      return data
    }
  }
  
  // Insert with minimal payload (no harvest_date)
  const { data, error } = await supabase
    .from('bucks')
    .insert(minimalPayload)
    .select()
    .single()

  if (error) throw new Error(`Failed to create buck: ${error.message}`)
  return data
}

export async function getBuckBySessionId(sessionId: string): Promise<BuckRecord | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('bucks')
    .select('*')
    .eq('session_id', sessionId)
    .single()

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get buck: ${error.message}`)
  }
  return data
}

export async function getBuckById(id: string): Promise<BuckRecord | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('bucks')
    .select('*')
    .eq('id', id)
    .single()

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get buck: ${error.message}`)
  }
  return data
}

export async function updateBuckStatus(
  id: string, 
  status: 'pending' | 'processing' | 'completed' | 'failed'
): Promise<void> {
  const supabase = await createClient()
  
  const { error } = await supabase
    .from('bucks')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw new Error(`Failed to update buck status: ${error.message}`)
}

export async function listBucks(options?: {
  status?: string
  limit?: number
  offset?: number
}): Promise<{ data: BuckRecord[]; count: number }> {
  const supabase = await createClient()
  
  let query = supabase
    .from('bucks')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (options?.status) {
    query = query.eq('status', options.status)
  }
  if (options?.limit) {
    query = query.limit(options.limit)
  }
  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 10) - 1)
  }

  const { data, error, count } = await query

  if (error) throw new Error(`Failed to list bucks: ${error.message}`)
  return { data: data || [], count: count || 0 }
}

// ============================================================================
// BUCK IMAGES
// ============================================================================

export interface BuckImageRecord {
  id: string
  buck_id: string
  image_url: string
  image_type: string
  display_order: number
  created_at: string
}

export async function addBuckImages(
  buckId: string, 
  imageUrls: string[]
): Promise<BuckImageRecord[]> {
  const supabase = await createClient()
  
  const images = imageUrls.map((url, index) => ({
    buck_id: buckId,
    image_url: url,
    image_type: 'user_upload',
    display_order: index
  }))

  const { data, error } = await supabase
    .from('buck_images')
    .insert(images)
    .select()

  if (error) throw new Error(`Failed to add buck images: ${error.message}`)
  return data
}

export async function getBuckImages(buckId: string): Promise<BuckImageRecord[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('buck_images')
    .select('*')
    .eq('buck_id', buckId)
    .order('display_order', { ascending: true })

  if (error) throw new Error(`Failed to get buck images: ${error.message}`)
  return data || []
}

// ============================================================================
// PREDICTIONS
// ============================================================================

export interface PredictionRecord {
  id: string
  buck_id: string
  model_version_id: string | null
  estimated_score: number | null
  score_range_low: number | null
  score_range_high: number | null
  confidence: 'low' | 'medium' | 'high' | null
  main_beam_left: number | null
  main_beam_right: number | null
  inside_spread: number | null
  points_left: number | null
  points_right: number | null
  mass_estimate: string | null
  tine_lengths: Record<string, number> | null
  circumferences: Record<string, number> | null
  raw_ai_response: Record<string, unknown> | null
  intake_quality: Record<string, unknown> | null
  created_at: string
}

export interface CreatePredictionParams {
  buckId: string
  modelVersionId?: string
  result: ScoringResult
  rawResponse?: Record<string, unknown>
  intakeQuality?: Record<string, unknown> | null
}

export async function createPrediction(params: CreatePredictionParams): Promise<PredictionRecord> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('predictions')
    .insert({
      buck_id: params.buckId,
      model_version_id: params.modelVersionId || null,
      estimated_score: params.result.estimatedScore,
      score_range_low: params.result.scoreRange?.low,
      score_range_high: params.result.scoreRange?.high,
      confidence: params.result.confidence,
      main_beam_left: params.result.mainBeamLeft,
      main_beam_right: params.result.mainBeamRight,
      inside_spread: params.result.insideSpread,
      points_left: params.result.pointsLeft,
      points_right: params.result.pointsRight,
      mass_estimate: params.result.massEstimate,
      tine_lengths: params.result.tineLengths || null,
      circumferences: params.result.circumferences || null,
      raw_ai_response: params.rawResponse || null,
      intake_quality: params.intakeQuality || null
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create prediction: ${error.message}`)
  return data
}

export async function getPredictionByBuckId(buckId: string): Promise<PredictionRecord | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('predictions')
    .select('*')
    .eq('buck_id', buckId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get prediction: ${error.message}`)
  }
  return data
}

// ============================================================================
// GROUND TRUTH SCORES
// ============================================================================

export interface GroundTruthRecord {
  id: string
  buck_id: string
  official_score: number | null
  main_beam_left: number | null
  main_beam_right: number | null
  inside_spread: number | null
  points_left: number | null
  points_right: number | null
  g1_left: number | null
  g1_right: number | null
  g2_left: number | null
  g2_right: number | null
  g3_left: number | null
  g3_right: number | null
  g4_left: number | null
  g4_right: number | null
  h1_left: number | null
  h1_right: number | null
  h2_left: number | null
  h2_right: number | null
  h3_left: number | null
  h3_right: number | null
  h4_left: number | null
  h4_right: number | null
  scoring_method: string | null
  scorer_notes: string | null
  created_at: string
  updated_at: string
}

export async function upsertGroundTruth(
  buckId: string, 
  data: GroundTruthData
): Promise<GroundTruthRecord> {
  const supabase = await createClient()
  
  const record = {
    buck_id: buckId,
    official_score: data.officialScore ?? null,
    main_beam_left: data.mainBeamLeft ?? null,
    main_beam_right: data.mainBeamRight ?? null,
    inside_spread: data.insideSpread ?? null,
    points_left: data.pointsLeft ?? null,
    points_right: data.pointsRight ?? null,
    g1_left: data.g1Left ?? null,
    g1_right: data.g1Right ?? null,
    g2_left: data.g2Left ?? null,
    g2_right: data.g2Right ?? null,
    g3_left: data.g3Left ?? null,
    g3_right: data.g3Right ?? null,
    g4_left: data.g4Left ?? null,
    g4_right: data.g4Right ?? null,
    h1_left: data.h1Left ?? null,
    h1_right: data.h1Right ?? null,
    h2_left: data.h2Left ?? null,
    h2_right: data.h2Right ?? null,
    h3_left: data.h3Left ?? null,
    h3_right: data.h3Right ?? null,
    h4_left: data.h4Left ?? null,
    h4_right: data.h4Right ?? null,
    scoring_method: data.scoringMethod ?? null,
    scorer_notes: data.scorerNotes ?? null,
    updated_at: new Date().toISOString()
  }

  const { data: result, error } = await supabase
    .from('ground_truth_scores')
    .upsert(record, { onConflict: 'buck_id' })
    .select()
    .single()

  if (error) throw new Error(`Failed to upsert ground truth: ${error.message}`)
  return result
}

export async function getGroundTruthByBuckId(buckId: string): Promise<GroundTruthRecord | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('ground_truth_scores')
    .select('*')
    .eq('buck_id', buckId)
    .single()

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get ground truth: ${error.message}`)
  }
  return data
}

// ============================================================================
// TRAINING EXAMPLES
// ============================================================================

export interface TrainingExampleRecord {
  id: string
  buck_id: string | null
  image_urls: string[]
  ground_truth_score: number
  predicted_score: number | null
  error_amount: number | null
  main_beam_left: number | null
  main_beam_right: number | null
  inside_spread: number | null
  points_left: number | null
  points_right: number | null
  tine_measurements: Record<string, number> | null
  circumference_measurements: Record<string, number> | null
  verified_for_training: boolean
  verified_at: string | null
  verified_by: string | null
  quality_score: number | null
  source: string
  notes: string | null
  created_at: string
  updated_at: string
}

export interface CreateTrainingExampleParams {
  buckId?: string
  imageUrls: string[]
  groundTruthScore: number
  predictedScore?: number
  measurements?: {
    mainBeamLeft?: number
    mainBeamRight?: number
    insideSpread?: number
    pointsLeft?: number
    pointsRight?: number
    tineMeasurements?: Record<string, number>
    circumferenceMeasurements?: Record<string, number>
  }
  source?: string
  notes?: string
}

export async function createTrainingExample(
  params: CreateTrainingExampleParams
): Promise<TrainingExampleRecord> {
  const supabase = await createClient()
  
  const errorAmount = params.predictedScore != null 
    ? params.predictedScore - params.groundTruthScore 
    : null

  const { data, error } = await supabase
    .from('training_examples')
    .insert({
      buck_id: params.buckId || null,
      image_urls: params.imageUrls,
      ground_truth_score: params.groundTruthScore,
      predicted_score: params.predictedScore ?? null,
      error_amount: errorAmount,
      main_beam_left: params.measurements?.mainBeamLeft ?? null,
      main_beam_right: params.measurements?.mainBeamRight ?? null,
      inside_spread: params.measurements?.insideSpread ?? null,
      points_left: params.measurements?.pointsLeft ?? null,
      points_right: params.measurements?.pointsRight ?? null,
      tine_measurements: params.measurements?.tineMeasurements ?? null,
      circumference_measurements: params.measurements?.circumferenceMeasurements ?? null,
      verified_for_training: false,
      source: params.source || 'user_submission',
      notes: params.notes || null
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create training example: ${error.message}`)
  return data
}

export async function verifyTrainingExample(
  id: string, 
  verifiedBy: string,
  qualityScore?: number
): Promise<TrainingExampleRecord> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('training_examples')
    .update({
      verified_for_training: true,
      verified_at: new Date().toISOString(),
      verified_by: verifiedBy,
      quality_score: qualityScore ?? null,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`Failed to verify training example: ${error.message}`)
  return data
}

export async function unverifyTrainingExample(id: string): Promise<TrainingExampleRecord> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('training_examples')
    .update({
      verified_for_training: false,
      verified_at: null,
      verified_by: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`Failed to unverify training example: ${error.message}`)
  return data
}

export async function listTrainingExamples(options?: {
  verifiedOnly?: boolean
  limit?: number
  offset?: number
}): Promise<{ data: TrainingExampleRecord[]; count: number }> {
  const supabase = await createClient()
  
  let query = supabase
    .from('training_examples')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (options?.verifiedOnly) {
    query = query.eq('verified_for_training', true)
  }
  if (options?.limit) {
    query = query.limit(options.limit)
  }
  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 10) - 1)
  }

  const { data, error, count } = await query

  if (error) throw new Error(`Failed to list training examples: ${error.message}`)
  return { data: data || [], count: count || 0 }
}

export async function getTrainingExampleById(id: string): Promise<TrainingExampleRecord | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('training_examples')
    .select('*')
    .eq('id', id)
    .single()

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get training example: ${error.message}`)
  }
  return data
}

export async function deleteTrainingExample(id: string): Promise<void> {
  const supabase = await createClient()
  
  const { error } = await supabase
    .from('training_examples')
    .delete()
    .eq('id', id)

  if (error) throw new Error(`Failed to delete training example: ${error.message}`)
}

// ============================================================================
// MODEL VERSIONS
// ============================================================================

export interface ModelVersionRecord {
  id: string
  version_name: string
  description: string | null
  is_active: boolean
  training_data_count: number
  avg_gross_error: number | null
  avg_net_error: number | null
  created_at: string
  updated_at: string
}

export async function getActiveModelVersion(): Promise<ModelVersionRecord | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('model_versions')
    .select('*')
    .eq('is_active', true)
    .single()

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to get active model version: ${error.message}`)
  }
  return data
}

export async function listModelVersions(): Promise<ModelVersionRecord[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('model_versions')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to list model versions: ${error.message}`)
  return data || []
}

export async function updateModelVersionStats(
  id: string,
  stats: {
    trainingDataCount?: number
    avgGrossError?: number
    avgNetError?: number
  }
): Promise<void> {
  const supabase = await createClient()
  
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  }
  
  if (stats.trainingDataCount !== undefined) {
    updates.training_data_count = stats.trainingDataCount
  }
  if (stats.avgGrossError !== undefined) {
    updates.avg_gross_error = stats.avgGrossError
  }
  if (stats.avgNetError !== undefined) {
    updates.avg_net_error = stats.avgNetError
  }

  const { error } = await supabase
    .from('model_versions')
    .update(updates)
    .eq('id', id)

  if (error) throw new Error(`Failed to update model version stats: ${error.message}`)
}

// ============================================================================
// STATS & AGGREGATIONS
// ============================================================================

export interface AdminStats {
  totalSubmissions: number
  completedSubmissions: number
  totalTrainingExamples: number
  verifiedTraining: number
  avgGrossError: number | null
  avgNetError: number | null
}

export async function getAdminStats(): Promise<AdminStats> {
  const supabase = await createClient()
  
  // Get submission counts
  const { count: totalSubmissions } = await supabase
    .from('bucks')
    .select('*', { count: 'exact', head: true })

  const { count: completedSubmissions } = await supabase
    .from('bucks')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'completed')

  // Get training counts
  const { count: totalTrainingExamples } = await supabase
    .from('training_examples')
    .select('*', { count: 'exact', head: true })

  const { count: verifiedTraining } = await supabase
    .from('training_examples')
    .select('*', { count: 'exact', head: true })
    .eq('verified_for_training', true)

  // Get error averages from verified training examples
  const { data: errorData } = await supabase
    .from('training_examples')
    .select('error_amount')
    .eq('verified_for_training', true)
    .not('error_amount', 'is', null)

  let avgGrossError: number | null = null
  let avgNetError: number | null = null

  if (errorData && errorData.length > 0) {
    const errors = errorData.map(d => d.error_amount as number)
    avgGrossError = errors.reduce((sum, e) => sum + Math.abs(e), 0) / errors.length
    avgNetError = errors.reduce((sum, e) => sum + e, 0) / errors.length
  }

  return {
    totalSubmissions: totalSubmissions || 0,
    completedSubmissions: completedSubmissions || 0,
    totalTrainingExamples: totalTrainingExamples || 0,
    verifiedTraining: verifiedTraining || 0,
    avgGrossError,
    avgNetError
  }
}

// ============================================================================
// FULL SUBMISSION DATA (joins)
// ============================================================================

export interface FullSubmission {
  buck: BuckRecord
  images: BuckImageRecord[]
  prediction: PredictionRecord | null
  groundTruth: GroundTruthRecord | null
  trainingExample: TrainingExampleRecord | null
}

export async function getFullSubmission(sessionId: string): Promise<FullSubmission | null> {
  const buck = await getBuckBySessionId(sessionId)
  if (!buck) return null

  const [images, prediction, groundTruth] = await Promise.all([
    getBuckImages(buck.id),
    getPredictionByBuckId(buck.id),
    getGroundTruthByBuckId(buck.id)
  ])

  // Check if there's a training example for this buck
  const supabase = await createClient()
  const { data: trainingExample } = await supabase
    .from('training_examples')
    .select('*')
    .eq('buck_id', buck.id)
    .single()

  return {
    buck,
    images,
    prediction,
    groundTruth,
    trainingExample: trainingExample || null
  }
}

export async function getFullSubmissionById(buckId: string): Promise<FullSubmission | null> {
  const buck = await getBuckById(buckId)
  if (!buck) return null

  const [images, prediction, groundTruth] = await Promise.all([
    getBuckImages(buck.id),
    getPredictionByBuckId(buck.id),
    getGroundTruthByBuckId(buck.id)
  ])

  const supabase = await createClient()
  const { data: trainingExample } = await supabase
    .from('training_examples')
    .select('*')
    .eq('buck_id', buck.id)
    .single()

  return {
    buck,
    images,
    prediction,
    groundTruth,
    trainingExample: trainingExample || null
  }
}

// ========================================
// PROPERTY FUNCTIONS (Phase 6 Mapping)
// ========================================

export async function createProperty(data: {
  name: string
  owner_label?: string
  state?: string
  county?: string
  property_type?: string
  acreage?: number
  notes?: string
  boundary_geojson?: object
}): Promise<{ id: string } | null> {
  const supabase = await createClient()
  const { data: property, error } = await supabase
    .from('properties')
    .insert({
      name: data.name,
      owner_label: data.owner_label || null,
      state: data.state || null,
      county: data.county || null,
      property_type: data.property_type || 'unknown',
      acreage: data.acreage || null,
      notes: data.notes || null,
      boundary_geojson: data.boundary_geojson || null
    })
    .select('id')
    .single()

  if (error) {
    console.error('Error creating property:', error)
    return null
  }
  return property
}

export async function getPropertyById(id: string): Promise<any | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return null
  return data
}

export async function getAllProperties(filters?: {
  state?: string
  property_type?: string
}): Promise<any[]> {
  const supabase = await createClient()
  let query = supabase
    .from('properties')
    .select('*')
    .order('created_at', { ascending: false })

  if (filters?.state) {
    query = query.eq('state', filters.state)
  }
  if (filters?.property_type) {
    query = query.eq('property_type', filters.property_type)
  }

  const { data, error } = await query
  if (error) {
    console.error('Error fetching properties:', error)
    return []
  }
  return data || []
}

export async function updateProperty(id: string, data: Partial<{
  name: string
  owner_label: string
  state: string
  county: string
  property_type: string
  acreage: number
  notes: string
  boundary_geojson: object
}>): Promise<boolean> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('properties')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    console.error('Error updating property:', error)
    return false
  }
  return true
}

export async function deleteProperty(id: string): Promise<boolean> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('properties')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Error deleting property:', error)
    return false
  }
  return true
}

// ========================================
// MAP PIN FUNCTIONS (Phase 6 Mapping)
// ========================================

export async function createMapPin(data: {
  property_id?: string
  buck_id?: string
  label?: string
  location_type?: string
  latitude?: number
  longitude?: number
  is_approximate?: boolean
  confidence_radius_meters?: number
  pin_date?: string
  notes?: string
}): Promise<{ id: string } | null> {
  const supabase = await createClient()
  const { data: pin, error } = await supabase
    .from('map_pins')
    .insert({
      property_id: data.property_id || null,
      buck_id: data.buck_id || null,
      label: data.label || null,
      location_type: data.location_type || 'unknown',
      latitude: data.latitude || null,
      longitude: data.longitude || null,
      is_approximate: data.is_approximate || false,
      confidence_radius_meters: data.confidence_radius_meters || null,
      pin_date: data.pin_date || null,
      notes: data.notes || null
    })
    .select('id')
    .single()

  if (error) {
    console.error('Error creating map pin:', error)
    return null
  }
  return pin
}

export async function getMapPinById(id: string): Promise<any | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('map_pins')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return null
  return data
}

export async function getMapPinsByPropertyId(propertyId: string): Promise<any[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('map_pins')
    .select('*')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching map pins:', error)
    return []
  }
  return data || []
}

export async function getMapPinsByBuckId(buckId: string): Promise<any[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('map_pins')
    .select('*')
    .eq('buck_id', buckId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching map pins for buck:', error)
    return []
  }
  return data || []
}

export async function getAllMapPins(filters?: {
  property_id?: string
  location_type?: string
  state?: string
  year?: number
}): Promise<any[]> {
  const supabase = await createClient()
  let query = supabase
    .from('map_pins')
    .select(`
      *,
      property:properties(id, name, state),
      buck:bucks(id, session_id, nickname)
    `)
    .order('created_at', { ascending: false })

  if (filters?.property_id) {
    query = query.eq('property_id', filters.property_id)
  }
  if (filters?.location_type) {
    query = query.eq('location_type', filters.location_type)
  }

  const { data, error } = await query
  if (error) {
    console.error('Error fetching all map pins:', error)
    return []
  }
  return data || []
}

export async function updateMapPin(id: string, data: Partial<{
  property_id: string
  buck_id: string
  label: string
  location_type: string
  latitude: number
  longitude: number
  is_approximate: boolean
  confidence_radius_meters: number
  pin_date: string
  notes: string
}>): Promise<boolean> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('map_pins')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    console.error('Error updating map pin:', error)
    return false
  }
  return true
}

export async function deleteMapPin(id: string): Promise<boolean> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('map_pins')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Error deleting map pin:', error)
    return false
  }
  return true
}

// ========================================
// BUCK MAPPING FUNCTIONS
// ========================================

export async function linkBuckToProperty(buckId: string, propertyId: string): Promise<boolean> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('bucks')
    .update({ property_id: propertyId, updated_at: new Date().toISOString() })
    .eq('id', buckId)

  if (error) {
    console.error('Error linking buck to property:', error)
    return false
  }
  return true
}

export async function setBuckPrimaryPin(buckId: string, pinId: string): Promise<boolean> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('bucks')
    .update({ primary_pin_id: pinId, updated_at: new Date().toISOString() })
    .eq('id', buckId)

  if (error) {
    console.error('Error setting buck primary pin:', error)
    return false
  }
  return true
}

export async function getBucksForProperty(propertyId: string): Promise<any[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('bucks')
    .select(`
      *,
      predictions(estimated_score, confidence),
      buck_images(image_url)
    `)
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching bucks for property:', error)
    return []
  }
  return data || []
}

export async function getPropertyWithDetails(propertyId: string): Promise<any | null> {
  const supabase = await createClient()
  
  const [propertyResult, pinsResult, bucksResult] = await Promise.all([
    supabase.from('properties').select('*').eq('id', propertyId).single(),
    supabase.from('map_pins').select('*').eq('property_id', propertyId).order('created_at', { ascending: false }),
    supabase.from('bucks').select(`
      *,
      predictions(estimated_score, confidence),
      buck_images(image_url)
    `).eq('property_id', propertyId).order('created_at', { ascending: false })
  ])

  if (propertyResult.error) {
    console.error('Error fetching property details:', propertyResult.error)
    return null
  }

  return {
    ...propertyResult.data,
    pins: pinsResult.data || [],
    bucks: bucksResult.data || []
  }
}

export async function getMapStats(): Promise<{
  totalProperties: number
  totalPins: number
  mappedBucks: number
}> {
  const supabase = await createClient()
  
  const [propertiesCount, pinsCount, mappedBucksCount] = await Promise.all([
    supabase.from('properties').select('id', { count: 'exact', head: true }),
    supabase.from('map_pins').select('id', { count: 'exact', head: true }),
    supabase.from('bucks').select('id', { count: 'exact', head: true }).not('property_id', 'is', null)
  ])

  return {
    totalProperties: propertiesCount.count || 0,
    totalPins: pinsCount.count || 0,
    mappedBucks: mappedBucksCount.count || 0
  }
}

// ========================================
// RENDER JOB FUNCTIONS (Phase 7/8)
// ========================================

export interface RenderJobRecord {
  id: string
  buck_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  settings: Record<string, unknown>
  progress_percent: number
  error_message: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface RenderOutputRecord {
  id: string
  render_job_id: string
  view_type: string
  image_url: string | null
  thumbnail_url: string | null
  created_at: string
}

export async function createRenderJobRecord(
  buckId: string,
  settings: Record<string, unknown>
): Promise<RenderJobRecord | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('render_jobs')
    .insert({
      buck_id: buckId,
      status: 'pending',
      settings,
      progress_percent: 0
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating render job:', error)
    return null
  }
  return data
}

export async function getRenderJobById(id: string): Promise<RenderJobRecord | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('render_jobs')
    .select('*')
    .eq('id', id)
    .single()

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching render job:', error)
    return null
  }
  return data
}

export async function getRenderJobsByBuckId(buckId: string): Promise<RenderJobRecord[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('render_jobs')
    .select('*')
    .eq('buck_id', buckId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching render jobs for buck:', error)
    return []
  }
  return data || []
}

export async function getLatestRenderJobForBuck(buckId: string): Promise<RenderJobRecord | null> {
  const jobs = await getRenderJobsByBuckId(buckId)
  return jobs[0] || null
}

export async function updateRenderJobStatus(
  id: string,
  updates: {
    status?: 'pending' | 'processing' | 'completed' | 'failed'
    progress_percent?: number
    error_message?: string | null
  }
): Promise<RenderJobRecord | null> {
  const supabase = await createClient()
  
  const updateData: Record<string, unknown> = {
    ...updates,
    updated_at: new Date().toISOString()
  }
  
  if (updates.status === 'completed') {
    updateData.completed_at = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('render_jobs')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Error updating render job:', error)
    return null
  }
  return data
}

export async function addRenderOutputRecord(
  jobId: string,
  viewType: string,
  imageUrl?: string,
  thumbnailUrl?: string
): Promise<RenderOutputRecord | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('render_outputs')
    .insert({
      render_job_id: jobId,
      view_type: viewType,
      image_url: imageUrl || null,
      thumbnail_url: thumbnailUrl || null
    })
    .select()
    .single()

  if (error) {
    console.error('Error adding render output:', error)
    return null
  }
  return data
}

export async function getRenderOutputsForJob(jobId: string): Promise<RenderOutputRecord[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('render_outputs')
    .select('*')
    .eq('render_job_id', jobId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Error fetching render outputs:', error)
    return []
  }
  return data || []
}

export async function deleteRenderJobRecord(id: string): Promise<boolean> {
  const supabase = await createClient()
  
  const { error } = await supabase
    .from('render_jobs')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Error deleting render job:', error)
    return false
  }
  return true
}

export async function hasRenderJobForBuck(buckId: string): Promise<boolean> {
  const jobs = await getRenderJobsByBuckId(buckId)
  return jobs.length > 0
}

export async function getRenderStats(): Promise<{
  total: number
  pending: number
  processing: number
  completed: number
  failed: number
}> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('render_jobs')
    .select('status')

  if (error) {
    console.error('Error fetching render stats:', error)
    return { total: 0, pending: 0, processing: 0, completed: 0, failed: 0 }
  }

  const jobs = data || []
  return {
    total: jobs.length,
    pending: jobs.filter(j => j.status === 'pending').length,
    processing: jobs.filter(j => j.status === 'processing').length,
    completed: jobs.filter(j => j.status === 'completed').length,
    failed: jobs.filter(j => j.status === 'failed').length
  }
}

// ========================================
// BUNDLE + HISTORY HELPERS (Phase 12A)
// ========================================

import type {
  Buck,
  BuckImage,
  Prediction,
  GroundTruthScore,
} from '@/lib/types'

/**
 * Fetch a full buck bundle from Supabase — mirrors local-db.getBuckBundle.
 */
export async function getBuckBundle(id: string): Promise<{
  buck: Buck | null
  images: BuckImage[]
  prediction: Prediction | null
  groundTruth: GroundTruthScore | null
}> {
  const supabase = await createClient()

  const [buckResult, imagesResult, predictionsResult, groundTruthResult] = await Promise.all([
    supabase.from('bucks').select('*').eq('id', id).single(),
    supabase.from('buck_images').select('*').eq('buck_id', id).order('created_at', { ascending: true }),
    supabase.from('predictions').select('*').eq('buck_id', id).order('created_at', { ascending: false }).limit(1),
    supabase.from('ground_truth_scores').select('*').eq('buck_id', id).order('created_at', { ascending: false }).limit(1),
  ])

  return {
    buck: (buckResult.data as Buck | null) ?? null,
    images: (imagesResult.data as BuckImage[]) ?? [],
    prediction: (predictionsResult.data?.[0] as Prediction | null) ?? null,
    groundTruth: (groundTruthResult.data?.[0] as GroundTruthScore | null) ?? null,
  }
}

/**
 * List bucks with their latest prediction + thumbnail — paginated.
 * Replaces the old listHistory which fetched all rows with no limit.
 */
export async function listHistory(options?: {
  limit?: number
  offset?: number
}): Promise<{
  data: (Buck & { buck_images: BuckImage[]; predictions: Prediction[] })[]
  count: number
}> {
  const supabase = await createClient()
  const limit = options?.limit ?? 20
  const offset = options?.offset ?? 0

  const { data: bucks, error: bucksError, count } = await supabase
    .from('bucks')
    .select('id, session_id, nickname, location, state, rack_type, main_frame_points, status, created_at, updated_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (bucksError || !bucks?.length) return { data: [], count: count ?? 0 }

  const buckIds = bucks.map(b => b.id)

  const [imagesResult, predictionsResult] = await Promise.all([
    supabase
      .from('buck_images')
      .select('id, buck_id, public_url, image_type, display_order')
      .in('buck_id', buckIds)
      .order('display_order', { ascending: true }),
    supabase
      .from('predictions')
      .select('id, buck_id, predicted_gross, confidence_percent, scoring_method, created_at')
      .in('buck_id', buckIds)
      .order('created_at', { ascending: false }),
  ])

  const images: BuckImage[] = (imagesResult.data as BuckImage[]) ?? []
  const predictions: Prediction[] = (predictionsResult.data as Prediction[]) ?? []

  const data = (bucks as Buck[]).map(buck => ({
    ...buck,
    buck_images: images.filter(img => img.buck_id === buck.id),
    predictions: predictions.filter(p => p.buck_id === buck.id).slice(0, 1),
  }))

  return { data, count: count ?? 0 }
}

/**
 * List bucks for a specific user (for their library) — paginated.
 */
export async function listUserBucks(
  userId: string,
  options?: { limit?: number; offset?: number }
): Promise<{
  data: (Buck & { buck_images: BuckImage[]; predictions: Prediction[] })[]
  count: number
}> {
  const supabase = await createClient()
  const limit = options?.limit ?? 20
  const offset = options?.offset ?? 0

  const { data: bucks, error: bucksError, count } = await supabase
    .from('bucks')
    .select('id, session_id, nickname, location, state, rack_type, main_frame_points, status, created_at, updated_at', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (bucksError || !bucks?.length) return { data: [], count: count ?? 0 }

  const buckIds = bucks.map(b => b.id)

  const [imagesResult, predictionsResult] = await Promise.all([
    supabase
      .from('buck_images')
      .select('id, buck_id, public_url, image_type, display_order')
      .in('buck_id', buckIds)
      .order('display_order', { ascending: true }),
    supabase
      .from('predictions')
      .select('id, buck_id, predicted_gross, confidence_percent, scoring_method, created_at')
      .in('buck_id', buckIds)
      .order('created_at', { ascending: false }),
  ])

  const images: BuckImage[] = (imagesResult.data as BuckImage[]) ?? []
  const predictions: Prediction[] = (predictionsResult.data as Prediction[]) ?? []

  const data = (bucks as Buck[]).map(buck => ({
    ...buck,
    buck_images: images.filter(img => img.buck_id === buck.id),
    predictions: predictions.filter(p => p.buck_id === buck.id).slice(0, 1),
  }))

  return { data, count: count ?? 0 }
}

// ============================================================================
// BUCK SHARING
// ============================================================================

/**
 * Generate a share token for a buck
 */
export async function generateBuckShareToken(buckId: string): Promise<string> {
  const supabase = await createClient()
  
  // Generate a random token
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  
  const { error } = await supabase
    .from('bucks')
    .update({ 
      share_token: token,
      is_public: true 
    })
    .eq('id', buckId)

  if (error) throw new Error(`Failed to generate share token: ${error.message}`)
  return token
}

/**
 * Get a buck by its share token (for public sharing)
 */
export async function getBuckByShareToken(token: string): Promise<(Buck & {
  buck_images: BuckImage[]
  predictions: Prediction[]
}) | null> {
  const supabase = await createClient()
  
  const { data: buck, error: buckError } = await supabase
    .from('bucks')
    .select('*')
    .eq('share_token', token)
    .eq('is_public', true)
    .single()

  if (buckError || !buck) return null
  
  const [imagesResult, predictionsResult] = await Promise.all([
    supabase.from('buck_images').select('*').eq('buck_id', buck.id),
    supabase.from('predictions').select('*').eq('buck_id', buck.id).order('created_at', { ascending: false }),
  ])

  return {
    ...(buck as Buck),
    buck_images: (imagesResult.data as BuckImage[]) ?? [],
    predictions: (predictionsResult.data as Prediction[])?.slice(0, 1) ?? [],
  }
}

/**
 * Disable sharing for a buck
 */
export async function disableBuckSharing(buckId: string): Promise<void> {
  const supabase = await createClient()
  
  const { error } = await supabase
    .from('bucks')
    .update({ 
      share_token: null,
      is_public: false 
    })
    .eq('id', buckId)

  if (error) throw new Error(`Failed to disable sharing: ${error.message}`)
}

// ============================================================================
// RENDER JOBS
// ============================================================================

/**
 * Admin: list all render jobs with pagination and optional status filter.
 */
export async function listRenderJobsAdmin(options?: {
  status?: 'pending' | 'processing' | 'completed' | 'failed'
  limit?: number
  offset?: number
}): Promise<{ jobs: RenderJobRecord[]; total: number }> {
  const supabase = await createClient()

  let query = supabase
    .from('render_jobs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (options?.status) {
    query = query.eq('status', options.status)
  }
  if (options?.limit) {
    query = query.limit(options.limit)
  }
  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit ?? 20) - 1)
  }

  const { data, count, error } = await query

  if (error) {
    console.error('Error listing render jobs:', error)
    return { jobs: [], total: 0 }
  }

  return { jobs: (data as RenderJobRecord[]) ?? [], total: count ?? 0 }
}
