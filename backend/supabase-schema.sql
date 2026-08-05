create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'user' check (role in ('user', 'owner', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null,
  slug text,
  status text not null default 'active' check (status in ('active', 'archived', 'deleted')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.models (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  asset_type text not null default 'gaussian_splatting' check (asset_type in ('mesh_3d', 'gaussian_splatting', 'point_cloud', 'orthomosaic')),
  name text not null,
  slug text,
  filename text not null,
  extension text not null,
  r2_key text not null,
  size_bytes bigint,
  status text not null default 'pending' check (status in ('uploading', 'pending', 'processing', 'published', 'rejected', 'archived')),
  is_demo boolean not null default false,
  progressive_load boolean not null default true,
  alpha_threshold numeric not null default 0,
  position jsonb,
  rotation jsonb,
  scale jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.models
  add column if not exists project_id uuid references public.projects(id) on delete cascade;

alter table public.models
  add column if not exists asset_type text not null default 'gaussian_splatting';

alter table public.models
  drop constraint if exists models_extension_check;

alter table public.models
  drop constraint if exists models_asset_type_check;

alter table public.models
  add constraint models_asset_type_check
  check (asset_type in ('mesh_3d', 'gaussian_splatting', 'point_cloud', 'orthomosaic'));

create table if not exists public.share_links (
  token text primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  model_ids uuid[] not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.access_logs (
  id uuid primary key default gen_random_uuid(),
  model_id uuid references public.models(id) on delete set null,
  viewer_id uuid references auth.users(id) on delete set null,
  share_token text references public.share_links(token) on delete set null,
  action text not null check (action in ('owner_view', 'share_view', 'owner_download')),
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.models enable row level security;
alter table public.share_links enable row level security;
alter table public.access_logs enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
on public.profiles for select
to authenticated
using (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Users can read own projects" on public.projects;
create policy "Users can read own projects"
on public.projects for select
to authenticated
using (auth.uid() = owner_id);

drop policy if exists "Users can create own projects" on public.projects;
create policy "Users can create own projects"
on public.projects for insert
to authenticated
with check (auth.uid() = owner_id);

drop policy if exists "Users can update own projects" on public.projects;
create policy "Users can update own projects"
on public.projects for update
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "Users can delete own projects" on public.projects;
create policy "Users can delete own projects"
on public.projects for delete
to authenticated
using (auth.uid() = owner_id);

drop policy if exists "Users can read own published or pending models" on public.models;
create policy "Users can read own published or pending models"
on public.models for select
to authenticated
using (auth.uid() = owner_id or is_demo = true);

drop policy if exists "Users can create own model records" on public.models;
create policy "Users can create own model records"
on public.models for insert
to authenticated
with check (auth.uid() = owner_id);

drop policy if exists "Users can update own unpublished model records" on public.models;
create policy "Users can update own unpublished model records"
on public.models for update
to authenticated
using (auth.uid() = owner_id and status <> 'published')
with check (auth.uid() = owner_id);

drop policy if exists "Users can delete own model records" on public.models;
create policy "Users can delete own model records"
on public.models for delete
to authenticated
using (auth.uid() = owner_id);

create index if not exists projects_owner_updated_idx on public.projects(owner_id, updated_at desc);
create index if not exists models_project_type_idx on public.models(project_id, asset_type);
create index if not exists models_owner_status_idx on public.models(owner_id, status);

drop policy if exists "Users can read own shares" on public.share_links;
create policy "Users can read own shares"
on public.share_links for select
to authenticated
using (auth.uid() = owner_id);

drop policy if exists "Users can create own shares" on public.share_links;
create policy "Users can create own shares"
on public.share_links for insert
to authenticated
with check (auth.uid() = owner_id);

drop policy if exists "Users can read own model access logs" on public.access_logs;
create policy "Users can read own model access logs"
on public.access_logs for select
to authenticated
using (
  exists (
    select 1 from public.models
    where models.id = access_logs.model_id
      and models.owner_id = auth.uid()
  )
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
