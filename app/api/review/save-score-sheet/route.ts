import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ScoreSheetPayload } from '@/lib/rules-engine/types'

interface SaveScoreSheetInput {
  predictionId: string
  buckId: string
  reviewedSheet: ScoreSheetPayload
  aiSheet: ScoreSheetPayload
  rawAiResponse?: unknown
  notes?: string
  isTrainingTruth?: boolean
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as SaveScoreSheetInput
    const db = await createClient()

    const {
      predictionId,
      buckId,
      reviewedSheet,
      aiSheet,
      rawAiResponse,
      notes,
      isTrainingTruth = true,
    } = body

    // Validate required fields
    if (!predictionId || !buckId || !reviewedSheet) {
      return NextResponse.json(
        { error: 'Missing required fields: predictionId, buckId, reviewedSheet' },
        { status: 400 }
      )
    }

    // Check if a reviewed sheet already exists for this prediction
    const { data: existing } = await db
      .from('reviewed_score_sheets')
      .select('id')
      .eq('prediction_id', predictionId)
      .maybeSingle()

    if (existing) {
      // Update existing
      const { data, error } = await db
        .from('reviewed_score_sheets')
        .update({
          sheet_json: reviewedSheet,
          ai_sheet_json: aiSheet,
          raw_ai_response: rawAiResponse ?? null,
          notes: notes ?? null,
          is_training_truth: isTrainingTruth,
          scoring_system: reviewedSheet.scoringSystem ?? 'boone_and_crockett_typical',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single()

      if (error) {
        console.error('[save-score-sheet] Update error:', error)
        return NextResponse.json(
          { error: 'Failed to update reviewed score sheet', details: error.message },
          { status: 500 }
        )
      }

      return NextResponse.json({ ok: true, reviewedScoreSheet: data, updated: true })
    }

    // Insert new
    const { data, error } = await db
      .from('reviewed_score_sheets')
      .insert({
        prediction_id: predictionId,
        buck_id: buckId,
        source: 'reviewed',
        scoring_system: reviewedSheet.scoringSystem ?? 'boone_and_crockett_typical',
        sheet_json: reviewedSheet,
        ai_sheet_json: aiSheet,
        raw_ai_response: rawAiResponse ?? null,
        notes: notes ?? null,
        is_training_truth: isTrainingTruth,
      })
      .select()
      .single()

    if (error) {
      console.error('[save-score-sheet] Insert error:', error)
      return NextResponse.json(
        { error: 'Failed to save reviewed score sheet', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, reviewedScoreSheet: data, updated: false })
  } catch (err) {
    console.error('[save-score-sheet] Unexpected error:', err)
    return NextResponse.json(
      { error: 'Unexpected error saving score sheet' },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const predictionId = searchParams.get('predictionId')

    if (!predictionId) {
      return NextResponse.json(
        { error: 'Missing predictionId query parameter' },
        { status: 400 }
      )
    }

    const db = await createClient()

    const { data, error } = await db
      .from('reviewed_score_sheets')
      .select('*')
      .eq('prediction_id', predictionId)
      .maybeSingle()

    if (error) {
      console.error('[save-score-sheet] GET error:', error)
      return NextResponse.json(
        { error: 'Failed to fetch reviewed score sheet', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ reviewedScoreSheet: data })
  } catch (err) {
    console.error('[save-score-sheet] Unexpected GET error:', err)
    return NextResponse.json(
      { error: 'Unexpected error fetching score sheet' },
      { status: 500 }
    )
  }
}
