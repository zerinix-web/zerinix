-- TASK #67A -- distributed, cross-instance-safe execution-ownership
-- coordination for expensive AI/provider work (initially: the Market
-- Intelligence full-report generation call). Purely additive: a new
-- table plus two new, narrowly scoped, service-role-only RPCs. No
-- existing table, column, policy, or function is altered.
--
-- This is intentionally NOT report_jobs: report_jobs is keyed by job
-- id / idempotency_key and is a durable, user-readable audit trail of
-- individual job attempts. This table instead coordinates ownership of
-- the underlying EXPENSIVE WORK by its canonical content fingerprint
-- (so two DIFFERENT report_jobs rows describing the same semantic
-- request -- e.g. from a double-click, each minted with its own,
-- always-unique reportRequestId -- can still recognize they are
-- equivalent). Rows are ephemeral: a row exists only while some
-- instance is actively (or believes it is) generating; it is deleted
-- the moment that attempt finishes, success or failure. Reuses this
-- codebase's own already-proven report_jobs lease pattern (lease_owner
-- + lease_expires_at + FOR-UPDATE-safe atomic claim, see
-- 20260731120000_create_report_jobs.sql) rather than inventing a new
-- coordination primitive.
create table if not exists public.ai_execution_claims (
  id uuid primary key default gen_random_uuid(),
  -- Namespaces this table for a specific kind of expensive work (e.g.
  -- 'market_intelligence_full_report'), so unrelated future callers can
  -- reuse this same mechanism without any risk of fingerprint collision
  -- across kinds.
  scope text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The canonical, deterministic, timestamp-free request identity
  -- (e.g. the existing fullReportCacheKey) -- same meaningful request
  -- always produces the same fingerprint; a different request always
  -- produces a different one. Already user-scoped via the user_id
  -- column above, so this table never dedupes across different users.
  fingerprint text not null,
  lease_owner text not null,
  lease_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint ai_execution_claims_scope_not_blank check (btrim(scope) <> ''),
  constraint ai_execution_claims_fingerprint_not_blank check (btrim(fingerprint) <> ''),
  constraint ai_execution_claims_lease_owner_not_blank check (btrim(lease_owner) <> '')
);

-- Unconditional (non-partial) unique index: required as the ON CONFLICT
-- arbiter for claim_ai_execution's single-statement atomic upsert below.
create unique index if not exists ai_execution_claims_scope_user_fingerprint_idx
  on public.ai_execution_claims (scope, user_id, fingerprint);

create index if not exists ai_execution_claims_lease_expires_at_idx
  on public.ai_execution_claims (lease_expires_at);

alter table public.ai_execution_claims enable row level security;

-- No policies are defined for anon/authenticated on purpose: this table
-- is a pure, ephemeral, server-only execution-ownership coordination
-- primitive, never user-facing data -- RLS with zero policies denies
-- ALL access to every role except service_role (which bypasses RLS
-- entirely) by default. Client code must never read or write this
-- table directly; only the two RPCs below, granted exclusively to
-- service_role, may touch it.
revoke all on table public.ai_execution_claims from anon, authenticated;
grant select, insert, update, delete on table public.ai_execution_claims to service_role;

comment on table public.ai_execution_claims is
  'Ephemeral, server-only distributed execution-ownership leases. Coordinates at most one concurrent expensive AI/provider execution per (scope, user_id, fingerprint) across serverless instances. Rows are deleted once the owning attempt finishes (success or failure); never exposed to client roles.';

create or replace function public.claim_ai_execution(
  p_scope text,
  p_user_id uuid,
  p_fingerprint text,
  p_worker_id text,
  p_lease_seconds integer
)
returns setof public.ai_execution_claims
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_scope is null or btrim(p_scope) = '' then
    raise exception 'p_scope is required' using errcode = '22023';
  end if;

  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22023';
  end if;

  if p_fingerprint is null or btrim(p_fingerprint) = '' then
    raise exception 'p_fingerprint is required' using errcode = '22023';
  end if;

  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'p_worker_id is required' using errcode = '22023';
  end if;

  if p_lease_seconds is null or p_lease_seconds < 1 then
    raise exception 'p_lease_seconds must be at least 1' using errcode = '22023';
  end if;

  -- Single atomic statement -- never a separate check-then-insert step.
  -- The INSERT succeeds normally (and RETURNING yields the new row)
  -- when no claim yet exists for this (scope, user_id, fingerprint). On
  -- a unique-constraint conflict, the DO UPDATE only takes effect --
  -- and therefore RETURNING only yields a row -- when the EXISTING
  -- row's lease has already expired (stale-owner recovery: a crashed
  -- instance's abandoned claim can always be reclaimed once its lease
  -- passes). If the existing row's lease is still live, the WHERE
  -- condition is false, no update happens, and this returns zero rows:
  -- the caller did not acquire ownership. Postgres resolves the
  -- unique-constraint conflict and the UPDATE's WHERE check as one
  -- atomic operation per row, so this is race-free under concurrent
  -- callers regardless of how many instances race it simultaneously.
  return query
  insert into public.ai_execution_claims as claim
    (scope, user_id, fingerprint, lease_owner, lease_expires_at)
  values
    (p_scope, p_user_id, p_fingerprint, p_worker_id, now() + make_interval(secs => p_lease_seconds))
  on conflict (scope, user_id, fingerprint) do update
    set lease_owner = p_worker_id,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    where claim.lease_expires_at <= now()
  returning claim.*;
end;
$$;

comment on function public.claim_ai_execution(text, uuid, text, text, integer) is
  'Atomically acquires (or, only once expired, steals) the execution lease for one (scope, user_id, fingerprint). Returns the claimed row on success; returns zero rows if another owner already holds a live lease. Never a check-then-insert race: one atomic INSERT ... ON CONFLICT ... DO UPDATE ... WHERE ... RETURNING statement.';

create or replace function public.release_ai_execution(
  p_scope text,
  p_user_id uuid,
  p_fingerprint text,
  p_worker_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.ai_execution_claims
  where scope = p_scope
    and user_id = p_user_id
    and fingerprint = p_fingerprint
    and lease_owner = p_worker_id;
end;
$$;

comment on function public.release_ai_execution(text, uuid, text, text) is
  'Releases the execution lease only while the caller still owns it (exact lease_owner match). A no-op if the lease already expired and was reclaimed by a newer owner, so a stale/late release can never delete a live owner''s claim, and can never permanently lock a fingerprint.';

revoke all on function public.claim_ai_execution(text, uuid, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.release_ai_execution(text, uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.claim_ai_execution(text, uuid, text, text, integer)
  to service_role;
grant execute on function public.release_ai_execution(text, uuid, text, text)
  to service_role;
