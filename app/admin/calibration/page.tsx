export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Calibration Profiles | RAXcore Admin',
  description: 'View and rebuild calibration profiles derived from reviewed training samples',
}

export default async function CalibrationAdminPage() {
  const supabase = await createClient()

  const { data: profiles, error } = await supabase
    .from('calibration_profiles')
    .select('*')
    .order('profile_type', { ascending: true })
    .order('sample_count', { ascending: false })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Calibration Profiles</h1>
        <p className="text-muted-foreground mt-1">
          Bias correction profiles derived from reviewed training samples
        </p>
      </div>

      <form action="/api/calibration/rebuild" method="post">
        <button
          type="submit"
          className="rounded-md border px-3 py-2 text-sm"
        >
          Rebuild calibration profiles
        </button>
      </form>

      <div className="flex flex-wrap gap-3">
        <a
          href="/api/training/export?format=json"
          className="rounded-md border px-3 py-2 text-sm"
        >
          Export official training truth (JSON)
        </a>

        <a
          href="/api/training/export?format=csv"
          className="rounded-md border px-3 py-2 text-sm"
        >
          Export official training truth (CSV)
        </a>

        <a
          href="/admin/training-analytics"
          className="rounded-md border px-3 py-2 text-sm"
        >
          View training analytics
        </a>
      </div>

      <p className="text-xs text-muted-foreground">
        Only official reviewed samples are included in exports.
      </p>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Failed to load calibration profiles
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th className="px-3 py-2">Profile Key</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2">Rack Type</th>
                <th className="px-3 py-2">Samples</th>
                <th className="px-3 py-2">Gross Bias</th>
                <th className="px-3 py-2">Net Bias</th>
                <th className="px-3 py-2">Gross MAE</th>
                <th className="px-3 py-2">Net MAE</th>
                <th className="px-3 py-2">Confidence Multiplier</th>
                <th className="px-3 py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {(profiles ?? []).map((profile: any) => (
                <tr key={profile.id} className="border-b">
                  <td className="px-3 py-2">{profile.profile_key}</td>
                  <td className="px-3 py-2">{profile.profile_type}</td>
                  <td className="px-3 py-2">{profile.state ?? '-'}</td>
                  <td className="px-3 py-2">{profile.rack_type ?? '-'}</td>
                  <td className="px-3 py-2">{profile.sample_count}</td>
                  <td className="px-3 py-2">{profile.gross_bias}</td>
                  <td className="px-3 py-2">{profile.net_bias}</td>
                  <td className="px-3 py-2">{profile.gross_mae}</td>
                  <td className="px-3 py-2">{profile.net_mae}</td>
                  <td className="px-3 py-2">{profile.confidence_multiplier}</td>
                  <td className="px-3 py-2">
                    {profile.updated_at
                      ? new Date(profile.updated_at).toLocaleString()
                      : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
