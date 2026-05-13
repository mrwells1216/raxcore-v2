-- Admin Training Import Tables
-- Stores official score sheets, associated images, and error decomposition
-- Used for human-in-the-loop training data collection and model refinement

-- Create official score sheet table (BC = Boone & Crockett, PY = Pope & Young)
create table if not exists official_score_sheets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  scoring_system text not null,  -- e.g. 'BC' or 'PY'
  score_data jsonb not null,     -- official measurements from score sheet
  created_at timestamp with time zone default now()
);

-- Create images associated with a score sheet
create table if not exists official_score_images (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid references official_score_sheets(id) on delete cascade,
  image_url text not null,
  image_type text,               -- e.g. 'live', 'mounted', 'side', etc.
  uploaded_at timestamp with time zone default now()
);

-- Optional: store error decomposition (difference between AI and official)
create table if not exists score_errors (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid references official_score_sheets(id) on delete cascade,
  errors jsonb not null,         -- e.g. {"main_beam_left": -1.2, ...}
  created_at timestamp with time zone default now()
);

-- Indexes for efficient querying
create index if not exists idx_official_score_sheets_user_id on official_score_sheets(user_id);
create index if not exists idx_official_score_sheets_created_at on official_score_sheets(created_at desc);
create index if not exists idx_official_score_sheets_scoring_system on official_score_sheets(scoring_system);

create index if not exists idx_official_score_images_sheet_id on official_score_images(sheet_id);
create index if not exists idx_official_score_images_uploaded_at on official_score_images(uploaded_at desc);

create index if not exists idx_score_errors_sheet_id on score_errors(sheet_id);
create index if not exists idx_score_errors_created_at on score_errors(created_at desc);

-- Enable RLS on all tables
alter table official_score_sheets enable row level security;
alter table official_score_images enable row level security;
alter table score_errors enable row level security;

-- RLS policies: Only admins and the user who created the sheet can view/edit
create policy "official_score_sheets_admin_select" 
  on official_score_sheets for select 
  using (exists(select 1 from profiles where id = auth.uid() and is_admin = true)
         or user_id = auth.uid());

create policy "official_score_sheets_admin_insert" 
  on official_score_sheets for insert 
  with check (exists(select 1 from profiles where id = auth.uid() and is_admin = true));

create policy "official_score_sheets_admin_update" 
  on official_score_sheets for update 
  using (exists(select 1 from profiles where id = auth.uid() and is_admin = true));

create policy "official_score_sheets_admin_delete" 
  on official_score_sheets for delete 
  using (exists(select 1 from profiles where id = auth.uid() and is_admin = true));

-- Images inherit access from parent sheet
create policy "official_score_images_select" 
  on official_score_images for select 
  using (exists(select 1 from official_score_sheets oss 
         where oss.id = sheet_id 
         and (exists(select 1 from profiles where id = auth.uid() and is_admin = true)
              or oss.user_id = auth.uid())));

create policy "official_score_images_insert" 
  on official_score_images for insert 
  with check (exists(select 1 from official_score_sheets oss 
             where oss.id = sheet_id 
             and exists(select 1 from profiles where id = auth.uid() and is_admin = true)));

create policy "official_score_images_delete" 
  on official_score_images for delete 
  using (exists(select 1 from official_score_sheets oss 
         where oss.id = sheet_id 
         and exists(select 1 from profiles where id = auth.uid() and is_admin = true)));

-- Errors inherit access from parent sheet
create policy "score_errors_select" 
  on score_errors for select 
  using (exists(select 1 from official_score_sheets oss 
         where oss.id = sheet_id 
         and (exists(select 1 from profiles where id = auth.uid() and is_admin = true)
              or oss.user_id = auth.uid())));

create policy "score_errors_insert" 
  on score_errors for insert 
  with check (exists(select 1 from official_score_sheets oss 
             where oss.id = sheet_id 
             and exists(select 1 from profiles where id = auth.uid() and is_admin = true)));
