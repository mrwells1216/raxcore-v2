'use client'

import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

interface BreakdownItem {
  label: string
  count: number
  mae_gross: number | null
  mae_net: number | null
  within_10_percent: number
}

interface AccuracyBreakdownTableProps {
  data: BreakdownItem[]
}

export function AccuracyBreakdownTable({ data }: AccuracyBreakdownTableProps) {
  if (!data || data.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No breakdown data available yet
      </div>
    )
  }

  const getMaeColor = (mae: number | null) => {
    if (mae === null) return ''
    if (mae <= 5) return 'text-primary'
    if (mae <= 10) return 'text-amber-600 dark:text-amber-400'
    return 'text-red-600 dark:text-red-400'
  }

  const getPercentBadge = (percent: number) => {
    if (percent >= 80) {
      return <Badge className="bg-primary/10 text-primary">{percent.toFixed(0)}%</Badge>
    }
    if (percent >= 60) {
      return <Badge className="bg-amber-500/10 text-amber-600">{percent.toFixed(0)}%</Badge>
    }
    return <Badge className="bg-red-500/10 text-red-600">{percent.toFixed(0)}%</Badge>
  }

  return (
    <div className="rounded-md border border-border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Count</TableHead>
            <TableHead className="text-right">MAE</TableHead>
            <TableHead className="text-right">Within 10%</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((item, idx) => (
            <TableRow key={idx}>
              <TableCell className="font-medium">{item.label}</TableCell>
              <TableCell className="text-right text-muted-foreground">
                {item.count.toLocaleString()}
              </TableCell>
              <TableCell className={`text-right font-mono ${getMaeColor(item.mae_gross)}`}>
                {item.mae_gross?.toFixed(1) || '-'}"
              </TableCell>
              <TableCell className="text-right">
                {getPercentBadge(item.within_10_percent)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
