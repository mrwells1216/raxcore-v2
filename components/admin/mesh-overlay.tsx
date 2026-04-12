'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import type { MeasurementGraph, Vec2, Beam, Tine, Spread, CircumferencePoint } from '@/lib/types';

// Re-export for backward compatibility
export type { MeasurementGraph, Vec2, Beam, Tine, Spread, CircumferencePoint };

interface MeshOverlayProps {
  imageUrl: string;
  graph: MeasurementGraph;
  onGraphChange: (newGraph: MeasurementGraph) => void;
  readOnly?: boolean;
}

type SelectableItem = 
  | { type: 'beam'; side: 'left' | 'right'; item: Beam }
  | { type: 'tine'; index: number; item: Tine }
  | { type: 'spread'; item: Spread }
  | { type: 'circumference'; index: number; item: CircumferencePoint };

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

function getItemId(item: SelectableItem): string {
  switch (item.type) {
    case 'beam':
      return `beam-${item.side}`;
    case 'tine':
      return item.item.id;
    case 'spread':
      return 'spread';
    case 'circumference':
      return item.item.id;
  }
}

export function MeshOverlay({
  imageUrl,
  graph,
  onGraphChange,
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

  const findItemById = (id: string): SelectableItem | null => {
    // Check beams
    if (id === 'beam-left') {
      return { type: 'beam', side: 'left', item: graph.beams.left };
    }
    if (id === 'beam-right') {
      return { type: 'beam', side: 'right', item: graph.beams.right };
    }

    // Check spread
    if (id === 'spread') {
      return { type: 'spread', item: graph.spread };
    }

    // Check tines
    const tineIndex = graph.tines.findIndex(t => t.id === id);
    if (tineIndex !== -1) {
      return { type: 'tine', index: tineIndex, item: graph.tines[tineIndex] };
    }

    // Check circumferences
    const circIndex = graph.circumferences.findIndex(c => c.id === id);
    if (circIndex !== -1) {
      return { type: 'circumference', index: circIndex, item: graph.circumferences[circIndex] };
    }

    return null;
  };

  const movePoint = (point: Vec2, dx: number, dy: number): Vec2 => ({
    x: point.x + dx,
    y: point.y + dy
  });

  const moveItem = (id: string, dx: number, dy: number) => {
    if (readOnly) return;

    const found = findItemById(id);
    if (!found) return;

    const newGraph = { ...graph };

    switch (found.type) {
      case 'beam': {
        const newBeam: Beam = {
          ...found.item,
          points: found.item.points.map(p => movePoint(p, dx, dy))
        };
        newGraph.beams = {
          ...newGraph.beams,
          [found.side]: newBeam
        };
        break;
      }
      case 'tine': {
        const newTine: Tine = {
          ...found.item,
          basePoint: movePoint(found.item.basePoint, dx, dy),
          tipPoint: movePoint(found.item.tipPoint, dx, dy)
        };
        newGraph.tines = [...graph.tines];
        newGraph.tines[found.index] = newTine;
        break;
      }
      case 'spread': {
        const newSpread: Spread = {
          ...found.item,
          leftPoint: movePoint(found.item.leftPoint, dx, dy),
          rightPoint: movePoint(found.item.rightPoint, dx, dy)
        };
        newGraph.spread = newSpread;
        break;
      }
      case 'circumference': {
        const newCirc: CircumferencePoint = {
          ...found.item,
          position: movePoint(found.item.position, dx, dy)
        };
        newGraph.circumferences = [...graph.circumferences];
        newGraph.circumferences[found.index] = newCirc;
        break;
      }
    }

    onGraphChange(newGraph);
  };

  const deselect = () => {
    if (readOnly) return;
    setSelectedId(null);
  };

  const renderBeam = (beam: Beam, side: 'left' | 'right') => {
    if (beam.points.length < 2) return null;
    const id = `beam-${side}`;
    const isSelected = selectedId === id;

    const points = beam.points.map(p => `${p.x},${p.y}`).join(' ');

    return (
      <g key={id}>
        <polyline
          points={points}
          stroke={getColorForConfidence(beam.confidence, isSelected)}
          strokeWidth={isSelected ? 3 : 2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          onClick={() => !readOnly && setSelectedId(id)}
          style={{ cursor: readOnly ? 'default' : 'pointer' }}
          opacity={isSelected ? 1 : 0.7}
        />
        {isSelected && beam.points.map((point, idx) => (
          <circle
            key={`${id}-point-${idx}`}
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

  const renderTine = (tine: Tine) => {
    const isSelected = selectedId === tine.id;

    return (
      <g key={tine.id}>
        <line
          x1={tine.basePoint.x}
          y1={tine.basePoint.y}
          x2={tine.tipPoint.x}
          y2={tine.tipPoint.y}
          stroke={getColorForConfidence(tine.confidence, isSelected)}
          strokeWidth={isSelected ? 3 : 2}
          strokeLinecap="round"
          onClick={() => !readOnly && setSelectedId(tine.id)}
          style={{ cursor: readOnly ? 'default' : 'pointer' }}
          opacity={isSelected ? 1 : 0.7}
        />
        {isSelected && (
          <>
            <circle cx={tine.basePoint.x} cy={tine.basePoint.y} r={4} fill={COLORS.selected} opacity={0.6} />
            <circle cx={tine.tipPoint.x} cy={tine.tipPoint.y} r={4} fill={COLORS.selected} opacity={0.6} />
          </>
        )}
        <text
          x={(tine.basePoint.x + tine.tipPoint.x) / 2 + 5}
          y={(tine.basePoint.y + tine.tipPoint.y) / 2}
          fill="white"
          fontSize="10"
          className="pointer-events-none"
        >
          {tine.label}
        </text>
      </g>
    );
  };

  const renderSpread = () => {
    const isSelected = selectedId === 'spread';

    return (
      <g key="spread">
        <line
          x1={graph.spread.leftPoint.x}
          y1={graph.spread.leftPoint.y}
          x2={graph.spread.rightPoint.x}
          y2={graph.spread.rightPoint.y}
          stroke={getColorForConfidence(graph.spread.confidence, isSelected)}
          strokeWidth={isSelected ? 3 : 2}
          strokeDasharray="5,5"
          strokeLinecap="round"
          onClick={() => !readOnly && setSelectedId('spread')}
          style={{ cursor: readOnly ? 'default' : 'pointer' }}
          opacity={isSelected ? 1 : 0.7}
        />
        {isSelected && (
          <>
            <circle cx={graph.spread.leftPoint.x} cy={graph.spread.leftPoint.y} r={4} fill={COLORS.selected} opacity={0.6} />
            <circle cx={graph.spread.rightPoint.x} cy={graph.spread.rightPoint.y} r={4} fill={COLORS.selected} opacity={0.6} />
          </>
        )}
        <text
          x={(graph.spread.leftPoint.x + graph.spread.rightPoint.x) / 2}
          y={(graph.spread.leftPoint.y + graph.spread.rightPoint.y) / 2 - 8}
          fill="white"
          fontSize="10"
          textAnchor="middle"
          className="pointer-events-none"
        >
          {graph.spread.distance.toFixed(1)}&quot;
        </text>
      </g>
    );
  };

  const renderCircumference = (circ: CircumferencePoint) => {
    const isSelected = selectedId === circ.id;

    return (
      <g key={circ.id}>
        <circle
          cx={circ.position.x}
          cy={circ.position.y}
          r={8}
          stroke={getColorForConfidence(circ.confidence, isSelected)}
          strokeWidth={isSelected ? 3 : 2}
          fill="none"
          onClick={() => !readOnly && setSelectedId(circ.id)}
          style={{ cursor: readOnly ? 'default' : 'pointer' }}
          opacity={isSelected ? 1 : 0.7}
        />
        <text
          x={circ.position.x + 12}
          y={circ.position.y + 4}
          fill="white"
          fontSize="9"
          className="pointer-events-none"
        >
          {circ.label} ({circ.circumference.toFixed(1)}&quot;)
        </text>
      </g>
    );
  };

  const selectedInfo = selectedId ? findItemById(selectedId) : null;

  const getSelectedLabel = (): string => {
    if (!selectedInfo) return '';
    switch (selectedInfo.type) {
      case 'beam':
        return `${selectedInfo.side.charAt(0).toUpperCase() + selectedInfo.side.slice(1)} Beam`;
      case 'tine':
        return `${selectedInfo.item.label} (${selectedInfo.item.side})`;
      case 'spread':
        return 'Inside Spread';
      case 'circumference':
        return `${selectedInfo.item.label} (${selectedInfo.item.side})`;
    }
  };

  const getSelectedConfidence = (): number => {
    if (!selectedInfo) return 0;
    return selectedInfo.item.confidence;
  };

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
          {/* Render beams */}
          {renderBeam(graph.beams.left, 'left')}
          {renderBeam(graph.beams.right, 'right')}

          {/* Render spread */}
          {renderSpread()}

          {/* Render tines */}
          {graph.tines.map(t => renderTine(t))}

          {/* Render circumferences */}
          {graph.circumferences.map(c => renderCircumference(c))}

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
              Selected: <span className="text-primary">{getSelectedLabel()}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Confidence: {(getSelectedConfidence() * 100).toFixed(0)}%
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
                onClick={() => moveItem(selectedId!, 0, -1)}
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
                  onClick={() => moveItem(selectedId!, -1, 0)}
                  className="w-10 h-10 p-0"
                  title="Move left"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={deselect}
                  className="w-10 h-10 p-0"
                  title="Deselect"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => moveItem(selectedId!, 1, 0)}
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
                onClick={() => moveItem(selectedId!, 0, 1)}
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
