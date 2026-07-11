create table if not exists public.admin_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'owner', 'support')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_account_statuses (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended')),
  reason text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_roles_active_idx
  on public.admin_roles (active, role);

create index if not exists user_account_statuses_status_idx
  on public.user_account_statuses (status);

create index if not exists admin_audit_log_admin_created_idx
  on public.admin_audit_log (admin_user_id, created_at desc);

create index if not exists admin_audit_log_target_created_idx
  on public.admin_audit_log (target_user_id, created_at desc);

drop trigger if exists set_admin_roles_updated_at on public.admin_roles;
create trigger set_admin_roles_updated_at
before update on public.admin_roles
for each row
execute function public.set_updated_at();

drop trigger if exists set_user_account_statuses_updated_at on public.user_account_statuses;
create trigger set_user_account_statuses_updated_at
before update on public.user_account_statuses
for each row
execute function public.set_updated_at();

alter table public.admin_roles enable row level security;
alter table public.user_account_statuses enable row level security;
alter table public.admin_audit_log enable row level security;

drop policy if exists "Users can read own account status" on public.user_account_statuses;

create policy "Users can read own account status"
on public.user_account_statuses
for select
to authenticated
using (auth.uid() = user_id);

-- Admin role and audit tables are intentionally managed through server-only
-- service-role code. No broad client policies are granted here.
