-- xRack 3D Render Tables
-- Phase 7/8: Render jobs and outputs storage

-- Render jobs table
CREATE TABLE IF NOT EXISTS public.render_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buck_id UUID NOT NULL REFERENCES public.bucks(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  settings JSONB DEFAULT '{}',
  progress_percent INTEGER DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Render outputs table (stores generated views/images)
CREATE TABLE IF NOT EXISTS public.render_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  render_job_id UUID NOT NULL REFERENCES public.render_jobs(id) ON DELETE CASCADE,
  view_type TEXT NOT NULL CHECK (view_type IN ('front', 'left', 'right', 'top', 'isometric')),
  image_url TEXT,
  thumbnail_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_render_jobs_buck_id ON public.render_jobs(buck_id);
CREATE INDEX IF NOT EXISTS idx_render_jobs_status ON public.render_jobs(status);
CREATE INDEX IF NOT EXISTS idx_render_jobs_created_at ON public.render_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_render_outputs_job_id ON public.render_outputs(render_job_id);

-- Enable Row Level Security
ALTER TABLE public.render_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.render_outputs ENABLE ROW LEVEL SECURITY;

-- RLS Policies (allow all for now, same as other tables)
CREATE POLICY "Allow all for render_jobs" ON public.render_jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for render_outputs" ON public.render_outputs FOR ALL USING (true) WITH CHECK (true);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_render_jobs_updated_at ON public.render_jobs;
CREATE TRIGGER update_render_jobs_updated_at BEFORE UPDATE ON public.render_jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add has_render column to bucks table for quick lookup
ALTER TABLE public.bucks ADD COLUMN IF NOT EXISTS has_render BOOLEAN DEFAULT false;

-- Create function to update has_render flag
CREATE OR REPLACE FUNCTION public.update_buck_has_render()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE public.bucks 
    SET has_render = true 
    WHERE id = NEW.buck_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Check if there are any remaining render jobs for this buck
    IF NOT EXISTS (SELECT 1 FROM public.render_jobs WHERE buck_id = OLD.buck_id AND id != OLD.id) THEN
      UPDATE public.bucks 
      SET has_render = false 
      WHERE id = OLD.buck_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger to maintain has_render flag
DROP TRIGGER IF EXISTS update_buck_has_render_on_render_job ON public.render_jobs;
CREATE TRIGGER update_buck_has_render_on_render_job
AFTER INSERT OR DELETE ON public.render_jobs
FOR EACH ROW EXECUTE FUNCTION public.update_buck_has_render();
