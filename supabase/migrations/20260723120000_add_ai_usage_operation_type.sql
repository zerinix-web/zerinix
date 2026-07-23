alter table public.ai_usage_events
add column if not exists operation_type text not null default 'chat'
  check (operation_type in ('chat', 'plan_report', 'market_report', 'pdf_export'));

update public.ai_usage_events
set operation_type = case
  when endpoint ilike '%market-analysis%' then 'market_report'
  when endpoint ilike '%plan%' then 'plan_report'
  when endpoint ilike '%pdf%' then 'pdf_export'
  when metadata->>'operation_type' in ('chat', 'plan_report', 'market_report', 'pdf_export')
    then metadata->>'operation_type'
  else 'chat'
end
where operation_type = 'chat';

create index if not exists ai_usage_events_user_operation_created_idx
  on public.ai_usage_events (user_id, operation_type, created_at desc);

create index if not exists ai_usage_events_operation_created_idx
  on public.ai_usage_events (operation_type, created_at desc);
