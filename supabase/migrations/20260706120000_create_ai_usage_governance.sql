create extension if not exists "pgcrypto";

create table if not exists public.user_billing_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_tier text not null default 'free'
    check (plan_tier in ('free', 'pro', 'business')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  report_field text,
  prompt_hash text not null,
  model text not null,
  plan_tier text not null default 'free'
    check (plan_tier in ('free', 'pro', 'business')),
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  cache_hit boolean not null default false,
  status text not null default 'completed',
  response_time_ms integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_response_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cache_key text not null,
  prompt_hash text not null,
  endpoint text not null,
  report_field text,
  language text not null,
  model text not null,
  response_text text not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  hit_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  unique (user_id, cache_key)
);

create index if not exists ai_usage_events_user_created_idx
  on public.ai_usage_events (user_id, created_at desc);

create index if not exists ai_usage_events_endpoint_created_idx
  on public.ai_usage_events (endpoint, created_at desc);

create index if not exists ai_usage_events_prompt_hash_idx
  on public.ai_usage_events (prompt_hash);

create index if not exists ai_response_cache_user_key_idx
  on public.ai_response_cache (user_id, cache_key);

create index if not exists ai_response_cache_expires_idx
  on public.ai_response_cache (expires_at);

alter table public.user_billing_profiles enable row level security;
alter table public.ai_usage_events enable row level security;
alter table public.ai_response_cache enable row level security;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_billing_profiles_updated_at on public.user_billing_profiles;
create trigger set_user_billing_profiles_updated_at
before update on public.user_billing_profiles
for each row
execute function public.set_updated_at();

drop trigger if exists set_ai_response_cache_updated_at on public.ai_response_cache;
create trigger set_ai_response_cache_updated_at
before update on public.ai_response_cache
for each row
execute function public.set_updated_at();

drop policy if exists "Users can read own billing profile" on public.user_billing_profiles;
drop policy if exists "Users can create own billing profile" on public.user_billing_profiles;
drop policy if exists "Users can read own ai usage" on public.ai_usage_events;
drop policy if exists "Users can create own ai usage" on public.ai_usage_events;
drop policy if exists "Users can read own ai cache" on public.ai_response_cache;
drop policy if exists "Users can create own ai cache" on public.ai_response_cache;
drop policy if exists "Users can update own ai cache" on public.ai_response_cache;
drop policy if exists "Users can delete own ai cache" on public.ai_response_cache;

create policy "Users can read own billing profile"
on public.user_billing_profiles
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can create own billing profile"
on public.user_billing_profiles
for insert
to authenticated
with check (auth.uid() = user_id and plan_tier = 'free');

create policy "Users can read own ai usage"
on public.ai_usage_events
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can create own ai usage"
on public.ai_usage_events
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can read own ai cache"
on public.ai_response_cache
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can create own ai cache"
on public.ai_response_cache
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own ai cache"
on public.ai_response_cache
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own ai cache"
on public.ai_response_cache
for delete
to authenticated
using (auth.uid() = user_id);
