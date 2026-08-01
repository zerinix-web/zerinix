-- Bind request-triggered workers to the exact job created by that request.
-- The existing claim_report_job RPC remains the FIFO drain/restart path.
create or replace function public.claim_report_job_by_id(
  job_id uuid,
  worker_id text,
  lease_seconds integer
)
returns setof public.report_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if job_id is null then
    raise exception 'job_id is required' using errcode = '22023';
  end if;

  if worker_id is null or btrim(worker_id) = '' then
    raise exception 'worker_id is required' using errcode = '22023';
  end if;

  if lease_seconds is null or lease_seconds < 1 then
    raise exception 'lease_seconds must be at least 1' using errcode = '22023';
  end if;

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
  where exhausted.id = job_id
    and exhausted.status in (
      'claimed',
      'extracting',
      'researching',
      'validating',
      'generating',
      'rendering_pdf'
    )
    and exhausted.lease_expires_at <= now()
    and exhausted.attempt_count >= exhausted.max_attempts;

  return query
  with candidate as (
    select job.id
    from public.report_jobs as job
    where job.id = job_id
      and job.attempt_count < job.max_attempts
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
    for update skip locked
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

comment on function public.claim_report_job_by_id(uuid, text, integer) is
  'Atomically leases only the requested report job. Concurrent workers cannot substitute or duplicate another queued job; expired leases remain restartable.';

revoke all on function public.claim_report_job_by_id(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_report_job_by_id(uuid, text, integer)
  to service_role;
