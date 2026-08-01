create extension if not exists "pgcrypto";

create table public.report_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued',
  progress integer not null default 0,
  progress_stage text,
  request_payload jsonb not null,
  result_payload jsonb,
  report_id uuid references public.reports(id) on delete set null,
  error_code text,
  error_message text,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  next_attempt_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  constraint report_jobs_status_valid check (
    status in (
      'queued',
      'claimed',
      'extracting',
      'researching',
      'validating',
      'generating',
      'rendering_pdf',
      'completed',
      'retry_wait',
      'failed',
      'cancelled'
    )
  ),
  constraint report_jobs_progress_valid check (progress between 0 and 100),
  constraint report_jobs_attempt_count_valid check (attempt_count >= 0),
  constraint report_jobs_max_attempts_valid check (max_attempts >= 1),
  constraint report_jobs_request_payload_valid check (
    jsonb_typeof(request_payload) = 'object'
  ),
  constraint report_jobs_result_payload_valid check (
    result_payload is null or jsonb_typeof(result_payload) = 'object'
  ),
  constraint report_jobs_lease_valid check (
    (lease_owner is null and lease_expires_at is null)
    or (lease_owner is not null and lease_expires_at is not null)
  ),
  constraint report_jobs_completed_valid check (
    status <> 'completed'
    or (
      progress = 100
      and result_payload is not null
      and completed_at is not null
    )
  ),
  constraint report_jobs_failed_valid check (
    status <> 'failed' or failed_at is not null
  ),
  constraint report_jobs_cancelled_valid check (
    status <> 'cancelled' or cancelled_at is not null
  )
);

create index report_jobs_user_created_at_idx
  on public.report_jobs (user_id, created_at desc);

create index report_jobs_status_next_attempt_at_idx
  on public.report_jobs (status, next_attempt_at);

create index report_jobs_lease_expires_at_idx
  on public.report_jobs (lease_expires_at)
  where lease_expires_at is not null;

create index report_jobs_idempotency_key_idx
  on public.report_jobs (idempotency_key)
  where idempotency_key is not null;

create index report_jobs_report_id_idx
  on public.report_jobs (report_id)
  where report_id is not null;

create unique index report_jobs_active_user_idempotency_key_idx
  on public.report_jobs (user_id, idempotency_key)
  where idempotency_key is not null
    and status not in ('completed', 'failed', 'cancelled');

create or replace function public.set_report_jobs_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_report_jobs_updated_at
before update on public.report_jobs
for each row
execute function public.set_report_jobs_updated_at();

alter table public.report_jobs enable row level security;

create policy "Users can insert own queued report jobs"
on public.report_jobs
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and status = 'queued'
  and progress = 0
  and progress_stage is null
  and result_payload is null
  and report_id is null
  and error_code is null
  and error_message is null
  and attempt_count = 0
  and max_attempts = 3
  and next_attempt_at is null
  and lease_owner is null
  and lease_expires_at is null
  and started_at is null
  and completed_at is null
  and failed_at is null
  and cancelled_at is null
);

create policy "Users can read own report jobs"
on public.report_jobs
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can cancel own pending report jobs"
on public.report_jobs
for update
to authenticated
using (
  (select auth.uid()) = user_id
  and status in ('queued', 'retry_wait')
)
with check (
  (select auth.uid()) = user_id
  and status = 'cancelled'
  and cancelled_at is not null
  and lease_owner is null
  and lease_expires_at is null
);

-- RLS controls row ownership. Column grants additionally prevent authenticated
-- clients from writing worker-owned status, lease, result, error, retry, or audit
-- fields. Status is updateable only so the cancellation policy can move a pending
-- job to cancelled; the policy rejects every other target status.
revoke all on table public.report_jobs from anon, authenticated;
grant select on table public.report_jobs to authenticated;
grant insert (user_id, request_payload, idempotency_key)
  on public.report_jobs to authenticated;
grant update (status, cancelled_at)
  on public.report_jobs to authenticated;

-- The service role is reserved for trusted workers and bypasses RLS. Explicit
-- table privileges document that workers own claiming, progress, retries, results,
-- errors, and terminal status transitions.
grant select, insert, update, delete
  on table public.report_jobs to service_role;

comment on table public.report_jobs is
  'Durable asynchronous report jobs. Authenticated users may enqueue and read their own jobs; trusted service-role workers own execution state.';

comment on column public.report_jobs.lease_owner is
  'Unique identifier for the worker process that currently owns the job lease.';

comment on column public.report_jobs.lease_expires_at is
  'Lease fencing deadline. Worker mutations are rejected after this timestamp, allowing stale jobs to be reclaimed.';

comment on column public.report_jobs.next_attempt_at is
  'Earliest time a queued or retry_wait job may be claimed.';

create or replace function public.claim_report_job(
  worker_id text,
  lease_seconds integer
)
returns setof public.report_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if worker_id is null or btrim(worker_id) = '' then
    raise exception 'worker_id is required' using errcode = '22023';
  end if;

  if lease_seconds is null or lease_seconds < 1 then
    raise exception 'lease_seconds must be at least 1' using errcode = '22023';
  end if;

  -- Expired jobs that have no attempts left cannot be reclaimed. Terminate them
  -- before selecting another job so they do not remain indefinitely in an active
  -- status after a worker crash.
  update public.report_jobs as exhausted
  set
    status = 'failed',
    error_code = coalesce(exhausted.error_code, 'LEASE_EXPIRED'),
    error_message = coalesce(
      exhausted.error_message,
      'The report job lease expired after the maximum number of attempts.'
    ),
    next_attempt_at = null,
    lease_owner = null,
    lease_expires_at = null,
    failed_at = coalesce(exhausted.failed_at, now())
  where exhausted.status in (
      'claimed',
      'extracting',
      'researching',
      'validating',
      'generating',
      'rendering_pdf'
    )
    and exhausted.lease_expires_at <= now()
    and exhausted.attempt_count >= exhausted.max_attempts;

  -- FOR UPDATE SKIP LOCKED makes competing workers skip the same candidate. The
  -- row lock and UPDATE execute in one transaction, so exactly one caller receives
  -- a particular lease. Expired active leases are eligible for stale recovery.
  return query
  with candidate as (
    select job.id
    from public.report_jobs as job
    where job.attempt_count < job.max_attempts
      and (
        (
          job.status in ('queued', 'retry_wait')
          and (job.next_attempt_at is null or job.next_attempt_at <= now())
        )
        or (
          job.status in (
            'claimed',
            'extracting',
            'researching',
            'validating',
            'generating',
            'rendering_pdf'
          )
          and job.lease_expires_at <= now()
        )
      )
    order by coalesce(job.next_attempt_at, job.created_at), job.created_at
    for update skip locked
    limit 1
  )
  update public.report_jobs as job
  set
    status = 'claimed',
    progress_stage = 'claimed',
    attempt_count = job.attempt_count + 1,
    next_attempt_at = null,
    lease_owner = worker_id,
    lease_expires_at = now() + make_interval(secs => lease_seconds),
    started_at = coalesce(job.started_at, now())
  from candidate
  where job.id = candidate.id
  returning job.*;
end;
$$;

comment on function public.claim_report_job(text, integer) is
  'Atomically leases one eligible job with FOR UPDATE SKIP LOCKED, increments its attempt count, and recovers expired leases.';

create or replace function public.renew_report_job_lease(
  job_id uuid,
  worker_id text,
  lease_seconds integer
)
returns public.report_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  renewed_job public.report_jobs;
begin
  if worker_id is null or btrim(worker_id) = '' then
    raise exception 'worker_id is required' using errcode = '22023';
  end if;

  if lease_seconds is null or lease_seconds < 1 then
    raise exception 'lease_seconds must be at least 1' using errcode = '22023';
  end if;

  update public.report_jobs as job
  set lease_expires_at = now() + make_interval(secs => lease_seconds)
  where job.id = job_id
    and job.lease_owner = worker_id
    and job.lease_expires_at > now()
    and job.status in (
      'claimed',
      'extracting',
      'researching',
      'validating',
      'generating',
      'rendering_pdf'
    )
  returning job.* into renewed_job;

  if renewed_job.id is null then
    raise exception 'job lease is missing, expired, or owned by another worker'
      using errcode = '55000';
  end if;

  return renewed_job;
end;
$$;

comment on function public.renew_report_job_lease(uuid, text, integer) is
  'Renews only an unexpired active lease owned by the calling worker; stale workers cannot resurrect expired leases.';

create or replace function public.complete_report_job(
  job_id uuid,
  worker_id text,
  result_payload jsonb,
  report_id uuid
)
returns public.report_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  completed_job public.report_jobs;
begin
  if result_payload is null or jsonb_typeof(result_payload) <> 'object' then
    raise exception 'result_payload must be a JSON object'
      using errcode = '22023';
  end if;

  if report_id is null then
    raise exception 'report_id is required' using errcode = '22023';
  end if;

  update public.report_jobs as job
  set
    status = 'completed',
    progress = 100,
    progress_stage = 'completed',
    result_payload = complete_report_job.result_payload,
    report_id = complete_report_job.report_id,
    error_code = null,
    error_message = null,
    next_attempt_at = null,
    lease_owner = null,
    lease_expires_at = null,
    completed_at = coalesce(job.completed_at, now())
  where job.id = job_id
    and job.lease_owner = worker_id
    and job.lease_expires_at > now()
    and job.status in (
      'claimed',
      'extracting',
      'researching',
      'validating',
      'generating',
      'rendering_pdf'
    )
  returning job.* into completed_job;

  if completed_job.id is null then
    raise exception 'job lease is missing, expired, or owned by another worker'
      using errcode = '55000';
  end if;

  return completed_job;
end;
$$;

comment on function public.complete_report_job(uuid, text, jsonb, uuid) is
  'Completes a job only while the caller owns a live lease, stores the report result, and clears lease and error state.';

create or replace function public.fail_report_job(
  job_id uuid,
  worker_id text,
  error_code text,
  error_message text,
  retry_delay_seconds integer
)
returns public.report_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  failed_job public.report_jobs;
begin
  if retry_delay_seconds is null or retry_delay_seconds < 0 then
    raise exception 'retry_delay_seconds must be zero or greater'
      using errcode = '22023';
  end if;

  update public.report_jobs as job
  set
    status = case
      when job.attempt_count < job.max_attempts then 'retry_wait'
      else 'failed'
    end,
    progress_stage = case
      when job.attempt_count < job.max_attempts then 'retry_wait'
      else 'failed'
    end,
    error_code = fail_report_job.error_code,
    error_message = fail_report_job.error_message,
    next_attempt_at = case
      when job.attempt_count < job.max_attempts then
        now() + make_interval(
          secs => least(
            3600,
            retry_delay_seconds * (2 ^ greatest(job.attempt_count - 1, 0))
          )
        )
      else null
    end,
    lease_owner = null,
    lease_expires_at = null,
    failed_at = case
      when job.attempt_count >= job.max_attempts then
        coalesce(job.failed_at, now())
      else job.failed_at
    end
  where job.id = job_id
    and job.lease_owner = worker_id
    and job.lease_expires_at > now()
    and job.status in (
      'claimed',
      'extracting',
      'researching',
      'validating',
      'generating',
      'rendering_pdf'
    )
  returning job.* into failed_job;

  if failed_job.id is null then
    raise exception 'job lease is missing, expired, or owned by another worker'
      using errcode = '55000';
  end if;

  return failed_job;
end;
$$;

comment on function public.fail_report_job(uuid, text, text, text, integer) is
  'Schedules exponential retry_wait while attempts remain; otherwise records terminal failure. Lease and original audit timestamps are preserved or cleared appropriately.';

create or replace function public.update_report_job_progress(
  job_id uuid,
  worker_id text,
  status text,
  progress integer,
  progress_stage text
)
returns public.report_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_job public.report_jobs;
begin
  if status not in (
    'claimed',
    'extracting',
    'researching',
    'validating',
    'generating',
    'rendering_pdf'
  ) then
    raise exception 'status is not an active worker status'
      using errcode = '22023';
  end if;

  if progress is null or progress < 0 or progress > 99 then
    raise exception 'active job progress must be between 0 and 99'
      using errcode = '22023';
  end if;

  update public.report_jobs as job
  set
    status = update_report_job_progress.status,
    progress = update_report_job_progress.progress,
    progress_stage = update_report_job_progress.progress_stage
  where job.id = job_id
    and job.lease_owner = worker_id
    and job.lease_expires_at > now()
    and job.status in (
      'claimed',
      'extracting',
      'researching',
      'validating',
      'generating',
      'rendering_pdf'
    )
  returning job.* into updated_job;

  if updated_job.id is null then
    raise exception 'job lease is missing, expired, or owned by another worker'
      using errcode = '55000';
  end if;

  return updated_job;
end;
$$;

comment on function public.update_report_job_progress(uuid, text, text, integer, text) is
  'Updates only non-terminal execution stages while the caller owns a live lease. Completion and failure require their dedicated RPCs.';

revoke all on function public.claim_report_job(text, integer)
  from public, anon, authenticated;
revoke all on function public.renew_report_job_lease(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_report_job(uuid, text, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.fail_report_job(uuid, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.update_report_job_progress(uuid, text, text, integer, text)
  from public, anon, authenticated;

grant execute on function public.claim_report_job(text, integer)
  to service_role;
grant execute on function public.renew_report_job_lease(uuid, text, integer)
  to service_role;
grant execute on function public.complete_report_job(uuid, text, jsonb, uuid)
  to service_role;
grant execute on function public.fail_report_job(uuid, text, text, text, integer)
  to service_role;
grant execute on function public.update_report_job_progress(uuid, text, text, integer, text)
  to service_role;
