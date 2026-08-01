create table if not exists public.openai_cost_events (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null unique,
  request_id text not null,
  parent_request_id text,
  user_id uuid references auth.users(id) on delete set null,
  route text not null,
  report_type text not null default '',
  operation_name text not null,
  model text not null,
  response_id text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  reasoning_tokens integer not null default 0 check (reasoning_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  web_search_calls integer not null default 0 check (web_search_calls >= 0),
  estimated_input_cost_usd numeric(18,8) not null default 0,
  estimated_output_cost_usd numeric(18,8) not null default 0,
  estimated_tool_cost_usd numeric(18,8) not null default 0,
  estimated_total_cost_usd numeric(18,8) not null default 0,
  cache_savings_usd numeric(18,8) not null default 0,
  duration_ms integer not null default 0 check (duration_ms >= 0),
  retry_count integer not null default 0 check (retry_count >= 0),
  cache_status text not null check (cache_status in ('hit', 'miss', 'provider_cached')),
  status text not null check (status in ('completed', 'failed', 'incomplete', 'cache_hit')),
  error_message text,
  duplicate_fingerprint text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists openai_cost_events_request_idx
  on public.openai_cost_events (request_id, created_at);
create index if not exists openai_cost_events_user_idx
  on public.openai_cost_events (user_id, created_at desc);
create index if not exists openai_cost_events_model_stage_idx
  on public.openai_cost_events (model, operation_name, created_at desc);

create table if not exists public.openai_cost_summaries (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique,
  parent_request_id text,
  user_id uuid references auth.users(id) on delete set null,
  route text not null,
  report_type text not null default '',
  total_openai_calls integer not null default 0,
  total_tokens integer not null default 0,
  total_estimated_cost_usd numeric(18,8) not null default 0,
  cost_by_model jsonb not null default '{}'::jsonb,
  cost_by_pipeline_stage jsonb not null default '{}'::jsonb,
  cost_by_operation jsonb not null default '{}'::jsonb,
  most_expensive_step jsonb,
  duplicated_calls integer not null default 0,
  retry_cost_usd numeric(18,8) not null default 0,
  cache_savings_usd numeric(18,8) not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists openai_cost_summaries_user_idx
  on public.openai_cost_summaries (user_id, created_at desc);

alter table public.openai_cost_events enable row level security;
alter table public.openai_cost_summaries enable row level security;

drop policy if exists "Users read own OpenAI cost events" on public.openai_cost_events;
create policy "Users read own OpenAI cost events"
  on public.openai_cost_events for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users read own OpenAI cost summaries" on public.openai_cost_summaries;
create policy "Users read own OpenAI cost summaries"
  on public.openai_cost_summaries for select to authenticated
  using (auth.uid() = user_id);

comment on table public.openai_cost_events is
  'One immutable measurement row per OpenAI API call. Writes use the server service role; users may only read their own rows.';
comment on table public.openai_cost_summaries is
  'End-to-end OpenAI cost totals correlated by the root user request id.';
