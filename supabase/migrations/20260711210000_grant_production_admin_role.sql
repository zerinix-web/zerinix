begin;

create table if not exists public.admin_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'owner', 'support')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_roles enable row level security;
alter table public.admin_roles force row level security;

revoke all on table public.admin_roles from anon;
revoke all on table public.admin_roles from authenticated;

drop policy if exists "Admin roles are server managed" on public.admin_roles;

-- No client-side policy is granted. Admin role reads/writes are intentionally
-- performed only through server-side service-role code.

insert into public.admin_roles (user_id, role, active)
select id, 'owner', true
from auth.users
where lower(email) = 'admin@zerinix.com'
on conflict (user_id)
do update set
  role = excluded.role,
  active = true,
  updated_at = now();

commit;
