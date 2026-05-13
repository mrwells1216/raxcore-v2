'use client'

import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'

interface MVView {
  id: string
  image_index: number
  angle_class: string
  view_overall_score: number | null
  is_accepted: boolean
  is_outlier: boolean
  is_primary_view: boolean
}

interface MVEdge {
  id: string
  view_a_id: string
  view_b_id: string
  match_quality: number
  accepted_for_fusion: boolean
}

interface MVViewGraphProps {
  views: MVView[]
  edges: MVEdge[]
}

export function MVViewGraph({ views, edges }: MVViewGraphProps) {
  const graphData = useMemo(() => {
    // Calculate node positions in a circle
    const centerX = 200
    const centerY = 150
    const radius = 100
    
    const nodePositions = views.map((view, index) => {
      const angle = (index / views.length) * 2 * Math.PI - Math.PI / 2
      return {
        view,
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      }
    })
    
    return { nodePositions }
  }, [views])
  
  if (views.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        No views in this set
      </div>
    )
  }
  
  return (
    <div className="space-y-4">
      {/* SVG Graph */}
      <svg viewBox="0 0 400 300" className="w-full h-64 border rounded-lg bg-muted/20">
        {/* Edges */}
        {edges.map(edge => {
          const nodeA = graphData.nodePositions.find(n => n.view.id === edge.view_a_id)
          const nodeB = graphData.nodePositions.find(n => n.view.id === edge.view_b_id)
          
          if (!nodeA || !nodeB) return null
          
          const strokeWidth = Math.max(1, edge.match_quality * 4)
          const opacity = edge.accepted_for_fusion ? 0.8 : 0.3
          const stroke = edge.accepted_for_fusion ? 'hsl(142, 76%, 36%)' : 'hsl(var(--muted-foreground))'
          
          return (
            <line
              key={edge.id}
              x1={nodeA.x}
              y1={nodeA.y}
              x2={nodeB.x}
              y2={nodeB.y}
              stroke={stroke}
              strokeWidth={strokeWidth}
              opacity={opacity}
              strokeDasharray={edge.accepted_for_fusion ? undefined : '4,4'}
            />
          )
        })}
        
        {/* Nodes */}
        {graphData.nodePositions.map(({ view, x, y }) => {
          let fill = 'hsl(var(--primary))'
          if (view.is_outlier) {
            fill = 'hsl(0, 84%, 60%)'
          } else if (!view.is_accepted) {
            fill = 'hsl(var(--muted-foreground))'
          } else if (view.is_primary_view) {
            fill = 'hsl(142, 76%, 36%)'
          }
          
          const nodeSize = 12 + (view.view_overall_score ?? 0.5) * 8
          
          return (
            <g key={view.id}>
              <circle
                cx={x}
                cy={y}
                r={nodeSize}
                fill={fill}
                stroke="hsl(var(--background))"
                strokeWidth={2}
              />
              <text
                x={x}
                y={y + 4}
                textAnchor="middle"
                fill="hsl(var(--primary-foreground))"
                fontSize={10}
                fontWeight="bold"
              >
                {view.image_index}
              </text>
              <text
                x={x}
                y={y + nodeSize + 14}
                textAnchor="middle"
                fill="hsl(var(--foreground))"
                fontSize={9}
                className="capitalize"
              >
                {view.angle_class.replace(/_/g, ' ')}
              </text>
            </g>
          )
        })}
      </svg>
      
      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-primary" />
          <span>Accepted</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-green-600" />
          <span>Primary</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <span>Outlier</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-muted-foreground" />
          <span>Rejected</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-0.5 bg-green-600" />
          <span>Accepted edge</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-0.5 border-t-2 border-dashed border-muted-foreground" />
          <span>Rejected edge</span>
        </div>
      </div>
    </div>
  )
}
