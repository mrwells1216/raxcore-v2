'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { MeshOverlay } from '@/components/admin/mesh-overlay';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { 
  scoreFromGraph, 
  getGraphConfidence, 
  getLowConfidenceMeasurements 
} from '@/lib/scoring';
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
  const [originalGraph] = useState<MeasurementGraph>(EXAMPLE_GRAPH);
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

  // Calculate score and confidence using the scoring engine
  const score = scoreFromGraph(graph);
  const overallConfidence = getGraphConfidence(graph);
  const lowConfMeasurements = getLowConfidenceMeasurements(graph, 0.5);
  
  // Check if graph has been modified
  const hasChanges = JSON.stringify(graph) !== JSON.stringify(originalGraph);

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
          Review AI-detected rack geometry and fine-tune measurements. Score updates in real-time as you adjust control points.
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main mesh overlay */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Rack Geometry Overlay</CardTitle>
              <CardDescription>
                Click any control point (white circles) to select it, then use arrow keys or buttons to adjust.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MeshOverlay
                imageUrl="https://images.unsplash.com/photo-1559493676-04b0d2e201e9?w=800&h=600&fit=crop"
                graph={graph}
                onGraphChange={handleGraphChange}
                showScore={true}
              />
            </CardContent>
          </Card>
        </div>

        {/* Stats sidebar */}
        <div className="space-y-4">
          {/* Score breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Score Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="space-y-2">
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Left Beam</span>
                  <span className="font-medium">{score.leftBeam.toFixed(1)}&quot;</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Right Beam</span>
                  <span className="font-medium">{score.rightBeam.toFixed(1)}&quot;</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Inside Spread</span>
                  <span className="font-medium">{score.spread.toFixed(1)}&quot;</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Left Tines ({score.tines.left.length})</span>
                  <span className="font-medium">
                    {score.tines.left.reduce((s, t) => s + t.length, 0).toFixed(1)}&quot;
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Right Tines ({score.tines.right.length})</span>
                  <span className="font-medium">
                    {score.tines.right.reduce((s, t) => s + t.length, 0).toFixed(1)}&quot;
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Circumferences</span>
                  <span className="font-medium">
                    {[...score.circumferences.left, ...score.circumferences.right]
                      .reduce((s, c) => s + c.value, 0).toFixed(1)}&quot;
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t space-y-2">
                <div className="flex justify-between py-1 text-base">
                  <span className="font-medium">Gross Score</span>
                  <span className="font-bold">{score.grossScore.toFixed(1)}</span>
                </div>
                <div className="flex justify-between py-1 text-destructive">
                  <span>Deductions</span>
                  <span>-{score.deductions.toFixed(1)}</span>
                </div>
                <div className="flex justify-between py-1 text-lg text-primary">
                  <span className="font-bold">Net Score</span>
                  <span className="font-bold">{score.netScore.toFixed(1)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Confidence summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Confidence Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b">
                <span className="text-muted-foreground">Overall Confidence</span>
                <span className="font-medium">
                  {(overallConfidence * 100).toFixed(1)}%
                </span>
              </div>
              
              {[
                { name: 'High (75%+)', count: highConfCount, color: 'bg-green-500' },
                { name: 'Medium (50-75%)', count: medConfCount, color: 'bg-blue-500' },
                { name: 'Low (<50%)', count: lowConfCount, color: 'bg-amber-500' }
              ].map(({ name, count, color }) => (
                <div key={name} className="flex items-center gap-2 text-xs">
                  <div className={`${color} w-3 h-3 rounded-full`} />
                  <span>{name}: {count}</span>
                </div>
              ))}

              {/* Low confidence items that need review */}
              {lowConfMeasurements.length > 0 && (
                <div className="pt-2 border-t">
                  <p className="text-xs font-medium text-amber-600 mb-2">
                    Needs Review ({lowConfMeasurements.length})
                  </p>
                  <div className="space-y-1">
                    {lowConfMeasurements.slice(0, 5).map((item) => (
                      <div key={item.id} className="text-xs flex justify-between">
                        <span className="text-muted-foreground capitalize">
                          {item.type}: {item.id}
                        </span>
                        <span className="text-amber-600">
                          {(item.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Action buttons */}
          <div className="space-y-2">
            <Button 
              onClick={handleSave} 
              disabled={isSaving || !hasChanges}
              className="w-full"
            >
              {isSaving ? 'Saving...' : hasChanges ? 'Save Adjustments' : 'No Changes'}
            </Button>
            <Button 
              variant="outline"
              onClick={handleReset}
              disabled={isSaving || !hasChanges}
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
                <li>Click any white control point to select it</li>
                <li>Use arrow keys (1px) or Shift+Arrow (5px) to move</li>
                <li>Score updates automatically as you adjust</li>
                <li>Press Escape or click elsewhere to deselect</li>
                <li>Save creates a new versioned graph</li>
              </ol>
              <p className="pt-2 border-t">
                Focus on low-confidence measurements (amber) first - 
                they need the most human verification.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
