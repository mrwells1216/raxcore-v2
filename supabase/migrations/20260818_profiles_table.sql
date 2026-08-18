-- public.profiles — required by every admin gate in the app.
--
-- This table was missing from a live database, and because every admin check
-- does `.from('profiles').select('is_admin')...single()`, a missing table made
-- that query error, left `profile` null, and returned 403 — so the entire
-- admin surface (training import, accuracy, benchmarks, supervision,
-- prompt-biases, seed-dataset) was silently unreachable rather than failing
-- loudly. Nothing in version control created it, so a fresh environment or a
-- restored project hits exactly the same wall.
--
-- Columns match the `Profile` interface in lib/types.ts, plus `role`, which
-- lib/structural-hypothesis/service.ts selects but which is absent from that
-- interface.
--
-- Every statement is guarded, so this is a clean no-op against a database
-- where the table has already been created by hand.

CREATE TABLE IF NOT EXISTS public.profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  is_admin     BOOLEAN NOT NULL DEFAULT FALSE,
  role         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- A user may only read and edit their own profile. Admin promotion is a
-- deliberate out-of-band action (SQL editor) and is never something the app
-- can grant itself.
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Auto-create a profile on signup. Without this, every new account lands with
-- no profile row and fails both the admin check and getProfile()
-- (lib/auth/actions.ts). SECURITY DEFINER so the insert is not blocked by the
-- RLS policies above.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'display_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill accounts created before this migration.
INSERT INTO public.profiles (id)
SELECT id FROM auth.users
ON CONFLICT (id) DO NOTHING;
