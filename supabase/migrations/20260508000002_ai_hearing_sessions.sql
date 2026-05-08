-- ============================================================================
-- 20260508000002_ai_hearing_sessions.sql
-- Phase 5: AIヒアリングセッション
--
-- Schema reflects the production table. If columns differ, reconcile and
-- update src/lib/supabase/types.ts accordingly.
-- ============================================================================

create table if not exists public.ai_hearing_sessions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  status              text not null default 'in_progress'
                        check (status in ('in_progress', 'completed', 'abandoned')),
  industry            text,
  messages            jsonb not null default '[]'::jsonb,
  extracted_data      jsonb,
  finalized_prompt    text,
  current_step        integer not null default 0,
  ai_config_id        uuid references public.ai_configs(id) on delete set null,
  started_at          timestamptz not null default now(),
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists ai_hearing_sessions_user_idx
  on public.ai_hearing_sessions (user_id);
create index if not exists ai_hearing_sessions_user_status_idx
  on public.ai_hearing_sessions (user_id, status);

-- updated_at trigger
drop trigger if exists ai_hearing_sessions_set_updated_at on public.ai_hearing_sessions;
create trigger ai_hearing_sessions_set_updated_at
  before update on public.ai_hearing_sessions
  for each row execute procedure public.set_updated_at();

-- RLS
alter table public.ai_hearing_sessions enable row level security;

drop policy if exists "ai_hearing_sessions: own row select" on public.ai_hearing_sessions;
create policy "ai_hearing_sessions: own row select"
  on public.ai_hearing_sessions for select
  using (auth.uid() = user_id);

drop policy if exists "ai_hearing_sessions: own row insert" on public.ai_hearing_sessions;
create policy "ai_hearing_sessions: own row insert"
  on public.ai_hearing_sessions for insert
  with check (auth.uid() = user_id);

drop policy if exists "ai_hearing_sessions: own row update" on public.ai_hearing_sessions;
create policy "ai_hearing_sessions: own row update"
  on public.ai_hearing_sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "ai_hearing_sessions: own row delete" on public.ai_hearing_sessions;
create policy "ai_hearing_sessions: own row delete"
  on public.ai_hearing_sessions for delete
  using (auth.uid() = user_id);
