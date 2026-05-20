-- Phase 11.5: record the first 30 chars of every post body so the generator
-- can avoid repeating openings.

alter table public.posts add column if not exists opening_snippet text;

update public.posts
set opening_snippet = left(content, 30)
where opening_snippet is null and content is not null;

create index if not exists idx_posts_opening_lookup
  on public.posts(ai_config_id, created_at desc)
  where opening_snippet is not null;
