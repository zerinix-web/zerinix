create extension if not exists "pgcrypto";

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_conversations_title_not_empty check (length(trim(title)) > 0)
);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  content text not null default '',
  mode text,
  status text not null default 'complete',
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_messages_role_valid check (role in ('user', 'assistant')),
  constraint ai_messages_status_valid check (status in ('streaming', 'complete')),
  constraint ai_messages_mode_valid check (mode is null or mode in ('plan', 'market'))
);

create index if not exists ai_conversations_user_id_updated_at_idx
  on public.ai_conversations (user_id, updated_at desc);

create index if not exists ai_messages_user_conversation_created_at_idx
  on public.ai_messages (user_id, conversation_id, created_at asc);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

create or replace function public.set_ai_conversations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_ai_messages_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_ai_conversations_updated_at on public.ai_conversations;
drop trigger if exists set_ai_messages_updated_at on public.ai_messages;

create trigger set_ai_conversations_updated_at
before update on public.ai_conversations
for each row
execute function public.set_ai_conversations_updated_at();

create trigger set_ai_messages_updated_at
before update on public.ai_messages
for each row
execute function public.set_ai_messages_updated_at();

drop policy if exists "Users can read own AI conversations" on public.ai_conversations;
drop policy if exists "Users can insert own AI conversations" on public.ai_conversations;
drop policy if exists "Users can update own AI conversations" on public.ai_conversations;
drop policy if exists "Users can delete own AI conversations" on public.ai_conversations;

create policy "Users can read own AI conversations"
on public.ai_conversations
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own AI conversations"
on public.ai_conversations
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own AI conversations"
on public.ai_conversations
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own AI conversations"
on public.ai_conversations
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can read own AI messages" on public.ai_messages;
drop policy if exists "Users can insert own AI messages" on public.ai_messages;
drop policy if exists "Users can update own AI messages" on public.ai_messages;
drop policy if exists "Users can delete own AI messages" on public.ai_messages;

create policy "Users can read own AI messages"
on public.ai_messages
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own AI messages"
on public.ai_messages
for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.ai_conversations
    where ai_conversations.id = ai_messages.conversation_id
      and ai_conversations.user_id = auth.uid()
  )
);

create policy "Users can update own AI messages"
on public.ai_messages
for update
to authenticated
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.ai_conversations
    where ai_conversations.id = ai_messages.conversation_id
      and ai_conversations.user_id = auth.uid()
  )
);

create policy "Users can delete own AI messages"
on public.ai_messages
for delete
to authenticated
using (auth.uid() = user_id);
