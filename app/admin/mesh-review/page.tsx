'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MeshOverlay } from '@/components/admin/mesh-overlay';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { scoreFromGraph, getGraphConfidence, getLowConfidenceMeasurements } from '@/lib/scoring';
import { convertDetectionGraphToMeasurementGraph } from '@/lib/scoring/graph-conversion';
import type { MeasurementGraph } from '@/lib/types';
import type { AntlerMeasurementGraph } from '@/lib/detection/types';

type MeshReviewApiResponse = {
  buck: {
    id: string;
    rack_type?: string | null;
    main_frame_points?: number | null;
    status?: string | null;
    created_at?: string;
  };
  images: Array<{
    id: string;
    public_url?: string | null;
    storage_path?: string | null;
    angle_type?: string | null;
    quality_score?: number | null;
    created_at?: string;
  }>;
  current_graph: {
    id: string;
    graph: MeasurementGraph;
    confidence: number | null;
    version: number;
    created_at: string;
  } | null;
  all_versions: Array<{
    version: number;
    confidence: number | null;
    created_at: string;
  }>;
  measurement_graphs_available: boolean;
  measurement_graphs_foreign_key: 'buck_id' | 'rack_id' | null;
  latest_prediction: Record<string, unknown> | null;
};

const FALLBACK_GRAPH: MeasurementGraph = {
  beams: {
    left: {
      id: 'beam-left',
      points: [
        { x: 160, y: 430 },
        { x: 170, y: 340 },
        { x: 185, y: 255 },
        { x: 200, y: 180 },
      ],
      length: 0,
      confidence: 0.25,
      source: 'fused',
    },
    right: {
      id: 'beam-right',
      points: [
        { x: 340, y: 430 },
        { x: 330, y: 340 },
        { x: 315, y: 255 },
        { x: 300, y: 180 },
      ],
      length: 0,
      confidence: 0.25,
      source: 'fused',
    },
  },
  tines: [],
  spread: {
    leftPoint: { x: 160, y: 430 },
    rightPoint: { x: 340, y: 430 },
    distance: 0,
    confidence: 0.25,
  },
  circumferences: [],
};

function getPredictionMeasurementGraph(prediction: Record<string, unknown> | null): AntlerMeasurementGraph | null {
  if (!prediction) return null;

  const direct = prediction.measurementGraph ?? prediction.measurement_graph;
  if (direct && typeof direct === 'object' && 'nodes' in (direct as Record<string, unknown>)) {
    return direct as AntlerMeasurementGraph;
  }

  const rawResponse = prediction.rawResponse ?? prediction.raw_response;
  if (rawResponse && typeof rawResponse === 'object') {
    const nested = (rawResponse as Record<string, unknown>).measurementGraph;
    if (nested && typeof nested === 'object' && 'nodes' in (nested as Record<string, unknown>)) {
      return nested as AntlerMeasurementGraph;
    }
  }

  return null;
}

function getPrimaryImageUrl(images: MeshReviewApiResponse['images']): string {
  const first = images.find((image) => image.public_url || image.storage_path);
  return first?.public_url || first?.storage_path || '/deer_clean_85.png';
}

export default function MeshReviewPage() {
  const searchParams = useSearchParams();
  const buckId = searchParams.get('buckId') ?? searchParams.get('buck_id') ?? searchParams.get('rack_id');

  const [graph, setGraph] = useState<MeasurementGraph>(FALLBACK_GRAPH);
  const [originalGraph, setOriginalGraph] = useState<MeasurementGraph>(FALLBACK_GRAPH);
  const [imageUrl, setImageUrl] = useState<string>('/deer_clean_85.png');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveDisabledReason, setSaveDisabledReason] = useState<string | null>(null);
  const [versionLabel, setVersionLabel] = useState<string>('Unsaved');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!buckId) {
        setLoadError('Missing buckId in the URL. Use ?buckId=<id>.');
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setLoadError(null);

      try {
        const response = await fetch(`/api/admin/mesh-adjustments?buck_id=${encodeURIComponent(buckId)}`, {
          cache: 'no-store',
        });

        if (!response.ok) {
          const errorPayload = await response.json().catch(() => null);
          throw new Error(errorPayload?.message || 'Failed to load mesh review data');
        }

        const data = (await response.json()) as MeshReviewApiResponse;
        if (cancelled) return;

        const persistedGraph = data.current_graph?.graph;
        const detectionGraph = getPredictionMeasurementGraph(data.latest_prediction);
        const derivedGraph =
          persistedGraph ??
          (detectionGraph ? convertDetectionGraphToMeasurementGraph(detectionGraph) : null) ??
          FALLBACK_GRAPH;

        setGraph(derivedGraph);
        setOriginalGraph(derivedGraph);
        setImageUrl(getPrimaryImageUrl(data.images));
        setVersionLabel(
          data.current_graph
            ? `Version ${data.current_graph.version}`
            : detectionGraph
              ? 'Derived from latest prediction graph'
              : 'Fallback graph'
        );
        setSaveDisabledReason(
          data.measurement_graphs_available
            ? null
            : 'measurement_graphs table is missing. Review is available, but save is disabled.'
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load mesh review data';
        if (!cancelled) {
          setLoadError(message);
          toast.error(message);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [buckId]);

  const handleGraphChange = (nextGraph: MeasurementGraph) => {
    setGraph(nextGraph);
  };

  const handleSave = async () => {
    if (!buckId) {
      toast.error('Missing buckId. Cannot save graph.');
      return;
    }

    if (saveDisabledReason) {
      toast.error(saveDisabledReason);
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch('/api/admin/mesh-adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buck_id: buckId,
          adjusted_graph: graph,
          notes: 'Manual adjustment via mesh review',
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.message || 'Failed to save mesh adjustments');
      }

      setOriginalGraph(graph);
      setVersionLabel(`Version ${payload.version}`);
      toast.success(`Saved as version ${payload.version}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save mesh adjustments';
      toast.error(message);
      console.error('Save error:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setGraph(originalGraph);
    toast.info('Mesh reset to loaded values');
  };

  const score = useMemo(() => scoreFromGraph(graph), [graph]);
  const overallConfidence = useMemo(() => getGraphConfidence(graph), [graph]);
  const lowConfidenceMeasurements = useMemo(() => getLowConfidenceMeasurements(graph, 0.5), [graph]);
  const hasChanges = JSON.stringify(graph) !== JSON.stringify(originalGraph);

  const allConfidences = useMemo(
    () => [
      graph.beams.left.confidence,
      graph.beams.right.confidence,
      graph.spread.confidence,
      ...graph.tines.map((t) => t.confidence),
      ...graph.circumferences.map((c) => c.confidence),
    ],
    [graph]
  );

  const highConfCount = allConfidences.filter((c) => c >= 0.75).length;
  const medConfCount = allConfidences.filter((c) => c >= 0.5 && c < 0.75).length;
  const lowConfCount = allConfidences.filter((c) => c < 0.5).length;

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading mesh review…</div>;
  }

  if (loadError) {
    return <div className="p-6 text-sm text-destructive">{loadError}</div>;
  }

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Mesh Review &amp; Adjustment</h1>
        <p className="text-muted-foreground">
          Review AI-derived rack geometry and fine-tune measurements. This screen now uses real buck data when it exists.
        </p>
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Buck:</span> {buckId} &nbsp;•&nbsp; {versionLabel}
        </div>
        {saveDisabledReason && <div className="text-xs text-amber-500">{saveDisabledReason}</div>}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Rack Geometry Overlay</CardTitle>
              <CardDescription>
                Click any control point group, then use the D-pad controls or arrow keys to nudge the selected geometry.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MeshOverlay imageUrl={imageUrl} graph={graph} onGraphChange={handleGraphChange} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
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
                <div className="border-t pt-2 mt-2 space-y-2">
                  <div className="flex justify-between py-1 font-medium">
                    <span>Gross Score</span>
                    <span>{score.grossScore.toFixed(1)}&quot;</span>
                  </div>
                  <div className="flex justify-between py-1 font-medium">
                    <span>Net Score</span>
                    <span>{score.netScore.toFixed(1)}&quot;</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Confidence</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">Overall</span>
                <span className="font-medium">{(overallConfidence * 100).toFixed(0)}%</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">High-confidence segments</span>
                <span>{highConfCount}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">Medium-confidence segments</span>
                <span>{medConfCount}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">Low-confidence segments</span>
                <span>{lowConfCount}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Low-Confidence Measurements</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {lowConfidenceMeasurements.length === 0 ? (
                <p className="text-muted-foreground">No low-confidence measurements under the current threshold.</p>
              ) : (
                <div className="space-y-2">
                  {lowConfidenceMeasurements.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                      <span>{item.label}</span>
                      <span className="text-amber-500">{(item.confidence * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={isSaving || !hasChanges || !!saveDisabledReason}>
              {isSaving ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="outline" onClick={handleReset} disabled={!hasChanges}>
              Reset
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
