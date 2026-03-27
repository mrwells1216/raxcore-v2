'use client'

import { Line, LineChart, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import type { TrendPoint } from '@/lib/types'

interface AccuracyTrendChartProps {
  data: TrendPoint[]
}

export function AccuracyTrendChart({ data }: AccuracyTrendChartProps) {
  if (!data || data.length === 0 || data.every(d => d.count === 0)) {
    return (
      <div className="h-[250px] flex items-center justify-center text-muted-foreground">
        No trend data available yet
      </div>
    )
  }

  // Filter to only days with data
  const chartData = data.map(d => ({
    date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    mae: d.mae,
    count: d.count
  }))

  return (
    <div className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ left: 0, right: 10, top: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis 
            dataKey="date" 
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis 
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickFormatter={(v) => `${v}"`}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const item = payload[0].payload
              return (
                <div className="bg-popover border border-border rounded-lg p-3 shadow-md">
                  <p className="font-medium">{item.date}</p>
                  <p className="text-sm">MAE: {item.mae.toFixed(1)}"</p>
                  <p className="text-xs text-muted-foreground">
                    {item.count} predictions
                  </p>
                </div>
              )
            }}
          />
          <Line 
            type="monotone" 
            dataKey="mae" 
            stroke="hsl(var(--primary))" 
            strokeWidth={2}
            dot={{ fill: 'hsl(var(--primary))', strokeWidth: 0, r: 3 }}
            activeDot={{ r: 5, fill: 'hsl(var(--primary))' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
