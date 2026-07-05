create extension if not exists "pgcrypto";

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid()
);

alter table public.ai_conversations
add column if not exists user_id uuid references auth.users(id) on delete cascade,
add column if not exists title text not null default 'New conversation',
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid()
);

alter table public.ai_messages
add column if not exists conversation_id uuid references public.ai_conversations(id) on delete cascade,
add column if not exists user_id uuid references auth.users(id) on delete cascade,
add column if not exists role text not null default 'user',
add column if not exists content text not null default '',
add column if not exists mode text,
add column if not exists status text not null default 'complete',
add column if not exists attachments jsonb not null default '[]'::jsonb,
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

delete from public.ai_messages
where conversation_id is null
   or user_id is null
   or role is null
   or status is null;

delete from public.ai_conversations
where user_id is null
   or title is null
   or length(trim(title)) = 0;

alter table public.ai_conversations
alter column user_id set not null,
alter column title set not null,
alter column created_at set not null,
alter column updated_at set not null;

alter table public.ai_messages
alter column conversation_id set not null,
alter column user_id set not null,
alter column role set not null,
alter column content set not null,
alter column status set not null,
alter column attachments set not null,
alter column created_at set not null,
alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_conversations_title_not_empty'
      and conrelid = 'public.ai_conversations'::regclass
  ) then
    alter table public.ai_conversations
    add constraint ai_conversations_title_not_empty
    check (length(trim(title)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_messages_role_valid'
      and conrelid = 'public.ai_messages'::regclass
  ) then
    alter table public.ai_messages
    add constraint ai_messages_role_valid
    check (role in ('user', 'assistant'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_messages_status_valid'
      and conrelid = 'public.ai_messages'::regclass
  ) then
    alter table public.ai_messages
    add constraint ai_messages_status_valid
    check (status in ('streaming', 'complete'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_messages_mode_valid'
      and conrelid = 'public.ai_messages'::regclass
  ) then
    alter table public.ai_messages
    add constraint ai_messages_mode_valid
    check (mode is null or mode in ('plan', 'market'));
  end if;
end;
$$;

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
