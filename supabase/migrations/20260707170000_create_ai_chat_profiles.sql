create table if not exists public.ai_chat_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferred_country text,
  preferred_industries text[] not null default '{}'::text[],
  investment_budget_ranges text[] not null default '{}'::text[],
  preferred_language text,
  experience_level text,
  available_time text,
  business_interests text[] not null default '{}'::text[],
  risk_tolerance text,
  long_term_goals text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_chat_profiles enable row level security;

create or replace function public.set_ai_chat_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_ai_chat_profiles_updated_at on public.ai_chat_profiles;

create trigger set_ai_chat_profiles_updated_at
before update on public.ai_chat_profiles
for each row
execute function public.set_ai_chat_profiles_updated_at();

drop policy if exists "Users can read own AI chat profile" on public.ai_chat_profiles;
drop policy if exists "Users can insert own AI chat profile" on public.ai_chat_profiles;
drop policy if exists "Users can update own AI chat profile" on public.ai_chat_profiles;
drop policy if exists "Users can delete own AI chat profile" on public.ai_chat_profiles;

create policy "Users can read own AI chat profile"
on public.ai_chat_profiles
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own AI chat profile"
on public.ai_chat_profiles
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own AI chat profile"
on public.ai_chat_profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own AI chat profile"
on public.ai_chat_profiles
for delete
to authenticated
using (auth.uid() = user_id);
