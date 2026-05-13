'use server'

import { createClient } from '@/lib/supabase/server'
import type {
  TrainingExample,
  ExportPack,
  ExportPackExample,
  ExportRun,
  CandidateModel,
  OfflineEvaluation,
  RetrainingReadiness,
  DataGap,
  SplitConfig,
  ExportPackFilters,
  GapSeverity,
  ReadinessTier,
  SplitAssignment,
} from '@/lib/types'

// ============================================================================
// TRAINING EXAMPLES
// ============================================================================

export async function getTrainingExamples(options?: {
  limit?: number
  offset?: number
  filters?: ExportPackFilters
}): Promise<{ examples: TrainingExample[]; total: number }> {
  const supabase = await createClient()
  const limit = options?.limit ?? 50
  const offset = options?.offset ?? 0
  const filters = options?.filters

  let query = supabase
    .from('training_examples')
    .select('*', { count: 'exact' })

  // Apply filters
  if (filters?.states?.length) {
    query = query.in('state', filters.states)
  }
  if (filters?.rack_types?.length) {
    query = query.in('rack_type', filters.rack_types)
  }
  if (filters?.source_types?.length) {
    query = query.in('source_type', filters.source_types)
  }
  if (filters?.score_range) {
    query = query
      .gte('ground_truth_gross', filters.score_range.min)
      .lte('ground_truth_gross', filters.score_range.max)
  }
  if (filters?.health_tiers?.length) {
    query = query.in('health_tier', filters.health_tiers)
  }
  if (filters?.verification_sources?.length) {
    query = query.in('verification_source', filters.verification_sources)
  }
  if (filters?.min_image_count) {
    query = query.gte('image_count', filters.min_image_count)
  }
  if (filters?.require_images) {
    query = query.not('image_urls', 'eq', '{}')
  }
  if (filters?.exclude_ids?.length) {
    query = query.not('id', 'in', `(${filters.exclude_ids.join(',')})`)
  }

  query = query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  const { data, error, count } = await query

  if (error) {
    console.error('Error fetching training examples:', error)
    return { examples: [], total: 0 }
  }

  return { examples: data as TrainingExample[], total: count ?? 0 }
}

export async function getTrainingExampleById(id: string): Promise<TrainingExample | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('training_examples')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    console.error('Error fetching training example:', error)
    return null
  }

  return data as TrainingExample
}

export async function createTrainingExample(
  example: Omit<TrainingExample, 'id' | 'created_at' | 'updated_at'>
): Promise<TrainingExample | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('training_examples')
    .insert(example)
    .select()
    .single()

  if (error) {
    console.error('Error creating training example:', error)
    return null
  }

  return data as TrainingExample
}

// ============================================================================
// EXPORT PACKS
// ============================================================================

export async function getExportPacks(options?: {
  includeArchived?: boolean
}): Promise<ExportPack[]> {
  const supabase = await createClient()
  
  let query = supabase
    .from('export_packs')
    .select('*')
    .order('created_at', { ascending: false })

  if (!options?.includeArchived) {
    query = query.eq('is_archived', false)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching export packs:', error)
    return []
  }

  return data as ExportPack[]
}

export async function getExportPackById(id: string): Promise<ExportPack | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('export_packs')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    console.error('Error fetching export pack:', error)
    return null
  }

  return data as ExportPack
}

export async function createExportPack(
  pack: Omit<ExportPack, 'id' | 'created_at' | 'updated_at' | 'example_count' | 'last_computed_at'>
): Promise<ExportPack | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('export_packs')
    .insert(pack)
    .select()
    .single()

  if (error) {
    console.error('Error creating export pack:', error)
    return null
  }

  return data as ExportPack
}

export async function updateExportPack(
  id: string,
  updates: Partial<ExportPack>
): Promise<ExportPack | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('export_packs')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Error updating export pack:', error)
    return null
  }

  return data as ExportPack
}

export async function archiveExportPack(id: string): Promise<boolean> {
  const result = await updateExportPack(id, { is_archived: true })
  return result !== null
}

// ============================================================================
// EXPORT PACK EXAMPLES (with stratified splitting)
// ============================================================================

function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
}

function assignSplits(
  examples: TrainingExample[],
  config: SplitConfig
): Map<string, SplitAssignment> {
  const assignments = new Map<string, SplitAssignment>()
  const random = seededRandom(config.split_seed)

  // Group by stratification keys
  const groups = new Map<string, TrainingExample[]>()
  
  for (const ex of examples) {
    const keyParts = config.stratify_by.map(field => {
      if (field === 'state') return ex.state || 'unknown'
      if (field === 'rack_type') return ex.rack_type || 'unknown'
      if (field === 'source_type') return ex.source_type || 'unknown'
      return 'unknown'
    })
    const key = keyParts.join('|')
    
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(ex)
  }

  // Assign splits within each group
  for (const [, group] of groups) {
    // Shuffle group
    const shuffled = [...group].sort(() => random() - 0.5)
    
    const trainEnd = Math.floor(shuffled.length * config.train_ratio)
    const valEnd = trainEnd + Math.floor(shuffled.length * config.validation_ratio)
    
    shuffled.forEach((ex, i) => {
      if (i < trainEnd) {
        assignments.set(ex.id, 'train')
      } else if (i < valEnd) {
        assignments.set(ex.id, 'validation')
      } else {
        assignments.set(ex.id, 'test')
      }
    })
  }

  return assignments
}

export async function computeExportPackExamples(
  packId: string
): Promise<{ success: boolean; count: number; error?: string }> {
  const supabase = await createClient()
  
  // Get pack config
  const pack = await getExportPackById(packId)
  if (!pack) {
    return { success: false, count: 0, error: 'Export pack not found' }
  }

  // Fetch matching examples
  const { examples } = await getTrainingExamples({
    limit: 10000, // Max examples per pack
    filters: pack.filters,
  })

  if (examples.length === 0) {
    return { success: false, count: 0, error: 'No matching examples found' }
  }

  // Compute split assignments
  const splitAssignments = assignSplits(examples, pack.split_config)

  // Clear existing examples for this pack
  await supabase
    .from('export_pack_examples')
    .delete()
    .eq('export_pack_id', packId)

  // Insert new examples
  const packExamples: Omit<ExportPackExample, 'id' | 'added_at'>[] = examples.map(ex => ({
    export_pack_id: packId,
    training_example_id: ex.id,
    split_assignment: splitAssignments.get(ex.id) || 'train',
    ground_truth_gross: ex.ground_truth_gross,
    ground_truth_net: ex.ground_truth_net,
    health_score: ex.health_score,
    health_tier: ex.health_tier,
    state: ex.state,
    rack_type: ex.rack_type,
    source_type: ex.source_type,
    segment_ids: [],
  }))

  const { error: insertError } = await supabase
    .from('export_pack_examples')
    .insert(packExamples)

  if (insertError) {
    console.error('Error inserting pack examples:', insertError)
    return { success: false, count: 0, error: insertError.message }
  }

  // Update pack metadata
  await updateExportPack(packId, {
    example_count: examples.length,
    last_computed_at: new Date().toISOString(),
  })

  return { success: true, count: examples.length }
}

export async function getExportPackExamples(
  packId: string,
  split?: SplitAssignment
): Promise<ExportPackExample[]> {
  const supabase = await createClient()
  
  let query = supabase
    .from('export_pack_examples')
    .select('*')
    .eq('export_pack_id', packId)

  if (split) {
    query = query.eq('split_assignment', split)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching pack examples:', error)
    return []
  }

  return data as ExportPackExample[]
}

export async function getExportPackSplitCounts(
  packId: string
): Promise<{ train: number; validation: number; test: number }> {
  const examples = await getExportPackExamples(packId)
  
  return {
    train: examples.filter(e => e.split_assignment === 'train').length,
    validation: examples.filter(e => e.split_assignment === 'validation').length,
    test: examples.filter(e => e.split_assignment === 'test').length,
  }
}

// ============================================================================
// EXPORT RUNS
// ============================================================================

export async function createExportRun(
  packId: string,
  format: 'json' | 'csv' | 'both',
  notes?: string
): Promise<ExportRun | null> {
  const supabase = await createClient()
  
  // Get split counts
  const counts = await getExportPackSplitCounts(packId)
  const total = counts.train + counts.validation + counts.test

  const { data, error } = await supabase
    .from('export_runs')
    .insert({
      export_pack_id: packId,
      format,
      example_count: total,
      train_count: counts.train,
      validation_count: counts.validation,
      test_count: counts.test,
      run_notes: notes,
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating export run:', error)
    return null
  }

  return data as ExportRun
}

export async function getExportRuns(packId: string): Promise<ExportRun[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('export_runs')
    .select('*')
    .eq('export_pack_id', packId)
    .order('exported_at', { ascending: false })

  if (error) {
    console.error('Error fetching export runs:', error)
    return []
  }

  return data as ExportRun[]
}

// ============================================================================
// CANDIDATE MODELS
// ============================================================================

export async function getCandidateModels(options?: {
  status?: CandidateModel['status']
  exportPackId?: string
}): Promise<CandidateModel[]> {
  const supabase = await createClient()
  
  let query = supabase
    .from('candidate_models')
    .select('*')
    .order('created_at', { ascending: false })

  if (options?.status) {
    query = query.eq('status', options.status)
  }
  if (options?.exportPackId) {
    query = query.eq('export_pack_id', options.exportPackId)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching candidate models:', error)
    return []
  }

  return data as CandidateModel[]
}

export async function createCandidateModel(
  model: Omit<CandidateModel, 'id' | 'created_at' | 'updated_at'>
): Promise<CandidateModel | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('candidate_models')
    .insert(model)
    .select()
    .single()

  if (error) {
    console.error('Error creating candidate model:', error)
    return null
  }

  return data as CandidateModel
}

export async function updateCandidateModelStatus(
  id: string,
  status: CandidateModel['status']
): Promise<boolean> {
  const supabase = await createClient()
  
  const { error } = await supabase
    .from('candidate_models')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    console.error('Error updating model status:', error)
    return false
  }

  return true
}

// ============================================================================
// OFFLINE EVALUATIONS
// ============================================================================

export async function getOfflineEvaluations(modelId: string): Promise<OfflineEvaluation[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('offline_evaluations')
    .select('*')
    .eq('candidate_model_id', modelId)
    .order('evaluated_at', { ascending: false })

  if (error) {
    console.error('Error fetching evaluations:', error)
    return []
  }

  return data as OfflineEvaluation[]
}

export async function createOfflineEvaluation(
  evaluation: Omit<OfflineEvaluation, 'id' | 'evaluated_at'>
): Promise<OfflineEvaluation | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('offline_evaluations')
    .insert(evaluation)
    .select()
    .single()

  if (error) {
    console.error('Error creating evaluation:', error)
    return null
  }

  return data as OfflineEvaluation
}

// ============================================================================
// RETRAINING READINESS
// ============================================================================

const MIN_EXAMPLES_PER_STATE = 20
const MIN_EXAMPLES_TOTAL = 500
const TARGET_EXAMPLES_PER_STATE = 50
const TARGET_EXAMPLES_TOTAL = 2000

function computeGapSeverity(current: number, target: number): GapSeverity {
  const ratio = current / target
  if (ratio >= 1) return 'none'
  if (ratio >= 0.7) return 'low'
  if (ratio >= 0.4) return 'medium'
  if (ratio >= 0.15) return 'high'
  return 'critical'
}

function computeReadinessTier(score: number): ReadinessTier {
  if (score >= 80) return 'ready'
  if (score >= 60) return 'nearly_ready'
  if (score >= 35) return 'needs_work'
  return 'insufficient'
}

export async function computeRetrainingReadiness(): Promise<RetrainingReadiness | null> {
  const supabase = await createClient()
  
  // Fetch all training examples
  const { examples } = await getTrainingExamples({ limit: 10000 })
  
  const totalExamples = examples.length
  const highQualityExamples = examples.filter(
    e => e.verification_confidence === 'high' || e.verification_source === 'official_scorer'
  ).length
  const examplesWithImages = examples.filter(e => e.image_urls && e.image_urls.length > 0).length

  // Coverage by state
  const stateCount: Record<string, number> = {}
  for (const ex of examples) {
    const state = ex.state || 'unknown'
    stateCount[state] = (stateCount[state] || 0) + 1
  }

  // Coverage by rack type
  const typicalCount = examples.filter(e => e.rack_type === 'typical').length
  const nonTypicalCount = examples.filter(e => e.rack_type === 'non-typical').length

  // Coverage by source type
  const sourceCount: Record<string, number> = {}
  for (const ex of examples) {
    const source = ex.source_type || 'unknown'
    sourceCount[source] = (sourceCount[source] || 0) + 1
  }

  // Coverage by score band
  const scoreBandCount: Record<string, number> = {
    '100-120': 0,
    '120-140': 0,
    '140-160': 0,
    '160-180': 0,
    '180-200': 0,
    '200+': 0,
  }
  for (const ex of examples) {
    const score = ex.ground_truth_gross
    if (score < 120) scoreBandCount['100-120']++
    else if (score < 140) scoreBandCount['120-140']++
    else if (score < 160) scoreBandCount['140-160']++
    else if (score < 180) scoreBandCount['160-180']++
    else if (score < 200) scoreBandCount['180-200']++
    else scoreBandCount['200+']++
  }

  // Identify data gaps
  const dataGaps: DataGap[] = []
  
  // State gaps
  const topStates = ['TX', 'WI', 'IA', 'IL', 'KS', 'MO', 'OH', 'IN', 'MI', 'MN']
  for (const state of topStates) {
    const count = stateCount[state] || 0
    if (count < TARGET_EXAMPLES_PER_STATE) {
      dataGaps.push({
        category: 'state',
        value: state,
        current_count: count,
        target_count: TARGET_EXAMPLES_PER_STATE,
        severity: computeGapSeverity(count, TARGET_EXAMPLES_PER_STATE),
        priority: count < MIN_EXAMPLES_PER_STATE ? 1 : 2,
        recommendation: `Add ${TARGET_EXAMPLES_PER_STATE - count} more verified examples from ${state}`,
      })
    }
  }

  // Non-typical gap
  if (nonTypicalCount < 100) {
    dataGaps.push({
      category: 'rack_type',
      value: 'non-typical',
      current_count: nonTypicalCount,
      target_count: 100,
      severity: computeGapSeverity(nonTypicalCount, 100),
      priority: nonTypicalCount < 20 ? 1 : 2,
      recommendation: `Add ${100 - nonTypicalCount} more verified non-typical examples`,
    })
  }

  // Score band gaps (high scores are rarer)
  const highScoreCount = (scoreBandCount['180-200'] || 0) + (scoreBandCount['200+'] || 0)
  if (highScoreCount < 50) {
    dataGaps.push({
      category: 'score_band',
      value: '180+',
      current_count: highScoreCount,
      target_count: 50,
      severity: computeGapSeverity(highScoreCount, 50),
      priority: highScoreCount < 10 ? 1 : 2,
      recommendation: `Add ${50 - highScoreCount} more verified examples scoring 180+ inches`,
    })
  }

  // Determine overall gap severity
  const criticalGaps = dataGaps.filter(g => g.severity === 'critical').length
  const highGaps = dataGaps.filter(g => g.severity === 'high').length
  
  let gapSeverity: GapSeverity = 'none'
  if (criticalGaps > 2) gapSeverity = 'critical'
  else if (criticalGaps > 0 || highGaps > 3) gapSeverity = 'high'
  else if (highGaps > 0) gapSeverity = 'medium'
  else if (dataGaps.length > 0) gapSeverity = 'low'

  // Generate recommendations
  const recommendations: string[] = []
  
  if (totalExamples < MIN_EXAMPLES_TOTAL) {
    recommendations.push(`Dataset needs at least ${MIN_EXAMPLES_TOTAL} examples (currently ${totalExamples})`)
  }
  if (highQualityExamples / totalExamples < 0.5) {
    recommendations.push('Less than 50% of examples are high quality - focus on verification')
  }
  if (examplesWithImages / totalExamples < 0.8) {
    recommendations.push('Many examples lack images - prioritize image collection')
  }
  
  // Add top gap recommendations
  const sortedGaps = [...dataGaps].sort((a, b) => a.priority - b.priority)
  for (const gap of sortedGaps.slice(0, 3)) {
    recommendations.push(gap.recommendation)
  }

  // Compute readiness score (0-100)
  let readinessScore = 0
  
  // Total count factor (0-30 points)
  readinessScore += Math.min(30, (totalExamples / TARGET_EXAMPLES_TOTAL) * 30)
  
  // Quality factor (0-20 points)
  readinessScore += (highQualityExamples / Math.max(totalExamples, 1)) * 20
  
  // Image coverage (0-15 points)
  readinessScore += (examplesWithImages / Math.max(totalExamples, 1)) * 15
  
  // State diversity (0-15 points)
  const statesWithMinExamples = Object.values(stateCount).filter(c => c >= MIN_EXAMPLES_PER_STATE).length
  readinessScore += Math.min(15, (statesWithMinExamples / 10) * 15)
  
  // Score band coverage (0-10 points)
  const bandsWithExamples = Object.values(scoreBandCount).filter(c => c >= 10).length
  readinessScore += (bandsWithExamples / 6) * 10
  
  // Gap penalty (0 to -10 points)
  readinessScore -= Math.min(10, criticalGaps * 3 + highGaps * 1)
  
  readinessScore = Math.max(0, Math.min(100, readinessScore))

  const readiness: Omit<RetrainingReadiness, 'id'> = {
    computed_at: new Date().toISOString(),
    total_examples: totalExamples,
    high_quality_examples: highQualityExamples,
    examples_with_images: examplesWithImages,
    coverage_by_state: stateCount,
    typical_count: typicalCount,
    non_typical_count: nonTypicalCount,
    coverage_by_source: sourceCount,
    coverage_by_score_band: scoreBandCount,
    data_gaps: dataGaps,
    gap_severity: gapSeverity,
    recommendations,
    readiness_score: Math.round(readinessScore * 10) / 10,
    readiness_tier: computeReadinessTier(readinessScore),
    notes: null,
  }

  // Save to database
  const { data, error } = await supabase
    .from('retraining_readiness')
    .insert(readiness)
    .select()
    .single()

  if (error) {
    console.error('Error saving readiness:', error)
    return null
  }

  return data as RetrainingReadiness
}

export async function getLatestRetrainingReadiness(): Promise<RetrainingReadiness | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('retraining_readiness')
    .select('*')
    .order('computed_at', { ascending: false })
    .limit(1)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows - compute fresh
      return computeRetrainingReadiness()
    }
    console.error('Error fetching readiness:', error)
    return null
  }

  return data as RetrainingReadiness
}

// ============================================================================
// EXPORT DATA GENERATION
// ============================================================================

export interface ExportedExample {
  id: string
  split: SplitAssignment
  ground_truth: {
    gross: number
    net: number | null
    spread: number | null
    beam_left: number | null
    beam_right: number | null
    mass: number | null
    tine_lengths: Record<string, number> | null
    deductions: number | null
  }
  predictions: {
    gross: number | null
    net: number | null
    spread: number | null
    beam_left: number | null
    beam_right: number | null
    mass: number | null
    confidence: number | null
  }
  context: {
    state: string | null
    rack_type: string | null
    source_type: string | null
    capture_device: string | null
    image_count: number
    angle_types: string[]
    ears_fully_visible: boolean | null
    main_frame_points: number | null
  }
  quality: {
    verification_source: string | null
    verification_confidence: string | null
    health_score: number | null
    health_tier: string | null
  }
  image_urls: string[]
}

export async function generateExportData(
  packId: string
): Promise<{ train: ExportedExample[]; validation: ExportedExample[]; test: ExportedExample[] }> {
  const supabase = await createClient()
  
  // Get pack examples with training example details
  const packExamples = await getExportPackExamples(packId)
  const exampleIds = packExamples.map(pe => pe.training_example_id)
  
  // Fetch full training examples
  const { data: trainingExamples, error } = await supabase
    .from('training_examples')
    .select('*')
    .in('id', exampleIds)

  if (error || !trainingExamples) {
    console.error('Error fetching training examples for export:', error)
    return { train: [], validation: [], test: [] }
  }

  // Map training examples by ID
  const exampleMap = new Map(trainingExamples.map(e => [e.id, e]))
  
  // Build export data
  const result: { train: ExportedExample[]; validation: ExportedExample[]; test: ExportedExample[] } = {
    train: [],
    validation: [],
    test: [],
  }

  for (const pe of packExamples) {
    const te = exampleMap.get(pe.training_example_id)
    if (!te) continue

    const exported: ExportedExample = {
      id: te.id,
      split: pe.split_assignment,
      ground_truth: {
        gross: te.ground_truth_gross,
        net: te.ground_truth_net,
        spread: te.ground_truth_spread,
        beam_left: te.ground_truth_beam_left,
        beam_right: te.ground_truth_beam_right,
        mass: te.ground_truth_mass,
        tine_lengths: te.ground_truth_tine_lengths,
        deductions: te.ground_truth_deductions,
      },
      predictions: {
        gross: te.predicted_gross,
        net: te.predicted_net,
        spread: te.predicted_spread,
        beam_left: te.predicted_beam_left,
        beam_right: te.predicted_beam_right,
        mass: te.predicted_mass,
        confidence: te.predicted_confidence,
      },
      context: {
        state: te.state,
        rack_type: te.rack_type,
        source_type: te.source_type,
        capture_device: te.capture_device,
        image_count: te.image_count,
        angle_types: te.angle_types || [],
        ears_fully_visible: te.ears_fully_visible,
        main_frame_points: te.main_frame_points,
      },
      quality: {
        verification_source: te.verification_source,
        verification_confidence: te.verification_confidence,
        health_score: te.health_score,
        health_tier: te.health_tier,
      },
      image_urls: te.image_urls || [],
    }

    result[pe.split_assignment].push(exported)
  }

  return result
}
