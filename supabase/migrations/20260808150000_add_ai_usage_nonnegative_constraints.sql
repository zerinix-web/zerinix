-- Security/cost-control hardening: ai_usage_events and ai_response_cache
-- both allow client-authenticated inserts/updates (auth.uid() = user_id),
-- but their token/cost columns had no non-negativity constraint. The
-- monthly AI quota check (app/lib/ai/governance.ts) sums
-- ai_usage_events.total_tokens per user per month -- a single row
-- inserted directly via the Supabase client with a large negative
-- total_tokens would drive that sum negative, making the computed
-- "remaining usage" unbounded and bypassing the paid-tier AI cost quota
-- for the rest of the billing month. Token counts and cost estimates
-- can never legitimately be negative in this application, so this
-- closes the gap with zero effect on any real write path. Mirrors the
-- same non-negativity checks already present on the newer
-- openai_cost_events table (20260801150000_create_openai_cost_instrumentation.sql).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_usage_events_prompt_tokens_nonnegative'
      and conrelid = 'public.ai_usage_events'::regclass
  ) then
    alter table public.ai_usage_events
    add constraint ai_usage_events_prompt_tokens_nonnegative
    check (prompt_tokens >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_usage_events_completion_tokens_nonnegative'
      and conrelid = 'public.ai_usage_events'::regclass
  ) then
    alter table public.ai_usage_events
    add constraint ai_usage_events_completion_tokens_nonnegative
    check (completion_tokens >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_usage_events_total_tokens_nonnegative'
      and conrelid = 'public.ai_usage_events'::regclass
  ) then
    alter table public.ai_usage_events
    add constraint ai_usage_events_total_tokens_nonnegative
    check (total_tokens >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_usage_events_estimated_cost_usd_nonnegative'
      and conrelid = 'public.ai_usage_events'::regclass
  ) then
    alter table public.ai_usage_events
    add constraint ai_usage_events_estimated_cost_usd_nonnegative
    check (estimated_cost_usd >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_response_cache_prompt_tokens_nonnegative'
      and conrelid = 'public.ai_response_cache'::regclass
  ) then
    alter table public.ai_response_cache
    add constraint ai_response_cache_prompt_tokens_nonnegative
    check (prompt_tokens >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_response_cache_completion_tokens_nonnegative'
      and conrelid = 'public.ai_response_cache'::regclass
  ) then
    alter table public.ai_response_cache
    add constraint ai_response_cache_completion_tokens_nonnegative
    check (completion_tokens >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_response_cache_total_tokens_nonnegative'
      and conrelid = 'public.ai_response_cache'::regclass
  ) then
    alter table public.ai_response_cache
    add constraint ai_response_cache_total_tokens_nonnegative
    check (total_tokens >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_response_cache_estimated_cost_usd_nonnegative'
      and conrelid = 'public.ai_response_cache'::regclass
  ) then
    alter table public.ai_response_cache
    add constraint ai_response_cache_estimated_cost_usd_nonnegative
    check (estimated_cost_usd >= 0);
  end if;
end $$;
