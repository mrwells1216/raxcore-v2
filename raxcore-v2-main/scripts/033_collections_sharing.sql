-- Phase 33: Collections, Saved Searches, and Sharing Tables

-- ============================================
-- 1. SAVED SEARCHES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.saved_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saved_searches_user_all" ON saved_searches;
CREATE POLICY "saved_searches_user_all" ON saved_searches 
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_saved_searches_user_id ON saved_searches(user_id);

-- ============================================
-- 2. COLLECTIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_shared BOOLEAN DEFAULT FALSE,
  share_token TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE collections ENABLE ROW LEVEL SECURITY;

-- Owner can do everything with their collections
DROP POLICY IF EXISTS "collections_owner_all" ON collections;
CREATE POLICY "collections_owner_all" ON collections 
  FOR ALL USING (auth.uid() = user_id);

-- Public can read shared collections
DROP POLICY IF EXISTS "collections_shared_read" ON collections;
CREATE POLICY "collections_shared_read" ON collections 
  FOR SELECT USING (is_shared = true);

CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections(user_id);
CREATE INDEX IF NOT EXISTS idx_collections_share_token ON collections(share_token);

-- ============================================
-- 3. COLLECTION BUCKS (MANY-TO-MANY)
-- ============================================
CREATE TABLE IF NOT EXISTS public.collection_bucks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  buck_id UUID NOT NULL REFERENCES bucks(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(collection_id, buck_id)
);

ALTER TABLE collection_bucks ENABLE ROW LEVEL SECURITY;

-- Access via collection ownership or shared status
DROP POLICY IF EXISTS "collection_bucks_access" ON collection_bucks;
CREATE POLICY "collection_bucks_access" ON collection_bucks 
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM collections 
      WHERE id = collection_id 
      AND (auth.uid() = user_id OR is_shared = true)
    )
  );

CREATE INDEX IF NOT EXISTS idx_collection_bucks_collection_id ON collection_bucks(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_bucks_buck_id ON collection_bucks(buck_id);

-- ============================================
-- 4. BUCK SHARES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.buck_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buck_id UUID NOT NULL REFERENCES bucks(id) ON DELETE CASCADE UNIQUE,
  share_token TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT TRUE,
  show_real_score BOOLEAN DEFAULT FALSE,
  show_measurements BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE buck_shares ENABLE ROW LEVEL SECURITY;

-- Owner can manage their buck shares
DROP POLICY IF EXISTS "buck_shares_owner" ON buck_shares;
CREATE POLICY "buck_shares_owner" ON buck_shares 
  FOR ALL USING (
    EXISTS (SELECT 1 FROM bucks WHERE id = buck_id AND auth.uid() = user_id)
  );

-- Public can read active shares
DROP POLICY IF EXISTS "buck_shares_public_read" ON buck_shares;
CREATE POLICY "buck_shares_public_read" ON buck_shares 
  FOR SELECT USING (is_active = true);

CREATE INDEX IF NOT EXISTS idx_buck_shares_share_token ON buck_shares(share_token);
CREATE INDEX IF NOT EXISTS idx_buck_shares_buck_id ON buck_shares(buck_id);

-- ============================================
-- 5. UPDATE TIMESTAMP TRIGGERS
-- ============================================
DROP TRIGGER IF EXISTS saved_searches_updated_at ON saved_searches;
CREATE TRIGGER saved_searches_updated_at
  BEFORE UPDATE ON saved_searches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS collections_updated_at ON collections;
CREATE TRIGGER collections_updated_at
  BEFORE UPDATE ON collections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS buck_shares_updated_at ON buck_shares;
CREATE TRIGGER buck_shares_updated_at
  BEFORE UPDATE ON buck_shares
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
