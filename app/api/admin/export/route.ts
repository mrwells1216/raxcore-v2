import { NextResponse } from 'next/server'
import { listTrainingExamples } from '@/lib/storage/service'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const format = searchParams.get('format') || 'json'
    const verifiedOnly = searchParams.get('verified') === 'true'
    
    const { data: trainingExamples } = await listTrainingExamples({
      verifiedOnly,
      limit: 1000 // Get up to 1000 records for export
    })

    // Transform data for export
    const exportData = trainingExamples.map(example => ({
      id: example.id,
      buck_id: example.buck_id,
      image_urls: example.image_urls,
      ground_truth_score: example.ground_truth_score,
      predicted_score: example.predicted_score,
      error_amount: example.error_amount,
      main_beam_left: example.main_beam_left,
      main_beam_right: example.main_beam_right,
      inside_spread: example.inside_spread,
      points_left: example.points_left,
      points_right: example.points_right,
      tine_measurements: example.tine_measurements,
      circumference_measurements: example.circumference_measurements,
      verified_for_training: example.verified_for_training,
      verified_at: example.verified_at,
      verified_by: example.verified_by,
      quality_score: example.quality_score,
      source: example.source,
      notes: example.notes,
      created_at: example.created_at,
    }))

    if (format === 'csv') {
      if (exportData.length === 0) {
        return new Response('No data to export', { status: 200 })
      }

      const headers = [
        'id', 'buck_id', 'ground_truth_score', 'predicted_score', 'error_amount',
        'main_beam_left', 'main_beam_right', 'inside_spread', 'points_left', 'points_right',
        'verified_for_training', 'verified_at', 'quality_score', 'source', 'created_at'
      ]
      
      const csvRows = [
        headers.join(','),
        ...exportData.map((row) =>
          headers
            .map((h) => {
              const val = row[h as keyof typeof row]
              if (val === null || val === undefined) return ''
              if (typeof val === 'object') return `"${JSON.stringify(val).replace(/"/g, '""')}"`
              if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
                return `"${val.replace(/"/g, '""')}"`
              }
              return val
            })
            .join(','),
        ),
      ]

      return new Response(csvRows.join('\n'), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="xrack-training-data-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      })
    }

    return NextResponse.json({ 
      count: exportData.length, 
      exported_at: new Date().toISOString(), 
      verified_only: verifiedOnly, 
      data: exportData 
    })
  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json({ error: 'Failed to export training data' }, { status: 500 })
  }
}
