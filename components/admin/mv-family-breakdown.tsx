'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface MVFamilyBreakdownProps {
  families: {
    family: string
    count: number
    measurements: string[]
  }[]
}

export function MVFamilyBreakdown({ families }: MVFamilyBreakdownProps) {
  if (!families || families.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Measurement Families</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No family data available</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Measurement Families</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {families.map((f) => (
          <div key={f.family} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{f.family}</span>
              <Badge variant="secondary">{f.count}</Badge>
            </div>
            <div className="flex flex-wrap gap-1">
              {f.measurements.map((m) => (
                <Badge key={m} variant="outline" className="text-xs">
                  {m}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
