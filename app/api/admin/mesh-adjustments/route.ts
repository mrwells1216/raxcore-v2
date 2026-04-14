import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import type { MeasurementGraph } from '@/lib/types';

type StoredGraphRecord = {
  id: string;
  graph: MeasurementGraph;
  confidence: number | null;
  version: number;
  created_at: string;
};

interface GraphAdjustmentRequest {
  buck_id?: string;
  rack_id?: string;
  adjusted_graph: MeasurementGraph;
  notes?: string;
}

function calculateGraphConfidence(graph: MeasurementGraph): number {
  const confidences = [
    graph.beams.left.confidence,
    graph.beams.right.confidence,
    graph.spread.confidence,
    ...graph.tines.map((t) => t.confidence),
    ...graph.circumferences.map((c) => c.confidence),
  ].filter((value) => Number.isFinite(value));

  if (confidences.length === 0) return 0;
  return confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
}

function isMissingTableError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '42P01';
}

function isMissingColumnError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '42703';
}

async function fetchLatestGraph(
  supabase: Awaited<ReturnType<typeof createClient>>,
  buckId: string,
  version?: number | null
): Promise<{
  graph: StoredGraphRecord | null;
  allVersions: Array<Pick<StoredGraphRecord, 'version' | 'confidence' | 'created_at'>>;
  measurementGraphsAvailable: boolean;
  foreignKey: 'buck_id' | 'rack_id' | null;
}> {
  const runQuery = async (foreignKey: 'buck_id' | 'rack_id') => {
    let latestQuery = supabase
      .from('measurement_graphs')
      .select('id, graph, confidence, version, created_at')
      .eq(foreignKey, buckId);

    if (typeof version === 'number') {
      latestQuery = latestQuery.eq('version', version);
    } else {
      latestQuery = latestQuery.order('version', { ascending: false }).limit(1);
    }

    const latestResult = await latestQuery;

    if (latestResult.error) {
      return {
        error: latestResult.error,
        graph: null,
        versions: [] as Array<Pick<StoredGraphRecord, 'version' | 'confidence' | 'created_at'>>,
      };
    }

    const versionsResult = await supabase
      .from('measurement_graphs')
      .select('version, confidence, created_at')
      .eq(foreignKey, buckId)
      .order('version', { ascending: true });

    return {
      error: versionsResult.error,
      graph: (latestResult.data?.[0] ?? null) as StoredGraphRecord | null,
      versions: (versionsResult.data ?? []) as Array<Pick<StoredGraphRecord, 'version' | 'confidence' | 'created_at'>>,
    };
  };

  const buckAttempt = await runQuery('buck_id');
  if (!buckAttempt.error) {
    return {
      graph: buckAttempt.graph,
      allVersions: buckAttempt.versions,
      measurementGraphsAvailable: true,
      foreignKey: 'buck_id',
    };
  }

  if (isMissingTableError(buckAttempt.error)) {
    return {
      graph: null,
      allVersions: [],
      measurementGraphsAvailable: false,
      foreignKey: null,
    };
  }

  if (!isMissingColumnError(buckAttempt.error)) {
    throw buckAttempt.error;
  }

  const rackAttempt = await runQuery('rack_id');
  if (rackAttempt.error) {
    if (isMissingTableError(rackAttempt.error)) {
      return {
        graph: null,
        allVersions: [],
        measurementGraphsAvailable: false,
        foreignKey: null,
      };
    }
    throw rackAttempt.error;
  }

  return {
    graph: rackAttempt.graph,
    allVersions: rackAttempt.versions,
    measurementGraphsAvailable: true,
    foreignKey: 'rack_id',
  };
}

async function insertGraphVersion(
  supabase: Awaited<ReturnType<typeof createClient>>,
  buckId: string,
  graph: MeasurementGraph,
  confidence: number,
  version: number,
  preferredForeignKey?: 'buck_id' | 'rack_id' | null
) {
  const payloads =
    preferredForeignKey === 'rack_id'
      ? [
          { rack_id: buckId, graph, confidence, version },
          { buck_id: buckId, graph, confidence, version },
        ]
      : [
          { buck_id: buckId, graph, confidence, version },
          { rack_id: buckId, graph, confidence, version },
        ];

  let lastError: unknown = null;

  for (const payload of payloads) {
    const { data, error } = await supabase
      .from('measurement_graphs')
      .insert(payload)
      .select('id, version')
      .single();

    if (!error && data) {
      return data;
    }

    lastError = error;

    if (!isMissingColumnError(error)) {
      break;
    }
  }

  throw lastError;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (profileError || !profile?.is_admin) {
      return NextResponse.json({ message: 'Only admins can adjust mesh data' }, { status: 403 });
    }

    const body = (await request.json()) as GraphAdjustmentRequest;
    const buckId = body.buck_id ?? body.rack_id;
    const adjustedGraph = body.adjusted_graph;
    const notes = body.notes;

    if (!buckId || !adjustedGraph) {
      return NextResponse.json(
        { message: 'Missing required fields: buck_id (or rack_id), adjusted_graph' },
        { status: 400 }
      );
    }

    const { data: buck, error: buckError } = await supabase
      .from('bucks')
      .select('id')
      .eq('id', buckId)
      .single();

    if (buckError || !buck) {
      return NextResponse.json({ message: 'Buck not found' }, { status: 404 });
    }

    const graphState = await fetchLatestGraph(supabase, buckId, null);

    if (!graphState.measurementGraphsAvailable) {
      return NextResponse.json(
        {
          message: 'measurement_graphs table is missing. Save is disabled until that table exists.',
          code: 'MEASUREMENT_GRAPHS_MISSING',
        },
        { status: 409 }
      );
    }

    const nextVersion =
      graphState.allVersions.length > 0
        ? graphState.allVersions[graphState.allVersions.length - 1].version + 1
        : 1;

    const confidence = calculateGraphConfidence(adjustedGraph);

    const inserted = await insertGraphVersion(
      supabase,
      buckId,
      adjustedGraph,
      confidence,
      nextVersion,
      graphState.foreignKey
    );

    if (notes) {
      console.log(`[mesh-adjustment] buck=${buckId} version=${nextVersion} notes=${notes}`);
    }

    return NextResponse.json(
      {
        message: 'Graph adjustments saved successfully',
        graph_id: inserted.id,
        version: inserted.version,
        confidence,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Graph adjustment error:', error);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const buckId = searchParams.get('buck_id') ?? searchParams.get('rack_id');
    const versionParam = searchParams.get('version');
    const version = versionParam ? Number.parseInt(versionParam, 10) : null;

    if (!buckId) {
      return NextResponse.json(
        { message: 'Missing buck_id parameter (rack_id is accepted as a legacy alias)' },
        { status: 400 }
      );
    }

    const { data: buck, error: buckError } = await supabase
      .from('bucks')
      .select('id, user_id, created_at, rack_type, main_frame_points, notes, status')
      .eq('id', buckId)
      .single();

    if (buckError || !buck) {
      return NextResponse.json({ message: 'Buck not found' }, { status: 404 });
    }

    const { data: images, error: imagesError } = await supabase
      .from('buck_images')
      .select('id, public_url, storage_path, angle_type, quality_score, created_at')
      .eq('buck_id', buckId)
      .order('created_at', { ascending: true });

    if (imagesError) {
      console.error('Images fetch error:', imagesError);
    }

    const graphState = await fetchLatestGraph(supabase, buckId, version);

    const { data: latestPrediction, error: predictionError } = await supabase
      .from('predictions')
      .select('*')
      .eq('buck_id', buckId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (predictionError) {
      console.error('Prediction fetch error:', predictionError);
    }

    return NextResponse.json(
      {
        buck,
        images: images ?? [],
        current_graph: graphState.graph,
        all_versions: graphState.allVersions,
        measurement_graphs_available: graphState.measurementGraphsAvailable,
        measurement_graphs_foreign_key: graphState.foreignKey,
        latest_prediction: latestPrediction ?? null,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Fetch error:', error);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
