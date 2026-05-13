'use client'

import { Bar, BarChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer, Legend, Cell } from 'recharts'
import { 
  ChartContainer, 
  ChartTooltip, 
  ChartTooltipContent,
  type ChartConfig 
} from '@/components/ui/chart'
import type { MeasurementCategory } from '@/lib/types'

interface MeasurementAccuracyData {
  category: MeasurementCategory
  label: string
  maeBefore: number | null
  maeAfter: number | null
  improvement: number | null
}

interface MeasurementAccuracyChartProps {
  data: MeasurementAccuracyData[]
  showImprovement?: boolean
}

const chartConfig = {
  maeBefore: {
    label: 'MAE Before',
    color: 'hsl(var(--chart-1))',
  },
  maeAfter: {
    label: 'MAE After',
    color: 'hsl(var(--chart-2))',
  },
  improvement: {
    label: 'Improvement',
    color: 'hsl(var(--chart-3))',
  },
} satisfies ChartConfig

const categoryLabels: Record<MeasurementCategory, string> = {
  spread: 'Spread',
  beam: 'Beams',
  tine: 'Tines',
  mass: 'Mass',
  deduction: 'Deductions',
}

export function MeasurementAccuracyChart({ data, showImprovement = false }: MeasurementAccuracyChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
        No measurement-level data available
      </div>
    )
  }

  const chartData = data.map(d => ({
    category: categoryLabels[d.category] || d.category,
    maeBefore: d.maeBefore ?? 0,
    maeAfter: d.maeAfter ?? 0,
    improvement: d.improvement ?? 0,
  }))

  if (showImprovement) {
    return (
      <ChartContainer config={chartConfig} className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
            <XAxis 
              type="number" 
              tickFormatter={(value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}"`}
              domain={['dataMin - 0.5', 'dataMax + 0.5']}
            />
            <YAxis type="category" dataKey="category" width={70} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="improvement" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={entry.improvement >= 0 ? 'hsl(var(--chart-2))' : 'hsl(var(--destructive))'} 
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartContainer>
    )
  }

  return (
    <ChartContainer config={chartConfig} className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="category" />
          <YAxis tickFormatter={(value) => `${value.toFixed(1)}"`} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Legend />
          <Bar 
            dataKey="maeBefore" 
            name="Before Correction" 
            fill="hsl(var(--chart-1))" 
            radius={[4, 4, 0, 0]} 
          />
          <Bar 
            dataKey="maeAfter" 
            name="After Correction" 
            fill="hsl(var(--chart-2))" 
            radius={[4, 4, 0, 0]} 
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  )
}

interface CategoryStatusData {
  category: MeasurementCategory
  status: 'improved' | 'worsened' | 'unchanged'
  changeAmount: number
}

interface MeasurementCategoryStatusProps {
  data: CategoryStatusData[]
}

export function MeasurementCategoryStatus({ data }: MeasurementCategoryStatusProps) {
  if (!data || data.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No category status data
      </div>
    )
  }

  const getStatusColor = (status: CategoryStatusData['status']) => {
    switch (status) {
      case 'improved':
        return 'bg-primary/10 text-primary border-primary/20'
      case 'worsened':
        return 'bg-destructive/10 text-destructive border-destructive/20'
      default:
        return 'bg-muted text-muted-foreground border-border'
    }
  }

  const getStatusLabel = (status: CategoryStatusData['status']) => {
    switch (status) {
      case 'improved':
        return 'Improved'
      case 'worsened':
        return 'Needs Work'
      default:
        return 'No Change'
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {data.map((item) => (
        <div
          key={item.category}
          className={`px-3 py-1.5 rounded-md border text-xs font-medium ${getStatusColor(item.status)}`}
        >
          <span className="font-semibold">{categoryLabels[item.category]}</span>
          <span className="ml-1.5 opacity-75">
            {item.status === 'unchanged' 
              ? getStatusLabel(item.status)
              : `${item.changeAmount > 0 ? '+' : ''}${item.changeAmount.toFixed(1)}"`
            }
          </span>
        </div>
      ))}
    </div>
  )
}
