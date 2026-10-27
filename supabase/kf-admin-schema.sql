-- KF Production admin migration. Run in Supabase SQL Editor.
create table if not exists public.kf_catalog (
  id text primary key,
  payload jsonb not null,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.kf_catalog enable row level security;
revoke all on public.kf_catalog from anon, authenticated;
grant select on public.kf_catalog to anon, authenticated;
drop policy if exists "Public can read KF catalog" on public.kf_catalog;
create policy "Public can read KF catalog" on public.kf_catalog
  for select to anon, authenticated using (true);
drop policy if exists "KF admins manage catalog" on public.kf_catalog;
create policy "KF admins manage catalog" on public.kf_catalog
  for all to authenticated using ((select public.is_kf_admin()))
  with check ((select public.is_kf_admin()));

create or replace function public.kf_list_admins()
returns table(user_id uuid, created_at timestamptz)
language plpgsql security definer stable set search_path = ''
as $$
begin
  if not coalesce((select public.is_kf_admin()), false) then
    raise exception 'Нет прав администратора';
  end if;
  return query select a.user_id, a.created_at from public.kf_admins a order by a.created_at;
end;
$$;

create or replace function public.kf_add_admin(target_user_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not coalesce((select public.is_kf_admin()), false) then
    raise exception 'Нет прав администратора';
  end if;
  if not exists (select 1 from auth.users u where u.id = target_user_id) then
    raise exception 'Пользователь не найден в Auth';
  end if;
  insert into public.kf_admins(user_id) values(target_user_id) on conflict(user_id) do nothing;
end;
$$;

create or replace function public.kf_remove_admin(target_user_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not coalesce((select public.is_kf_admin()), false) then
    raise exception 'Нет прав администратора';
  end if;
  if target_user_id = (select auth.uid()) then
    raise exception 'Нельзя снять собственные права';
  end if;
  delete from public.kf_admins where user_id = target_user_id;
end;
$$;

revoke all on function public.kf_list_admins() from public, anon;
revoke all on function public.kf_add_admin(uuid) from public, anon;
revoke all on function public.kf_remove_admin(uuid) from public, anon;
grant execute on function public.kf_list_admins() to authenticated;
grant execute on function public.kf_add_admin(uuid) to authenticated;
grant execute on function public.kf_remove_admin(uuid) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('kf-media', 'kf-media', true, 83886080, array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm'])
on conflict (id) do update set public = true, file_size_limit = 83886080,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm'];

drop policy if exists "KF admins upload media" on storage.objects;
create policy "KF admins upload media" on storage.objects for insert to authenticated
  with check (bucket_id = 'kf-media' and (select public.is_kf_admin()));
drop policy if exists "KF admins update media" on storage.objects;
create policy "KF admins update media" on storage.objects for update to authenticated
  using (bucket_id = 'kf-media' and (select public.is_kf_admin()))
  with check (bucket_id = 'kf-media' and (select public.is_kf_admin()));
drop policy if exists "KF admins delete media" on storage.objects;
create policy "KF admins delete media" on storage.objects for delete to authenticated
  using (bucket_id = 'kf-media' and (select public.is_kf_admin()));
