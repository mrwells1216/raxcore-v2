'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { MeshOverlay, MeshData } from '@/components/admin/mesh-overlay';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

// Example mesh data - in production, this would come from an API
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

export default function MeshReviewPage() {
  const [mesh, setMesh] = useState<MeshData>(EXAMPLE_MESH);
  const [isSaving, setIsSaving] = useState(false);

  const handleMeshChange = (newMesh: MeshData) => {
    setMesh(newMesh);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // In production, send to your API
      console.log('Saving mesh:', mesh);
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      toast.success('Mesh adjustments saved successfully');
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

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Mesh Review &amp; Adjustment</h1>
        <p className="text-muted-foreground">
          Review AI-detected rack geometry and fine-tune measurements through interactive adjustment.
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
                {[
                  { name: 'High (0.75+)', count: [...mesh.beams, ...mesh.tines, ...mesh.spreads, ...mesh.burrs].filter(m => m.confidence >= 0.75).length, color: 'bg-green-500' },
                  { name: 'Medium (0.5-0.75)', count: [...mesh.beams, ...mesh.tines, ...mesh.spreads, ...mesh.burrs].filter(m => m.confidence >= 0.5 && m.confidence < 0.75).length, color: 'bg-blue-500' },
                  { name: 'Low (&lt;0.5)', count: [...mesh.beams, ...mesh.tines, ...mesh.spreads, ...mesh.burrs].filter(m => m.confidence < 0.5).length, color: 'bg-amber-500' }
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
                <li>Save when satisfied with all adjustments</li>
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
