import { createClient } from '@/lib/supabase/server'

export async function getActiveCalibrationProfile() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('calibration_profiles')
    .select('*')
    .eq('profile_key', 'global_default')
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    console.warn('[calibration] failed to load active profile', error)
    return null
  }

  return data ?? null
}
