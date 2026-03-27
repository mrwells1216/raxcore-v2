'use client'

import { Bar, BarChart, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'
import type { ErrorDistribution } from '@/lib/types'

interface ErrorDistributionChartProps {
  data: ErrorDistribution[]
}

export function ErrorDistributionChart({ data }: ErrorDistributionChartProps) {
  if (!data || data.length === 0 || data.every(d => d.count === 0)) {
    return (
      <div className="h-[250px] flex items-center justify-center text-muted-foreground">
        No distribution data available yet
      </div>
    )
  }

  const chartData = data.map(d => ({
    label: d.bucket_label,
    count: d.count,
    percent: d.percent,
    isNegative: d.bucket_max <= 0
  }))

  const getBarColor = (isNegative: boolean, label: string) => {
    // Center buckets (near 0) are green/primary
    if (label.includes('0 to 5') || label.includes('-5 to 0')) {
      return 'hsl(var(--primary))'
    }
    if (label.includes('5 to 10') || label.includes('-10 to -5')) {
      return 'hsl(45, 93%, 47%)' // amber
    }
    // Negative (under-predicted) vs positive (over-predicted)
    return isNegative ? 'hsl(220, 90%, 56%)' : 'hsl(0, 84%, 60%)' // blue vs red
  }

  return (
    <div className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ left: 0, right: 10, top: 10, bottom: 0 }}>
          <XAxis 
            dataKey="label" 
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            interval={0}
            angle={-45}
            textAnchor="end"
            height={60}
          />
          <YAxis 
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickFormatter={(v) => `${v}`}
            tickLine={false}
            axisLine={false}
            width={35}
          />
          <ReferenceLine x="0 to 5\"" stroke="hsl(var(--border))" strokeDasharray="3 3" />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const item = payload[0].payload
              return (
                <div className="bg-popover border border-border rounded-lg p-3 shadow-md">
                  <p className="font-medium">{item.label}</p>
                  <p className="text-sm">{item.count} predictions</p>
                  <p className="text-xs text-muted-foreground">
                    {item.percent.toFixed(1)}% of total
                  </p>
                </div>
              )
            }}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={getBarColor(entry.isNegative, entry.label)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
