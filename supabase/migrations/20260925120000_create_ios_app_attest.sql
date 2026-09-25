-- App Store Guideline 2.1 -- self-service registration for the iOS app,
-- without opening the web private beta.
--
-- WHY A DATABASE AT ALL: the iOS shell loads the same origin as the website,
-- so nothing the client SAYS about its platform can be trusted -- a browser
-- can say the same thing. The only server-verifiable native signal Apple
-- offers is App Attest, and verifying it needs two pieces of durable
-- server-side state that a serverless instance cannot hold in memory:
--
--   1. the single-use challenges this server issued, so an attestation or
--      assertion cannot be captured and replayed, and
--   2. the public key of each attested device key plus its sign counter, so a
--      cloned or rolled-back key stops working.
--
-- Both tables are service-role only, following this repo's existing
-- ai_execution_claims pattern: RLS on, zero policies, explicit revokes. They
-- are never user-facing data and client code must never touch them.

create table if not exists public.ios_attestation_challenges (
  challenge text primary key,
  -- Namespaces a challenge to the operation it was issued for, so a challenge
  -- minted for key attestation can never be spent on a registration.
  purpose text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint ios_attestation_challenges_purpose_not_blank check (btrim(purpose) <> ''),
  constraint ios_attestation_challenges_challenge_not_blank check (btrim(challenge) <> '')
);

create index if not exists ios_attestation_challenges_expires_at_idx
  on public.ios_attestation_challenges (expires_at);

alter table public.ios_attestation_challenges enable row level security;
revoke all on table public.ios_attestation_challenges from anon, authenticated;
grant select, insert, update, delete on table public.ios_attestation_challenges to service_role;

comment on table public.ios_attestation_challenges is
  'Single-use, short-lived App Attest challenges. A row exists only between being issued and being spent; consuming one deletes it, which is what makes an attestation or assertion non-replayable.';

create table if not exists public.ios_attested_keys (
  -- Apple's key identifier: the SHA-256 of the attested public key.
  key_id text primary key,
  public_key_pem text not null,
  -- Monotonic. Apple increments it on every assertion, so a decrease or
  -- repeat means a replay or a cloned key.
  sign_count bigint not null default 0,
  -- 'production' or 'development'. Recorded so a development attestation can
  -- never be mistaken for a real device in a production deployment.
  environment text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  constraint ios_attested_keys_sign_count_nonnegative check (sign_count >= 0),
  constraint ios_attested_keys_environment_known check (environment in ('production', 'development'))
);

alter table public.ios_attested_keys enable row level security;
revoke all on table public.ios_attested_keys from anon, authenticated;
grant select, insert, update, delete on table public.ios_attested_keys to service_role;

comment on table public.ios_attested_keys is
  'One row per App Attest key that this server has verified against Apple''s root CA. Holds the device public key and its monotonic sign counter; never exposed to client roles.';

-- BUG FIX found in audit: consume only ever deletes the row it successfully
-- spends, so a challenge that is issued and never used -- the normal outcome
-- of any abandoned or failed registration attempt -- stayed in the table
-- forever. Left alone that is unbounded growth, and a cheap way for anyone to
-- inflate storage at the rate challenge issuance allows. Purging expired rows
-- here, in the same statement that issues the next one, keeps the table
-- self-limiting without a scheduled job: the cleanup happens exactly where
-- the growth comes from. The expires_at index makes it cheap.
create or replace function public.issue_ios_attestation_challenge(
  p_challenge text,
  p_purpose text,
  p_ttl_seconds integer
)
returns setof public.ios_attestation_challenges
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_challenge is null or btrim(p_challenge) = '' then
    raise exception 'p_challenge is required' using errcode = '22023';
  end if;

  if p_purpose is null or btrim(p_purpose) = '' then
    raise exception 'p_purpose is required' using errcode = '22023';
  end if;

  if p_ttl_seconds is null or p_ttl_seconds < 1 then
    raise exception 'p_ttl_seconds must be at least 1' using errcode = '22023';
  end if;

  delete from public.ios_attestation_challenges where expires_at <= now();

  return query
  insert into public.ios_attestation_challenges (challenge, purpose, expires_at)
  values (p_challenge, p_purpose, now() + make_interval(secs => p_ttl_seconds))
  returning *;
end;
$$;

comment on function public.issue_ios_attestation_challenge(text, text, integer) is
  'Issues one challenge and purges every expired one in the same call, so the table stays bounded without a scheduled job. The challenge value itself is generated by the application from a CSPRNG, never here.';

-- Issue and consume are separate so the consume step can be a single atomic
-- statement. DELETE ... RETURNING is what makes a challenge single-use: two
-- concurrent requests racing the same challenge cannot both get a row back,
-- because only one DELETE can remove it.
create or replace function public.consume_ios_attestation_challenge(
  p_challenge text,
  p_purpose text
)
returns setof public.ios_attestation_challenges
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_challenge is null or btrim(p_challenge) = '' then
    raise exception 'p_challenge is required' using errcode = '22023';
  end if;

  if p_purpose is null or btrim(p_purpose) = '' then
    raise exception 'p_purpose is required' using errcode = '22023';
  end if;

  return query
  delete from public.ios_attestation_challenges
  where challenge = p_challenge
    and purpose = p_purpose
    and expires_at > now()
  returning *;
end;
$$;

comment on function public.consume_ios_attestation_challenge(text, text) is
  'Atomically spends one unexpired challenge for the given purpose. Returns the row on success and zero rows if it was already spent, expired, or minted for a different purpose. Never a check-then-delete race.';

-- The counter guard. Expressed as a conditional UPDATE so the comparison and
-- the write are one statement: two assertions replayed concurrently cannot
-- both observe the old counter and both succeed.
create or replace function public.record_ios_attested_assertion(
  p_key_id text,
  p_sign_count bigint
)
returns setof public.ios_attested_keys
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_key_id is null or btrim(p_key_id) = '' then
    raise exception 'p_key_id is required' using errcode = '22023';
  end if;

  if p_sign_count is null or p_sign_count < 0 then
    raise exception 'p_sign_count must be non-negative' using errcode = '22023';
  end if;

  return query
  update public.ios_attested_keys as stored
     set sign_count = p_sign_count,
         last_used_at = now()
   where stored.key_id = p_key_id
     and p_sign_count > stored.sign_count
  returning stored.*;
end;
$$;

comment on function public.record_ios_attested_assertion(text, bigint) is
  'Atomically advances an attested key''s sign counter, and only ever forwards. Returns the updated row on success; zero rows if the key is unknown or the counter did not increase (a replayed assertion or a cloned key).';

revoke all on function public.issue_ios_attestation_challenge(text, text, integer)
  from public, anon, authenticated;
revoke all on function public.consume_ios_attestation_challenge(text, text)
  from public, anon, authenticated;
revoke all on function public.record_ios_attested_assertion(text, bigint)
  from public, anon, authenticated;

grant execute on function public.issue_ios_attestation_challenge(text, text, integer) to service_role;
grant execute on function public.consume_ios_attestation_challenge(text, text) to service_role;
grant execute on function public.record_ios_attested_assertion(text, bigint) to service_role;
