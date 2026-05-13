export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { RebuildCalibrationButton } from '@/components/admin/rebuild-calibration-button'

export const metadata = {
  title: 'Calibration Profiles | Admin',
  description: 'View and manage calibration profiles',
}

export default async function CalibrationProfilesPage() {
  const supabase = await createClient()

  const { data: profiles } = await supabase
    .from('calibration_profiles')
    .select('*')
    .order('profile_type', { ascending: true })
    .order('sample_count', { ascending: false })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Calibration Profiles</h1>
        <p className="text-sm text-muted-foreground">
          Bias correction profiles derived from reviewed training samples
        </p>
      </div>

      <RebuildCalibrationButton />

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left">
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2">Rack Type</th>
              <th className="px-3 py-2">Samples</th>
              <th className="px-3 py-2">Gross Bias</th>
              <th className="px-3 py-2">Net Bias</th>
              <th className="px-3 py-2">Gross MAE</th>
              <th className="px-3 py-2">Net MAE</th>
              <th className="px-3 py-2">Confidence Mult.</th>
              <th className="px-3 py-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {profiles?.map((profile) => (
              <tr key={profile.id} className="border-b">
                <td className="px-3 py-2">{profile.profile_type}</td>
                <td className="px-3 py-2">{profile.state ?? '-'}</td>
                <td className="px-3 py-2">{profile.rack_type ?? '-'}</td>
                <td className="px-3 py-2">{profile.sample_count}</td>
                <td className="px-3 py-2 tabular-nums">
                  {Number(profile.gross_bias).toFixed(3)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {Number(profile.net_bias).toFixed(3)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {Number(profile.gross_mae).toFixed(3)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {Number(profile.net_mae).toFixed(3)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {Number(profile.confidence_multiplier).toFixed(3)}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {profile.updated_at
                    ? new Date(profile.updated_at).toLocaleDateString()
                    : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!profiles?.length && (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            No calibration profiles yet. Click "Rebuild calibration profiles" to generate them from training data.
          </div>
        )}
      </div>
    </div>
  )
}
