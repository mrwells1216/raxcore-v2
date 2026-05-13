import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildOfficialTrainingExportRow } from '@/lib/training/export-official-samples'

export async function GET(req: Request) {
  const supabase = await createClient()
  const { searchParams } = new URL(req.url)

  const format = searchParams.get('format') ?? 'json'

  const { data, error } = await supabase
    .from('training_samples')
    .select('*')
    .eq('is_official', true)
    .order('reviewed_at', { ascending: false })

  if (error) {
    console.error('[training-export] failed loading official training samples', error)
    return NextResponse.json(
      { error: 'Failed loading official training samples' },
      { status: 500 }
    )
  }

  const rows = (data ?? []).map(buildOfficialTrainingExportRow)

  console.log('[training-export] exporting official samples', {
    count: rows.length,
    format,
  })

  if (format === 'json') {
    return NextResponse.json({
      ok: true,
      count: rows.length,
      rows,
    })
  }

  if (format === 'csv') {
    const headers = [
      'training_sample_id',
      'buck_id',
      'prediction_id',
      'reviewed_score_sheet_id',
      'state',
      'rack_type',
      'source_type',
      'image_count',
      'ai_gross_score',
      'ai_net_score',
      'reviewed_gross_score',
      'reviewed_net_score',
      'gross_delta',
      'net_delta',
      'review_completeness',
      'is_official',
      'reviewed_by',
      'reviewed_at',
      'calibration_applied',
      'calibration_profile_type',
      'calibration_sample_count',
    ]

    const csvRows = [
      headers.join(','),
      ...rows.map((row) =>
        [
          row.training_sample_id,
          row.buck_id ?? '',
          row.prediction_id ?? '',
          row.reviewed_score_sheet_id ?? '',
          row.state ?? '',
          row.rack_type ?? '',
          row.source_type ?? '',
          row.image_count ?? '',
          row.ai_gross_score ?? '',
          row.ai_net_score ?? '',
          row.reviewed_gross_score ?? '',
          row.reviewed_net_score ?? '',
          row.gross_delta ?? '',
          row.net_delta ?? '',
          row.review_completeness ?? 0,
          row.is_official ? 'true' : 'false',
          row.reviewed_by ?? '',
          row.reviewed_at ?? '',
          row.calibration_applied ? 'true' : 'false',
          row.calibration_profile_type ?? '',
          row.calibration_sample_count ?? '',
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(',')
      ),
    ]

    return new NextResponse(csvRows.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="official-training-samples.csv"',
      },
    })
  }

  return NextResponse.json(
    { error: 'Unsupported format. Use ?format=json or ?format=csv' },
    { status: 400 }
  )
}
