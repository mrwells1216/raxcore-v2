import { Suspense } from 'react'
import { CalibrationDashboard } from '@/components/admin/calibration-dashboard'
import { Loader2 } from 'lucide-react'

export const metadata = {
  title: 'Calibration Controls | xRack Admin',
  description: 'Manage scoring calibration profiles and model versions',
}

export default function CalibrationPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Calibration Controls</h1>
        <p className="text-muted-foreground mt-1">
          Tune scoring behavior, compare calibrations, and manage model versions safely.
        </p>
      </div>

      <Suspense fallback={
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }>
        <CalibrationDashboard />
      </Suspense>
    </div>
  )
}
