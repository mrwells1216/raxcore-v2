'use client'

import { Bar, BarChart, XAxis, YAxis, ResponsiveContainer, Cell } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'

interface QualityTiers {
  excellent: number
  good: number
  fair: number
  poor: number
  fallback: number
}

interface MVQualityChartProps {
  qualityTiers: QualityTiers
}

const chartConfig = {
  excellent: { label: 'Excellent', color: 'hsl(142, 76%, 36%)' },
  good: { label: 'Good', color: 'hsl(142, 71%, 45%)' },
  fair: { label: 'Fair', color: 'hsl(48, 96%, 53%)' },
  poor: { label: 'Poor', color: 'hsl(24, 95%, 53%)' },
  fallback: { label: 'Fallback', color: 'hsl(0, 84%, 60%)' },
}

export function MVQualityChart({ qualityTiers }: MVQualityChartProps) {
  const data = [
    { name: 'Excellent', value: qualityTiers.excellent, fill: chartConfig.excellent.color },
    { name: 'Good', value: qualityTiers.good, fill: chartConfig.good.color },
    { name: 'Fair', value: qualityTiers.fair, fill: chartConfig.fair.color },
    { name: 'Poor', value: qualityTiers.poor, fill: chartConfig.poor.color },
    { name: 'Fallback', value: qualityTiers.fallback, fill: chartConfig.fallback.color },
  ]

  const total = Object.values(qualityTiers).reduce((a, b) => a + b, 0)

  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        No multi-view sets yet
      </div>
    )
  }

  return (
    <ChartContainer config={chartConfig} className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 30 }}>
          <XAxis type="number" hide />
          <YAxis 
            type="category" 
            dataKey="name" 
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={70}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, name) => [
                  `${value} (${total > 0 ? ((Number(value) / total) * 100).toFixed(1) : 0}%)`,
                  name,
                ]}
              />
            }
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  )
}
