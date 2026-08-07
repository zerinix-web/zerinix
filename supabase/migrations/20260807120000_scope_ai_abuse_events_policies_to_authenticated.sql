-- Security hardening: the original ai_abuse_events policies
-- (20260723140000_create_ai_abuse_events.sql) omitted `to authenticated`,
-- so they defaulted to PUBLIC (anon + authenticated) unlike every other
-- per-user table in this schema. Not practically exploitable today --
-- `auth.uid() = user_id` still evaluates to NULL (not TRUE) for an anon
-- session, and `user_id` is NOT NULL -- but tightening for consistency
-- and defense-in-depth.
drop policy if exists "Users can insert own ai abuse events" on public.ai_abuse_events;
drop policy if exists "Users can read own ai abuse events" on public.ai_abuse_events;

create policy "Users can insert own ai abuse events"
  on public.ai_abuse_events
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can read own ai abuse events"
  on public.ai_abuse_events
  for select
  to authenticated
  using (auth.uid() = user_id);
