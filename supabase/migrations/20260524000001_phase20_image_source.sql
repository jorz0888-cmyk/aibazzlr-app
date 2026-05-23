-- 2026-05-24: per-config image_source 3-way enum.
--
-- Replaces the boolean image_generation_enabled (kept for now as
-- deprecated — a follow-up migration drops it once code stops
-- reading the boolean column).
--
-- Values:
--   'library_only'  → only uploaded photos; never call Gemini
--   'ai_only'       → only Gemini-generated; ignore uploaded photos
--   'both'          → upload → fall back to Gemini (status quo for
--                     image_generation_enabled = true)
--
-- Backfill:
--   image_generation_enabled = true  → image_source = 'both'
--   image_generation_enabled = false → image_source = 'library_only'
--
-- CHECK uses ANY(array[...]) to match existing constraint style and
-- be permissive at write time only when the value is in the set
-- (lessons from status / posting_frequency 23514 incidents: the
-- write path must always provide a valid enum literal, never null).

alter table public.ai_configs
  add column if not exists image_source text not null
    default 'both'
    check (image_source = any (array['library_only', 'ai_only', 'both']));

-- Backfill existing rows. The DEFAULT 'both' already applied to all
-- rows on the ADD COLUMN above, so we only need to flip the OFF
-- ones to 'library_only'.
update public.ai_configs
set image_source = 'library_only'
where image_generation_enabled = false;
