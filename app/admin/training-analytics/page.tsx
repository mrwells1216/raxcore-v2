export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { buildTrainingAnalytics } from '@/lib/training/analytics'

export const metadata = {
  title: 'Training Analytics | RAXcore Admin',
  description: 'Official training truth analytics and model error summary',
}

export default async function TrainingAnalyticsPage() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('training_samples')
    .select('*')
    .eq('is_official', true)
    .order('reviewed_at', { ascending: false })

  const analytics = buildTrainingAnalytics(data ?? [])

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Training Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Official reviewed truth only
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Failed to load training analytics
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard label="Official samples" value={analytics.total_official_samples} />
            <MetricCard label="Calibrated samples" value={analytics.calibrated_sample_count} />
            <MetricCard label="Avg gross abs error" value={analytics.avg_gross_absolute_error} />
            <MetricCard label="Avg net abs error" value={analytics.avg_net_absolute_error} />
          </div>

          <SectionTable
            title="Fields with highest average error"
            headers={['Field', 'Samples', 'Mean signed error', 'Mean absolute error']}
            rows={analytics.field_error_summary.slice(0, 20).map((row) => [
              row.field,
              row.sample_count,
              row.mean_signed_error,
              row.mean_absolute_error,
            ])}
          />

          <SectionTable
            title="Error by state"
            headers={['State', 'Samples', 'Mean signed error', 'Mean absolute error']}
            rows={analytics.by_state.map((row) => [
              row.state,
              row.sample_count,
              row.mean_signed_error,
              row.mean_absolute_error,
            ])}
          />

          <SectionTable
            title="Error by rack type"
            headers={['Rack type', 'Samples', 'Mean signed error', 'Mean absolute error']}
            rows={analytics.by_rack_type.map((row) => [
              row.rack_type,
              row.sample_count,
              row.mean_signed_error,
              row.mean_absolute_error,
            ])}
          />

          <SectionTable
            title="Error by image count"
            headers={['Image count', 'Samples', 'Mean signed error', 'Mean absolute error']}
            rows={analytics.by_image_count.map((row) => [
              row.image_count,
              row.sample_count,
              row.mean_signed_error,
              row.mean_absolute_error,
            ])}
          />

          <SectionTable
            title="Biggest gross misses"
            headers={['Buck', 'State', 'Rack type', 'AI gross', 'Reviewed gross', 'Delta']}
            rows={analytics.biggest_gross_misses.map((row) => [
              row.buck_id ?? '-',
              row.state ?? '-',
              row.rack_type ?? '-',
              row.ai_gross ?? '-',
              row.reviewed_gross ?? '-',
              row.gross_delta ?? '-',
            ])}
          />
        </>
      )}
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </div>
  )
}

function SectionTable({
  title,
  headers,
  rows,
}: {
  title: string
  headers: string[]
  rows: any[][]
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left">
              {headers.map((header) => (
                <th key={header} className="px-3 py-2">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-3 py-2">
                      {String(cell)}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={headers.length}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  No data
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
