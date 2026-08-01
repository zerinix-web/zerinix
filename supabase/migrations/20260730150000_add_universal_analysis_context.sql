begin;

alter table public.ai_conversations
add column if not exists analysis_context jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ai_conversations_analysis_context_object'
      and conrelid = 'public.ai_conversations'::regclass
  ) then
    alter table public.ai_conversations
    add constraint ai_conversations_analysis_context_object
    check (
      jsonb_typeof(analysis_context) = 'object'
      and octet_length(analysis_context::text) <= 65536
    );
  end if;
end;
$$;

comment on column public.ai_conversations.analysis_context is
  'User-owned universal input classification, attachment metadata, clarification answers, and report lifecycle state. Protected by the existing ai_conversations RLS policies.';

commit;
