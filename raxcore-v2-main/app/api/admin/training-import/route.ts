import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

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
        { message: 'Only admins can import training data' },
        { status: 403 }
      );
    }

    // Parse form data
    const formData = await request.formData();
    const scoringSystem = formData.get('scoring_system') as string;
    const scoreDataStr = formData.get('score_data') as string;
    // Requires: ALTER TABLE official_score_sheets ADD COLUMN IF NOT EXISTS is_benchmark BOOLEAN DEFAULT FALSE;
    const isBenchmark = formData.get('is_benchmark') === 'true';

    if (!scoringSystem || !scoreDataStr) {
      return NextResponse.json(
        { message: 'Missing required fields' },
        { status: 400 }
      );
    }

    let scoreData;
    try {
      scoreData = JSON.parse(scoreDataStr);
    } catch {
      return NextResponse.json(
        { message: 'Invalid JSON in score_data' },
        { status: 400 }
      );
    }

    // Insert official score sheet
    const { data: sheet, error: sheetError } = await supabase
      .from('official_score_sheets')
      .insert({
        user_id: user.id,
        scoring_system: scoringSystem,
        score_data: scoreData,
        is_benchmark: isBenchmark,
      })
      .select()
      .single();

    if (sheetError || !sheet) {
      console.error('Sheet insert error:', sheetError);
      return NextResponse.json(
        { message: 'Failed to create score sheet' },
        { status: 500 }
      );
    }

    const sheetId = sheet.id;

    // Process uploaded images
    let imageCount = 0;
    for (let i = 0; i < 100; i++) {
      const file = formData.get(`file_${i}`) as File | null;
      if (!file) break;

      const imageType = formData.get(`file_${i}_type`) as string || '';

      try {
        // Generate unique file path
        const fileExt = file.name.split('.').pop() || 'jpg';
        const timestamp = Date.now();
        const fileName = `training-sheets/${sheetId}/${timestamp}_${i}.${fileExt}`;

        // Upload to Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('training-images')
          .upload(fileName, file, {
            contentType: file.type,
            upsert: false
          });

        if (uploadError) {
          console.error(`Image upload error for file ${i}:`, uploadError);
          continue;
        }

        // Get public URL
        const { data: urlData } = supabase.storage
          .from('training-images')
          .getPublicUrl(fileName);

        const imageUrl = urlData.publicUrl;

        // Insert image record
        const { error: imageError } = await supabase
          .from('official_score_images')
          .insert({
            sheet_id: sheetId,
            image_url: imageUrl,
            image_type: imageType
          });

        if (imageError) {
          console.error(`Image record error for file ${i}:`, imageError);
          continue;
        }

        imageCount++;
      } catch (error) {
        console.error(`Error processing file ${i}:`, error);
        continue;
      }
    }

    return NextResponse.json(
      {
        message: 'Training data imported successfully',
        sheet_id: sheetId,
        images_uploaded: imageCount
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Training import error:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
