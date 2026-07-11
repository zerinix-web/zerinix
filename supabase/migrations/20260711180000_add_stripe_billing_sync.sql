alter table public.user_billing_profiles
add column if not exists stripe_customer_id text,
add column if not exists stripe_subscription_id text,
add column if not exists stripe_subscription_status text,
add column if not exists stripe_price_id text,
add column if not exists stripe_current_period_end timestamptz,
add column if not exists stripe_cancel_at_period_end boolean not null default false,
add column if not exists stripe_checkout_session_id text,
add column if not exists stripe_portal_last_opened_at timestamptz;

create unique index if not exists user_billing_profiles_stripe_customer_unique
  on public.user_billing_profiles (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists user_billing_profiles_stripe_subscription_unique
  on public.user_billing_profiles (stripe_subscription_id)
  where stripe_subscription_id is not null;

create table if not exists public.stripe_invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_invoice_id text not null unique,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null default 'unknown',
  total_cents integer not null default 0,
  currency text not null default 'usd',
  hosted_invoice_url text,
  invoice_pdf_url text,
  period_start timestamptz,
  period_end timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

create index if not exists stripe_invoices_user_created_idx
  on public.stripe_invoices (user_id, created_at desc);

create index if not exists stripe_invoices_customer_idx
  on public.stripe_invoices (stripe_customer_id);

drop trigger if exists set_stripe_invoices_updated_at on public.stripe_invoices;
create trigger set_stripe_invoices_updated_at
before update on public.stripe_invoices
for each row
execute function public.set_updated_at();

alter table public.stripe_invoices enable row level security;
alter table public.stripe_webhook_events enable row level security;

drop policy if exists "Users can read own stripe invoices" on public.stripe_invoices;

create policy "Users can read own stripe invoices"
on public.stripe_invoices
for select
to authenticated
using (auth.uid() = user_id);

-- Webhook event idempotency is intentionally managed through server-only
-- service-role code. No client policies are granted for this table.
