'use client'

import { Bar, BarChart, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import type { ValidationBreakdown } from '@/lib/types'

interface ValidationBreakdownChartProps {
  data: ValidationBreakdown[]
  valueKey: 'mae_gross' | 'mae_net' | 'within_5_percent' | 'within_10_percent'
  labelKey: 'category'
}

export function ValidationBreakdownChart({ data, valueKey, labelKey }: ValidationBreakdownChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-muted-foreground">
        No data available
      </div>
    )
  }

  const chartData = data.map(d => ({
    name: d[labelKey],
    value: d[valueKey] || 0,
    count: d.count
  }))

  // Color based on value (lower is better for MAE, higher is better for percentage)
  const isPercentage = valueKey.includes('percent')
  const getBarColor = (value: number) => {
    if (isPercentage) {
      if (value >= 80) return 'hsl(var(--primary))'
      if (value >= 60) return 'hsl(45, 93%, 47%)' // amber
      return 'hsl(0, 84%, 60%)' // red
    } else {
      if (value <= 5) return 'hsl(var(--primary))'
      if (value <= 10) return 'hsl(45, 93%, 47%)' // amber
      return 'hsl(0, 84%, 60%)' // red
    }
  }

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ left: 60, right: 20 }}>
          <XAxis 
            type="number" 
            tickFormatter={(v) => isPercentage ? `${v}%` : `${v}"`}
            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
          />
          <YAxis 
            type="category" 
            dataKey="name" 
            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
            width={55}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const item = payload[0].payload
              return (
                <div className="bg-popover border border-border rounded-lg p-2 shadow-md">
                  <p className="font-medium">{item.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {isPercentage ? `${item.value.toFixed(1)}%` : `${item.value.toFixed(1)}"`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.count} examples
                  </p>
                </div>
              )
            }}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={getBarColor(entry.value)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
