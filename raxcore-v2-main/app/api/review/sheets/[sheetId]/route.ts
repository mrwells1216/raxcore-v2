/**
 * Individual Human Review Sheet API
 * 
 * GET: Get a specific review sheet by ID
 * PATCH: Update a review sheet
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getReviewSheetById,
  updateReviewSheet,
  type UpdateReviewSheetInput,
} from '@/lib/review/service'

interface RouteParams {
  params: Promise<{ sheetId: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { sheetId } = await params
  
  if (!sheetId) {
    return NextResponse.json(
      { error: 'Missing sheetId parameter' },
      { status: 400 }
    )
  }
  
  try {
    const sheet = await getReviewSheetById(sheetId)
    
    if (!sheet) {
      return NextResponse.json(
        { error: 'Review sheet not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json({ sheet })
  } catch (error) {
    console.error('[review-sheet-api] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch review sheet' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { sheetId } = await params
  
  if (!sheetId) {
    return NextResponse.json(
      { error: 'Missing sheetId parameter' },
      { status: 400 }
    )
  }
  
  try {
    const body = await request.json() as UpdateReviewSheetInput
    
    // Verify the sheet exists
    const existing = await getReviewSheetById(sheetId)
    if (!existing) {
      return NextResponse.json(
        { error: 'Review sheet not found' },
        { status: 404 }
      )
    }
    
    const sheet = await updateReviewSheet(sheetId, body)
    
    if (!sheet) {
      return NextResponse.json(
        { error: 'Failed to update review sheet' },
        { status: 500 }
      )
    }
    
    return NextResponse.json({ sheet })
  } catch (error) {
    console.error('[review-sheet-api] PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to update review sheet' },
      { status: 500 }
    )
  }
}
