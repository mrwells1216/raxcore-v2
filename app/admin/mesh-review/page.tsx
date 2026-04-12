'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { MeshOverlay } from '@/components/admin/mesh-overlay';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { MeasurementGraph } from '@/lib/types';

// Example measurement graph - in production, this comes from the API
const EXAMPLE_GRAPH: MeasurementGraph = {
  beams: {
    left: {
      id: 'beam-left',
      points: [
        { x: 150, y: 450 },
        { x: 160, y: 350 },
        { x: 180, y: 250 },
        { x: 190, y: 180 }
      ],
      length: 24.5,
      confidence: 0.92,
      source: 'fused'
    },
    right: {
      id: 'beam-right',
      points: [
        { x: 350, y: 450 },
        { x: 340, y: 350 },
        { x: 320, y: 250 },
        { x: 310, y: 180 }
      ],
      length: 25.1,
      confidence: 0.88,
      source: 'fused'
    }
  },
  tines: [
    {
      id: 'g1-left',
      side: 'left',
      parentBeamId: 'beam-left',
      basePoint: { x: 155, y: 400 },
      tipPoint: { x: 120, y: 360 },
      length: 4.8,
      label: 'G1',
      confidence: 0.85
    },
    {
      id: 'g2-left',
      side: 'left',
      parentBeamId: 'beam-left',
      basePoint: { x: 165, y: 320 },
      tipPoint: { x: 100, y: 240 },
      length: 9.2,
      label: 'G2',
      confidence: 0.78
    },
    {
      id: 'g3-left',
      side: 'left',
      parentBeamId: 'beam-left',
      basePoint: { x: 175, y: 270 },
      tipPoint: { x: 130, y: 180 },
      length: 10.5,
      label: 'G3',
      confidence: 0.72
    },
    {
      id: 'g1-right',
      side: 'right',
      parentBeamId: 'beam-right',
      basePoint: { x: 345, y: 400 },
      tipPoint: { x: 380, y: 360 },
      length: 5.1,
      label: 'G1',
      confidence: 0.82
    },
    {
      id: 'g2-right',
      side: 'right',
      parentBeamId: 'beam-right',
      basePoint: { x: 335, y: 320 },
      tipPoint: { x: 400, y: 240 },
      length: 8.9,
      label: 'G2',
      confidence: 0.75
    },
    {
      id: 'g3-right',
      side: 'right',
      parentBeamId: 'beam-right',
      basePoint: { x: 325, y: 270 },
      tipPoint: { x: 370, y: 180 },
      length: 10.2,
      label: 'G3',
      confidence: 0.68
    }
  ],
  spread: {
    leftPoint: { x: 150, y: 450 },
    rightPoint: { x: 350, y: 450 },
    distance: 18.5,
    confidence: 0.90
  },
  circumferences: [
    {
      id: 'h1-left',
      side: 'left',
      label: 'H1',
      position: { x: 155, y: 430 },
      circumference: 4.2,
      confidence: 0.65
    },
    {
      id: 'h2-left',
      side: 'left',
      label: 'H2',
      position: { x: 160, y: 360 },
      circumference: 3.8,
      confidence: 0.58
    },
    {
      id: 'h1-right',
      side: 'right',
      label: 'H1',
      position: { x: 345, y: 430 },
      circumference: 4.3,
      confidence: 0.62
    },
    {
      id: 'h2-right',
      side: 'right',
      label: 'H2',
      position: { x: 340, y: 360 },
      circumference: 3.9,
      confidence: 0.55
    }
  ]
};

// In production, this would come from route params or state
const EXAMPLE_RACK_ID = 'example-rack-id';

export default function MeshReviewPage() {
  const [graph, setGraph] = useState<MeasurementGraph>(EXAMPLE_GRAPH);
  const [isSaving, setIsSaving] = useState(false);

  const handleGraphChange = (newGraph: MeasurementGraph) => {
    setGraph(newGraph);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await fetch('/api/admin/mesh-adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rack_id: EXAMPLE_RACK_ID,
          adjusted_graph: graph,
          notes: 'Manual adjustment via mesh review'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to save');
      }

      const data = await response.json();
      toast.success(`Saved as version ${data.version}`);
    } catch (error) {
      toast.error('Failed to save mesh adjustments');
      console.error('Save error:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setGraph(EXAMPLE_GRAPH);
    toast.info('Mesh reset to original values');
  };

  // Calculate overall confidence from all measurements
  const calculateOverallConfidence = (g: MeasurementGraph): number => {
    const confidences = [
      g.beams.left.confidence,
      g.beams.right.confidence,
      g.spread.confidence,
      ...g.tines.map(t => t.confidence),
      ...g.circumferences.map(c => c.confidence)
    ];
    if (confidences.length === 0) return 0;
    const sum = confidences.reduce((acc, c) => acc + c, 0);
    return sum / confidences.length;
  };

  const allConfidences = [
    graph.beams.left.confidence,
    graph.beams.right.confidence,
    graph.spread.confidence,
    ...graph.tines.map(t => t.confidence),
    ...graph.circumferences.map(c => c.confidence)
  ];

  const highConfCount = allConfidences.filter(c => c >= 0.75).length;
  const medConfCount = allConfidences.filter(c => c >= 0.5 && c < 0.75).length;
  const lowConfCount = allConfidences.filter(c => c < 0.5).length;

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Mesh Review &amp; Adjustment</h1>
        <p className="text-muted-foreground">
          Review AI-detected rack geometry and fine-tune measurements. Changes create new graph versions.
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main mesh overlay */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Rack Geometry Overlay</CardTitle>
              <CardDescription>
                Click any measurement to adjust its position. Color intensity indicates confidence level.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MeshOverlay
                imageUrl="https://images.unsplash.com/photo-1559493676-04b0d2e201e9?w=800&h=600&fit=crop"
                graph={graph}
                onGraphChange={handleGraphChange}
              />
            </CardContent>
          </Card>
        </div>

        {/* Stats sidebar */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mesh Statistics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b">
                <span className="text-muted-foreground">Main Beams</span>
                <span className="font-medium">2</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-muted-foreground">Tines</span>
                <span className="font-medium">{graph.tines.length}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-muted-foreground">Spread</span>
                <span className="font-medium">{graph.spread.distance.toFixed(1)}&quot;</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-muted-foreground">Circumferences</span>
                <span className="font-medium">{graph.circumferences.length}</span>
              </div>

              {/* Confidence summary */}
              <div className="pt-2 border-t space-y-2">
                <p className="font-medium">Confidence Summary</p>
                <div className="text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Overall:</span>
                    <span className="font-medium">
                      {(calculateOverallConfidence(graph) * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
                {[
                  { name: 'High (0.75+)', count: highConfCount, color: 'bg-green-500' },
                  { name: 'Medium (0.5-0.75)', count: medConfCount, color: 'bg-blue-500' },
                  { name: 'Low (<0.5)', count: lowConfCount, color: 'bg-amber-500' }
                ].map(({ name, count, color }) => (
                  <div key={name} className="flex items-center gap-2 text-xs">
                    <div className={`${color} w-3 h-3 rounded-full`} />
                    <span>{name}: {count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Action buttons */}
          <div className="space-y-2">
            <Button 
              onClick={handleSave} 
              disabled={isSaving}
              className="w-full"
            >
              {isSaving ? 'Saving...' : 'Save Adjustments'}
            </Button>
            <Button 
              variant="outline"
              onClick={handleReset}
              disabled={isSaving}
              className="w-full"
            >
              Reset to Original
            </Button>
          </div>

          {/* Help section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">How to Use</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <ol className="list-decimal list-inside space-y-1">
                <li>Click any measurement line to select it</li>
                <li>Use arrow buttons to move by 1 pixel</li>
                <li>Adjust until alignment is perfect</li>
                <li>Click reset to deselect</li>
                <li>Save creates a new versioned graph</li>
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
