import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

interface MeshAdjustment {
  sheet_id: string;
  adjusted_mesh: Record<string, unknown>;
  notes?: string;
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

    const body: MeshAdjustment = await request.json();
    const { sheet_id, adjusted_mesh, notes } = body;

    if (!sheet_id || !adjusted_mesh) {
      return NextResponse.json(
        { message: 'Missing required fields: sheet_id, adjusted_mesh' },
        { status: 400 }
      );
    }

    // Verify the sheet exists and user owns it
    const { data: sheet, error: sheetError } = await supabase
      .from('official_score_sheets')
      .select('id, score_data')
      .eq('id', sheet_id)
      .single();

    if (sheetError || !sheet) {
      return NextResponse.json(
        { message: 'Score sheet not found' },
        { status: 404 }
      );
    }

    // Save the adjusted mesh as a new version
    // You might want to store this in a new table or as a JSON column update
    const { error: updateError } = await supabase
      .from('official_score_sheets')
      .update({
        score_data: {
          ...sheet.score_data,
          adjusted_mesh,
          adjusted_at: new Date().toISOString(),
          adjusted_by: user.id,
          adjustment_notes: notes
        }
      })
      .eq('id', sheet_id);

    if (updateError) {
      console.error('Update error:', updateError);
      return NextResponse.json(
        { message: 'Failed to save mesh adjustments' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        message: 'Mesh adjustments saved successfully',
        sheet_id
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Mesh adjustment error:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET endpoint to retrieve saved mesh adjustments
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
    const sheetId = searchParams.get('sheet_id');

    if (!sheetId) {
      return NextResponse.json(
        { message: 'Missing sheet_id parameter' },
        { status: 400 }
      );
    }

    // Get the sheet
    const { data: sheet, error: sheetError } = await supabase
      .from('official_score_sheets')
      .select('id, score_data, scoring_system, created_at')
      .eq('id', sheetId)
      .single();

    if (sheetError || !sheet) {
      return NextResponse.json(
        { message: 'Score sheet not found' },
        { status: 404 }
      );
    }

    // Get associated images
    const { data: images, error: imagesError } = await supabase
      .from('official_score_images')
      .select('id, image_url, image_type, uploaded_at')
      .eq('sheet_id', sheetId);

    if (imagesError) {
      console.error('Images fetch error:', imagesError);
    }

    return NextResponse.json(
      {
        sheet: {
          id: sheet.id,
          scoring_system: sheet.scoring_system,
          score_data: sheet.score_data,
          created_at: sheet.created_at
        },
        images: images || []
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
