-- Canonical volunteer names and contacts must not be rewritten by MakLom profile updates.
-- Applied to production on 2026-10-12.
DROP TRIGGER IF EXISTS volunteers_sync_profile_to_core ON public.volunteers;
