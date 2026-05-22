-- 2026-05-22:
--   1. Default max_post_length 280 → 140. JS .length counts CJK as 1 but
--      X's weighted counter counts CJK as 2, so a 280-char JP draft from
--      a 280-cap config consistently posted ~560 weighted units and X
--      rejected it with 403/422. 140 leaves headroom for hashtags + URLs
--      even under the weighted model. Existing rows keep their value —
--      this only affects newly-created configs.
--   2. Per-config image_generation_enabled toggle. Defaults TRUE because
--      images are the differentiating feature, but lets users opt out
--      (or fall back to text-only if they run out of Gemini quota and
--      don't want any further image attempts).

alter table public.ai_configs
  alter column max_post_length set default 140;

alter table public.ai_configs
  add column if not exists image_generation_enabled boolean not null default true;
