import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import type { MeasurementGraph } from '@/lib/types';

interface GraphAdjustmentRequest {
  rack_id: string;
  adjusted_graph: MeasurementGraph;
  notes?: string;
}

// Calculate overall confidence from a MeasurementGraph
function calculateGraphConfidence(graph: MeasurementGraph): number {
  const confidences = [
    graph.beams.left.confidence,
    graph.beams.right.confidence,
    graph.spread.confidence,
    ...graph.tines.map(t => t.confidence),
    ...graph.circumferences.map(c => c.confidence)
  ];
  if (confidences.length === 0) return 0;
  return confidences.reduce((a, b) => a + b, 0) / confidences.length;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Get current user
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if user is admin
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (profileError || !profile?.is_admin) {
      return NextResponse.json(
        { message: 'Only admins can adjust mesh data' },
        { status: 403 }
      );
    }

    const body: GraphAdjustmentRequest = await request.json();
    const { rack_id, adjusted_graph, notes } = body;

    if (!rack_id || !adjusted_graph) {
      return NextResponse.json(
        { message: 'Missing required fields: rack_id, adjusted_graph' },
        { status: 400 }
      );
    }

    // Verify the rack exists
    const { data: rack, error: rackError } = await supabase
      .from('racks')
      .select('id')
      .eq('id', rack_id)
      .single();

    if (rackError || !rack) {
      return NextResponse.json(
        { message: 'Rack not found' },
        { status: 404 }
      );
    }

    // Get the current highest version for this rack
    const { data: existingGraphs, error: graphsError } = await supabase
      .from('measurement_graphs')
      .select('version')
      .eq('rack_id', rack_id)
      .order('version', { ascending: false })
      .limit(1);

    if (graphsError) {
      console.error('Graphs fetch error:', graphsError);
      return NextResponse.json(
        { message: 'Failed to check existing graphs' },
        { status: 500 }
      );
    }

    const nextVersion = existingGraphs && existingGraphs.length > 0 
      ? existingGraphs[0].version + 1 
      : 1;

    // Calculate confidence from the adjusted graph
    const confidence = calculateGraphConfidence(adjusted_graph);

    // Insert the new graph version
    const { data: newGraph, error: insertError } = await supabase
      .from('measurement_graphs')
      .insert({
        rack_id,
        graph: adjusted_graph,
        confidence,
        version: nextVersion
      })
      .select('id, version')
      .single();

    if (insertError || !newGraph) {
      console.error('Insert error:', insertError);
      return NextResponse.json(
        { message: 'Failed to save graph adjustments' },
        { status: 500 }
      );
    }

    // If there's a training example linked to this rack, we might want to track the adjustment
    // This could be used for error analysis later
    if (notes) {
      // Optionally log the adjustment for audit purposes
      console.log(`[Mesh Adjustment] Rack ${rack_id}, version ${nextVersion}: ${notes}`);
    }

    return NextResponse.json(
      {
        message: 'Graph adjustments saved successfully',
        graph_id: newGraph.id,
        version: newGraph.version,
        confidence
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Graph adjustment error:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET endpoint to retrieve rack data with graphs and images
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Get current user
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const rackId = searchParams.get('rack_id');
    const version = searchParams.get('version');

    if (!rackId) {
      return NextResponse.json(
        { message: 'Missing rack_id parameter' },
        { status: 400 }
      );
    }

    // Get the rack
    const { data: rack, error: rackError } = await supabase
      .from('racks')
      .select('id, user_id, created_at')
      .eq('id', rackId)
      .single();

    if (rackError || !rack) {
      return NextResponse.json(
        { message: 'Rack not found' },
        { status: 404 }
      );
    }

    // Get associated images
    const { data: images, error: imagesError } = await supabase
      .from('rack_images')
      .select('id, image_url, angle, quality_score, created_at')
      .eq('rack_id', rackId)
      .order('created_at', { ascending: true });

    if (imagesError) {
      console.error('Images fetch error:', imagesError);
    }

    // Get measurement graph(s) - either specific version or latest
    let graphQuery = supabase
      .from('measurement_graphs')
      .select('id, graph, confidence, version, created_at')
      .eq('rack_id', rackId);

    if (version) {
      graphQuery = graphQuery.eq('version', parseInt(version, 10));
    } else {
      graphQuery = graphQuery.order('version', { ascending: false }).limit(1);
    }

    const { data: graphs, error: graphsError } = await graphQuery;

    if (graphsError) {
      console.error('Graphs fetch error:', graphsError);
    }

    // Get training examples linked to this rack's graphs
    const graphIds = graphs?.map(g => g.id) || [];
    let trainingExamples = null;

    if (graphIds.length > 0) {
      const { data: examples, error: examplesError } = await supabase
        .from('training_examples')
        .select('id, scoring_system, official_score, graph_id, created_at')
        .in('graph_id', graphIds);

      if (examplesError) {
        console.error('Training examples fetch error:', examplesError);
      } else {
        trainingExamples = examples;
      }
    }

    // Get all versions info for this rack
    const { data: allVersions, error: versionsError } = await supabase
      .from('measurement_graphs')
      .select('version, confidence, created_at')
      .eq('rack_id', rackId)
      .order('version', { ascending: true });

    if (versionsError) {
      console.error('Versions fetch error:', versionsError);
    }

    return NextResponse.json(
      {
        rack: {
          id: rack.id,
          user_id: rack.user_id,
          created_at: rack.created_at
        },
        images: images || [],
        current_graph: graphs && graphs.length > 0 ? graphs[0] : null,
        all_versions: allVersions || [],
        training_examples: trainingExamples
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Fetch error:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
