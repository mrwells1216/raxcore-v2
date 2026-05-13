import { NextRequest, NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// Schema mirrors REQUIRED_BC_FIELDS + gross/net. All fields optional so the
// model can return only what it confidently reads off the sheet.
const ocrSchema = z.object({
  main_beam_left: z.number().nullable(),
  main_beam_right: z.number().nullable(),
  g1_left: z.number().nullable(),
  g1_right: z.number().nullable(),
  g2_left: z.number().nullable(),
  g2_right: z.number().nullable(),
  g3_left: z.number().nullable(),
  g3_right: z.number().nullable(),
  g4_left: z.number().nullable(),
  g4_right: z.number().nullable(),
  h1_left: z.number().nullable(),
  h1_right: z.number().nullable(),
  h2_left: z.number().nullable(),
  h2_right: z.number().nullable(),
  h3_left: z.number().nullable(),
  h3_right: z.number().nullable(),
  h4_left: z.number().nullable(),
  h4_right: z.number().nullable(),
  inside_spread: z.number().nullable(),
  gross_score: z.number().nullable(),
  net_score: z.number().nullable(),
  scoring_system: z.enum(['BC', 'PY', 'unknown']),
  confidence: z.number().min(0).max(1),
  notes: z.string(),
})

// POST /api/admin/training-import/ocr — transcribe official score sheet via OpenAI vision
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()
    if (!profile?.is_admin) {
      return NextResponse.json({ message: 'Admin only' }, { status: 403 })
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ message: 'OCR unavailable: OPENAI_API_KEY not configured' }, { status: 503 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ message: 'No file provided' }, { status: 400 })
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ message: 'File too large (max 10 MB)' }, { status: 413 })
    }

    const buf = Buffer.from(await file.arrayBuffer())

    const response = await generateObject({
      model: openai('gpt-4o'),
      schema: ocrSchema,
      system: `You are an OCR transcription assistant for official Boone & Crockett (B&C) and Pope & Young (P&Y) deer-antler score sheets.

Read measurement values exactly as written on the sheet. Each field is a length in inches. Return null for any field you cannot read with high confidence — do NOT guess.

Field meanings:
- main_beam_left/right: length of each main beam
- g1_left/right through g4_left/right: tine lengths (G1 = brow tine)
- h1_left/right through h4_left/right: circumference measurements (H1 = base, smallest near burr)
- inside_spread: greatest spread between main beams
- gross_score: total score before deductions
- net_score: official score after deductions
- scoring_system: 'BC' for Boone & Crockett, 'PY' for Pope & Young, 'unknown' otherwise
- confidence: your overall confidence the transcription is correct (0-1)
- notes: anything unusual (smudged values, multiple amendments, columns appear swapped, etc.)`,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Transcribe every measurement value visible on this official deer score sheet. Return null for any field not clearly readable.',
            },
            {
              type: 'image',
              image: buf,
            },
          ],
        },
      ],
    })

    return NextResponse.json({
      success: true,
      data: response.object,
    })
  } catch (error) {
    console.error('OCR error:', error)
    return NextResponse.json(
      {
        message: 'OCR transcription failed',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
