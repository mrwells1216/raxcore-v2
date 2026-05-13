'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

interface MVEdge {
  from_view: string
  to_view: string
  weight: number
  confidence: number
}

interface MVEdgesTableProps {
  edges: MVEdge[]
}

export function MVEdgesTable({ edges }: MVEdgesTableProps) {
  if (!edges || edges.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">View Edges</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No edge data available</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">View Edges</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead className="text-right">Weight</TableHead>
              <TableHead className="text-right">Confidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {edges.map((edge, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Badge variant="outline">{edge.from_view}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{edge.to_view}</Badge>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {edge.weight.toFixed(2)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {(edge.confidence * 100).toFixed(0)}%
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
