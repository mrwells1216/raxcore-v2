'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';

export interface MeshPoint {
  x: number;
  y: number;
}

export interface MeshItem {
  id: string;
  points: MeshPoint[];
  confidence: number;
  label?: string;
}

export interface MeshData {
  beams: MeshItem[];
  tines: MeshItem[];
  spreads: MeshItem[];
  burrs: MeshItem[];
}

interface MeshOverlayProps {
  imageUrl: string;
  mesh: MeshData;
  onMeshChange: (newMesh: MeshData) => void;
  readOnly?: boolean;
}

const COLORS = {
  high: '#22c55e',    // green - high confidence
  medium: '#3b82f6',  // blue - medium confidence
  low: '#f59e0b',     // amber - low confidence
  selected: '#ef4444' // red - selected
};

function getColorForConfidence(confidence: number, isSelected: boolean): string {
  if (isSelected) return COLORS.selected;
  if (confidence >= 0.75) return COLORS.high;
  if (confidence >= 0.5) return COLORS.medium;
  return COLORS.low;
}

export function MeshOverlay({
  imageUrl,
  mesh,
  onMeshChange,
  readOnly = false
}: MeshOverlayProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [svgDimensions, setSvgDimensions] = useState({ width: 0, height: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const updateDimensions = () => {
      if (svgRef.current) {
        setSvgDimensions({
          width: svgRef.current.clientWidth,
          height: svgRef.current.clientHeight
        });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  const findItemById = (id: string): { category: keyof MeshData; item: MeshItem } | null => {
    for (const category of ['beams', 'tines', 'spreads', 'burrs'] as const) {
      const item = mesh[category].find(m => m.id === id);
      if (item) return { category, item };
    }
    return null;
  };

  const movePart = (id: string, dx: number, dy: number) => {
    if (readOnly) return;

    const found = findItemById(id);
    if (!found) return;

    const { category, item } = found;
    const newItem = {
      ...item,
      points: item.points.map(p => ({
        x: p.x + dx,
        y: p.y + dy
      }))
    };

    const newMesh = { ...mesh };
    const items = [...newMesh[category]];
    const idx = items.findIndex(m => m.id === id);
    items[idx] = newItem;
    newMesh[category] = items;

    onMeshChange(newMesh);
  };

  const reset = () => {
    if (readOnly) return;
    setSelectedId(null);
  };

  const renderPolyline = (item: MeshItem, isSelected: boolean) => {
    if (item.points.length < 2) return null;

    const points = item.points
      .map(p => `${p.x},${p.y}`)
      .join(' ');

    return (
      <g key={item.id}>
        {/* Main polyline */}
        <polyline
          points={points}
          stroke={getColorForConfidence(item.confidence, isSelected)}
          strokeWidth={isSelected ? 3 : 2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          onClick={() => !readOnly && setSelectedId(item.id)}
          style={{ cursor: readOnly ? 'default' : 'pointer' }}
          opacity={isSelected ? 1 : 0.7}
        />

        {/* Points on selected items */}
        {isSelected && item.points.map((point, idx) => (
          <circle
            key={`${item.id}-point-${idx}`}
            cx={point.x}
            cy={point.y}
            r={4}
            fill={COLORS.selected}
            opacity={0.6}
          />
        ))}
      </g>
    );
  };

  const selectedInfo = selectedId ? findItemById(selectedId) : null;

  return (
    <div className="space-y-4">
      <div className="relative bg-muted rounded-lg overflow-hidden border">
        <img
          ref={imgRef}
          src={imageUrl}
          alt="Rack visualization"
          className="w-full h-auto block"
        />
        <svg
          ref={svgRef}
          viewBox={`0 0 ${svgDimensions.width || 100} ${svgDimensions.height || 100}`}
          className="absolute inset-0 w-full h-full cursor-crosshair"
          preserveAspectRatio="none"
        >
          {/* Render all mesh parts */}
          {mesh.beams.map(b => renderPolyline(b, selectedId === b.id))}
          {mesh.tines.map(t => renderPolyline(t, selectedId === t.id))}
          {mesh.spreads.map(s => renderPolyline(s, selectedId === s.id))}
          {mesh.burrs.map(b => renderPolyline(b, selectedId === b.id))}

          {/* Confidence legend */}
          <g className="pointer-events-none">
            <rect x="10" y="10" width="140" height="85" fill="rgba(0,0,0,0.6)" rx="4" />
            <text x="15" y="28" fill="white" fontSize="12" fontWeight="bold">Confidence</text>
            
            <line x1="15" y1="38" x2="30" y2="38" stroke={COLORS.high} strokeWidth="2" />
            <text x="35" y="42" fill="white" fontSize="11">High (0.75+)</text>
            
            <line x1="15" y1="52" x2="30" y2="52" stroke={COLORS.medium} strokeWidth="2" />
            <text x="35" y="56" fill="white" fontSize="11">Medium (0.5-0.75)</text>
            
            <line x1="15" y1="66" x2="30" y2="66" stroke={COLORS.low} strokeWidth="2" />
            <text x="35" y="70" fill="white" fontSize="11">Low (&lt;0.5)</text>
          </g>
        </svg>
      </div>

      {/* Controls for selected item */}
      {!readOnly && selectedInfo && (
        <Card className="p-4 space-y-4 bg-secondary/30">
          <div>
            <p className="text-sm font-medium mb-2">
              Selected: <span className="text-primary">{selectedInfo.item.label || selectedInfo.item.id}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Confidence: {(selectedInfo.item.confidence * 100).toFixed(0)}%
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Adjust Position</p>
            
            {/* Arrow controls */}
            <div className="flex flex-col gap-1 w-fit">
              {/* Up */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => movePart(selectedId!, 0, -1)}
                className="w-10 h-10 p-0"
                title="Move up"
              >
                <ChevronUp className="h-4 w-4" />
              </Button>

              {/* Left, Center, Right */}
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => movePart(selectedId!, -1, 0)}
                  className="w-10 h-10 p-0"
                  title="Move left"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={reset}
                  className="w-10 h-10 p-0"
                  title="Deselect"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => movePart(selectedId!, 1, 0)}
                  className="w-10 h-10 p-0"
                  title="Move right"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {/* Down */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => movePart(selectedId!, 0, 1)}
                className="w-10 h-10 p-0"
                title="Move down"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>

            <p className="text-xs text-muted-foreground mt-2">
              Use arrow buttons to fine-tune geometry by 1 pixel increments
            </p>
          </div>
        </Card>
      )}

      {!selectedId && !readOnly && (
        <p className="text-sm text-muted-foreground text-center">
          Click on any mesh element to select and adjust its position
        </p>
      )}
    </div>
  );
}
