export const dynamic = 'force-dynamic'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { TrainingImportForm } from '@/components/admin/training-import-form'

export default async function AdminTrainingImportPage() {
  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Import Training Data</h1>
        <p className="text-muted-foreground">
          Upload official score sheets and images to improve model accuracy through human-in-the-loop training.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Official Score Import</CardTitle>
          <CardDescription>
            Import Boone & Crockett or Pope & Young official score sheets with associated images for model training.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TrainingImportForm />
        </CardContent>
      </Card>
    </div>
  )
}
