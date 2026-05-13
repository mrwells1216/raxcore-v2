import { NextRequest, NextResponse } from 'next/server'
import { exportBulkRunData, formatExportAsCSV } from '@/lib/validation/bulk-service'

// GET /api/admin/bulk-validation/runs/[id]/export - Export bulk validation run data
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const format = searchParams.get('format') || 'json'

    const exportData = await exportBulkRunData(id)

    if (!exportData) {
      return NextResponse.json(
        { success: false, error: 'Bulk validation run not found' },
        { status: 404 }
      )
    }

    if (format === 'csv') {
      const csv = formatExportAsCSV(exportData)
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="bulk-validation-${id}.csv"`,
        },
      })
    }

    // Default to JSON
    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="bulk-validation-${id}.json"`,
      },
    })
  } catch (error) {
    console.error('Error exporting bulk validation run:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to export bulk validation run' },
      { status: 500 }
    )
  }
}
