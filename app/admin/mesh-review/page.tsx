'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { MeshOverlay, MeshData } from '@/components/admin/mesh-overlay';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

// Example mesh data representing a measurement graph - in production, this comes from the API
const EXAMPLE_MESH: MeshData = {
  beams: [
    {
      id: 'beam-left',
      label: 'Left Main Beam',
      points: [
        { x: 150, y: 450 },
        { x: 180, y: 200 }
      ],
      confidence: 0.92
    },
    {
      id: 'beam-right',
      label: 'Right Main Beam',
      points: [
        { x: 350, y: 450 },
        { x: 320, y: 200 }
      ],
      confidence: 0.88
    }
  ],
  tines: [
    {
      id: 'tine-left-1',
      label: 'Left Tine 1',
      points: [
        { x: 140, y: 250 },
        { x: 130, y: 180 }
      ],
      confidence: 0.75
    },
    {
      id: 'tine-left-2',
      label: 'Left Tine 2',
      points: [
        { x: 160, y: 280 },
        { x: 155, y: 200 }
      ],
      confidence: 0.68
    },
    {
      id: 'tine-right-1',
      label: 'Right Tine 1',
      points: [
        { x: 360, y: 250 },
        { x: 370, y: 180 }
      ],
      confidence: 0.82
    },
    {
      id: 'tine-right-2',
      label: 'Right Tine 2',
      points: [
        { x: 340, y: 280 },
        { x: 345, y: 200 }
      ],
      confidence: 0.71
    }
  ],
  spreads: [
    {
      id: 'spread-base',
      label: 'Spread',
      points: [
        { x: 150, y: 450 },
        { x: 350, y: 450 }
      ],
      confidence: 0.85
    }
  ],
  burrs: []
};

// In production, this would come from route params or state
const EXAMPLE_RACK_ID = 'example-rack-id';

export default function MeshReviewPage() {
  const [mesh, setMesh] = useState<MeshData>(EXAMPLE_MESH);
  const [isSaving, setIsSaving] = useState(false);

  const handleMeshChange = (newMesh: MeshData) => {
    setMesh(newMesh);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Convert MeshData to measurement_graphs format
      const adjustedGraph = {
        beams: mesh.beams,
        tines: mesh.tines,
        spreads: mesh.spreads,
        burrs: mesh.burrs,
        confidence: calculateOverallConfidence(mesh)
      };

      const response = await fetch('/api/admin/mesh-adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rack_id: EXAMPLE_RACK_ID,
          adjusted_graph: adjustedGraph,
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
    setMesh(EXAMPLE_MESH);
    toast.info('Mesh reset to original values');
  };

  // Calculate overall confidence from all measurements
  const calculateOverallConfidence = (meshData: MeshData): number => {
    const allMeasurements = [
      ...meshData.beams,
      ...meshData.tines,
      ...meshData.spreads,
      ...meshData.burrs
    ];
    if (allMeasurements.length === 0) return 0;
    const sum = allMeasurements.reduce((acc, m) => acc + m.confidence, 0);
    return sum / allMeasurements.length;
  };

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
                mesh={mesh}
                onMeshChange={handleMeshChange}
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
                <span className="font-medium">{mesh.beams.length}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-muted-foreground">Tines</span>
                <span className="font-medium">{mesh.tines.length}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-muted-foreground">Spreads</span>
                <span className="font-medium">{mesh.spreads.length}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-muted-foreground">Burrs</span>
                <span className="font-medium">{mesh.burrs.length}</span>
              </div>

              {/* Confidence summary */}
              <div className="pt-2 border-t space-y-2">
                <p className="font-medium">Confidence Summary</p>
                <div className="text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Overall:</span>
                    <span className="font-medium">
                      {(calculateOverallConfidence(mesh) * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
                {[
                  { name: 'High (0.75+)', count: [...mesh.beams, ...mesh.tines, ...mesh.spreads, ...mesh.burrs].filter(m => m.confidence >= 0.75).length, color: 'bg-green-500' },
                  { name: 'Medium (0.5-0.75)', count: [...mesh.beams, ...mesh.tines, ...mesh.spreads, ...mesh.burrs].filter(m => m.confidence >= 0.5 && m.confidence < 0.75).length, color: 'bg-blue-500' },
                  { name: 'Low (<0.5)', count: [...mesh.beams, ...mesh.tines, ...mesh.spreads, ...mesh.burrs].filter(m => m.confidence < 0.5).length, color: 'bg-amber-500' }
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
