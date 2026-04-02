/**
 * Human Review Sheets API
 * 
 * POST: Create a new review sheet for a prediction
 * GET: Get review sheet(s) by prediction_id or buck_id
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  createReviewSheet,
  getReviewSheetByPrediction,
  getReviewSheetsByBuck,
  type CreateReviewSheetInput,
} from '@/lib/review/service'
import type { ScoreSheet } from '@/lib/scoring/score-sheet'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const predictionId = searchParams.get('prediction_id')
  const buckId = searchParams.get('buck_id')
  
  if (!predictionId && !buckId) {
    return NextResponse.json(
      { error: 'Missing prediction_id or buck_id query parameter' },
      { status: 400 }
    )
  }
  
  try {
    if (predictionId) {
      const sheet = await getReviewSheetByPrediction(predictionId)
      return NextResponse.json({ sheet })
    }
    
    if (buckId) {
      const sheets = await getReviewSheetsByBuck(buckId)
      return NextResponse.json({ sheets })
    }
    
    return NextResponse.json({ sheet: null })
  } catch (error) {
    console.error('[review-sheets-api] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch review sheet' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    const {
      buck_id,
      prediction_id,
      ai_score_sheet,
      ai_gross_score,
      ai_net_score,
      ai_confidence,
      rack_type,
      main_frame_points,
    } = body as {
      buck_id?: string
      prediction_id?: string
      ai_score_sheet?: ScoreSheet
      ai_gross_score?: number
      ai_net_score?: number
      ai_confidence?: number
      rack_type?: 'typical' | 'non-typical'
      main_frame_points?: number
    }
    
    // Validate required fields
    if (!buck_id || !prediction_id || !ai_score_sheet) {
      return NextResponse.json(
        { error: 'Missing required fields: buck_id, prediction_id, ai_score_sheet' },
        { status: 400 }
      )
    }
    
    // Check if a review sheet already exists for this prediction
    const existing = await getReviewSheetByPrediction(prediction_id)
    if (existing) {
      return NextResponse.json(
        { 
          error: 'Review sheet already exists for this prediction',
          existing_sheet_id: existing.id,
          sheet: existing,
        },
        { status: 409 }
      )
    }
    
    const input: CreateReviewSheetInput = {
      buck_id,
      prediction_id,
      ai_score_sheet,
      ai_gross_score: ai_gross_score ?? ai_score_sheet.totals.gross.value ?? 0,
      ai_net_score: ai_net_score ?? ai_score_sheet.totals.net.value ?? 0,
      ai_confidence: ai_confidence ?? 50,
      rack_type,
      main_frame_points,
    }
    
    const sheet = await createReviewSheet(input)
    
    if (!sheet) {
      return NextResponse.json(
        { error: 'Failed to create review sheet' },
        { status: 500 }
      )
    }
    
    return NextResponse.json({ sheet }, { status: 201 })
  } catch (error) {
    console.error('[review-sheets-api] POST error:', error)
    return NextResponse.json(
      { error: 'Failed to create review sheet' },
      { status: 500 }
    )
  }
}
