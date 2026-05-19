-- Phase 13: marketing-strategy columns on ai_configs + per-post strategic
-- intent and topic tags on posts.

alter table public.ai_configs
  add column if not exists monthly_goal text
    check (monthly_goal is null or monthly_goal in (
      'new_customers',
      'returning_customers',
      'weekday_visits',
      'higher_spend',
      'brand_awareness',
      'follower_growth'
    )),
  add column if not exists target_audience_preset text,
  add column if not exists target_audience_description text,
  add column if not exists recent_topics jsonb not null default '[]'::jsonb;

alter table public.posts
  add column if not exists strategic_intent text,
  add column if not exists topic_tags text[] not null default array[]::text[];

create index if not exists idx_posts_topic_tags on public.posts using gin(topic_tags);
