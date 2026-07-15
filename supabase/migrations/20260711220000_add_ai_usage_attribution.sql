alter table public.ai_usage_events
add column if not exists report_id uuid,
add column if not exists conversation_id uuid,
add column if not exists report_request_id text;

do $$
begin
  alter table public.ai_usage_events
    add constraint ai_usage_events_report_id_fkey
    foreign key (report_id)
    references public.reports(id)
    on delete set null;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.ai_usage_events
    add constraint ai_usage_events_conversation_id_fkey
    foreign key (conversation_id)
    references public.ai_conversations(id)
    on delete set null;
exception
  when duplicate_object then null;
end $$;

create index if not exists ai_usage_events_report_created_idx
  on public.ai_usage_events (report_id, created_at desc)
  where report_id is not null;

create index if not exists ai_usage_events_conversation_created_idx
  on public.ai_usage_events (conversation_id, created_at desc)
  where conversation_id is not null;

create index if not exists ai_usage_events_report_request_idx
  on public.ai_usage_events (user_id, report_request_id)
  where report_request_id is not null;
