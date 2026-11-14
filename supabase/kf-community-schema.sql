-- KF Production community and studio features
-- Run once in Supabase SQL Editor. Safe to re-run.
create table if not exists public.kf_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  film_id text not null,
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, film_id)
);
create table if not exists public.kf_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  film_id text not null,
  body text not null check (char_length(body) between 2 and 1200),
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.kf_notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 120),
  body text not null default '' check (char_length(body) <= 600),
  film_id text,
  published boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.kf_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 24),
  avatar_url text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists kf_profiles_one_default on public.kf_profiles(user_id) where is_default;
create table if not exists public.kf_view_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  film_id text not null,
  seconds_watched integer not null default 0 check (seconds_watched >= 0),
  viewed_at timestamptz not null default now()
);
alter table public.kf_ratings enable row level security;
alter table public.kf_comments enable row level security;
alter table public.kf_notifications enable row level security;
alter table public.kf_profiles enable row level security;
alter table public.kf_view_events enable row level security;
drop policy if exists "Ratings are public" on public.kf_ratings;
create policy "Ratings are public" on public.kf_ratings for select to anon, authenticated using (true);
drop policy if exists "Users manage own ratings" on public.kf_ratings;
create policy "Users manage own ratings" on public.kf_ratings for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Visible comments are public" on public.kf_comments;
create policy "Visible comments are public" on public.kf_comments for select to anon, authenticated using (not is_hidden or (select public.is_kf_admin()));
drop policy if exists "Users add own comments" on public.kf_comments;
create policy "Users add own comments" on public.kf_comments for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users delete own comments or admins" on public.kf_comments;
create policy "Users delete own comments or admins" on public.kf_comments for delete to authenticated using (auth.uid() = user_id or (select public.is_kf_admin()));
drop policy if exists "Published notifications are public" on public.kf_notifications;
create policy "Published notifications are public" on public.kf_notifications for select to anon, authenticated using (published);
drop policy if exists "Admins manage notifications" on public.kf_notifications;
create policy "Admins manage notifications" on public.kf_notifications for all to authenticated using ((select public.is_kf_admin())) with check ((select public.is_kf_admin()));
drop policy if exists "Users manage own profiles" on public.kf_profiles;
create policy "Users manage own profiles" on public.kf_profiles for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users insert own view events" on public.kf_view_events;
create policy "Users insert own view events" on public.kf_view_events for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Admins read view events" on public.kf_view_events;
create policy "Admins read view events" on public.kf_view_events for select to authenticated using ((select public.is_kf_admin()));
grant select, insert, update, delete on public.kf_ratings, public.kf_comments, public.kf_profiles to authenticated;
grant select on public.kf_ratings, public.kf_comments, public.kf_notifications to anon;
grant select, insert, update, delete on public.kf_notifications to authenticated;
grant select, insert on public.kf_view_events to authenticated;

create or replace function public.kf_limit_profiles()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if (select count(*) from public.kf_profiles where user_id = new.user_id and id <> new.id) >= 5 then
    raise exception 'Можно создать не более 5 профилей.';
  end if;
  return new;
end;
$$;
drop trigger if exists kf_profiles_limit on public.kf_profiles;
create trigger kf_profiles_limit before insert or update on public.kf_profiles for each row execute function public.kf_limit_profiles();
-- Profile-specific library: preserve the existing data under each account's default profile.
alter table public.favorites add column if not exists profile_id uuid references public.kf_profiles(id) on delete cascade;
alter table public.watch_progress add column if not exists profile_id uuid references public.kf_profiles(id) on delete cascade;
insert into public.kf_profiles(user_id,name,is_default)
select u.id, 'Основной', true from auth.users u
where not exists (select 1 from public.kf_profiles p where p.user_id=u.id and p.is_default)
on conflict do nothing;
update public.favorites f set profile_id=p.id from public.kf_profiles p where p.user_id=f.user_id and p.is_default and f.profile_id is null;
update public.watch_progress w set profile_id=p.id from public.kf_profiles p where p.user_id=w.user_id and p.is_default and w.profile_id is null;
alter table public.favorites drop constraint if exists favorites_user_id_film_id_key;
alter table public.watch_progress drop constraint if exists watch_progress_user_id_film_id_key;
create unique index if not exists favorites_user_profile_film_unique on public.favorites(user_id,profile_id,film_id);
create unique index if not exists watch_progress_user_profile_film_unique on public.watch_progress(user_id,profile_id,film_id);

drop policy if exists "Visible comments are public" on public.kf_comments;
create policy "Visible comments are public" on public.kf_comments for select to anon, authenticated using (not is_hidden);
drop policy if exists "Admins read all comments" on public.kf_comments;
create policy "Admins read all comments" on public.kf_comments for select to authenticated using ((select public.is_kf_admin()));
drop policy if exists "Admins moderate comments" on public.kf_comments;
create policy "Admins moderate comments" on public.kf_comments for update to authenticated using ((select public.is_kf_admin())) with check ((select public.is_kf_admin()));

drop policy if exists "Users read own view events" on public.kf_view_events;
create policy "Users read own view events" on public.kf_view_events for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users update own view events" on public.kf_view_events;
create policy "Users update own view events" on public.kf_view_events for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant update on public.kf_view_events to authenticated;

drop policy if exists "Admins read user profiles" on public.profiles;
create policy "Admins read user profiles" on public.profiles for select to authenticated using ((select public.is_kf_admin()));
grant select on public.profiles to authenticated;
-- Additional indexes and least-privilege cleanup.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
create index if not exists favorites_profile_id_idx on public.favorites(profile_id);
create index if not exists watch_progress_profile_id_idx on public.watch_progress(profile_id);
create index if not exists kf_comments_user_id_idx on public.kf_comments(user_id);
create index if not exists kf_notifications_created_by_idx on public.kf_notifications(created_by);
create index if not exists kf_view_events_user_id_idx on public.kf_view_events(user_id);
create index if not exists kf_catalog_updated_by_idx on public.kf_catalog(updated_by);
-- Recommended lookup indexes and efficient ownership predicates.
create index if not exists kf_profiles_user_id_idx on public.kf_profiles(user_id);
create index if not exists kf_ratings_film_id_idx on public.kf_ratings(film_id);
create index if not exists kf_comments_film_created_idx on public.kf_comments(film_id,created_at desc);
create index if not exists kf_notifications_published_created_idx on public.kf_notifications(published,created_at desc);
create index if not exists kf_view_events_user_viewed_idx on public.kf_view_events(user_id,viewed_at desc);

drop policy if exists "Users manage own profiles" on public.kf_profiles;
create policy "Users manage own profiles" on public.kf_profiles for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users manage own ratings" on public.kf_ratings;
create policy "Users manage own ratings" on public.kf_ratings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users add own comments" on public.kf_comments;
create policy "Users add own comments" on public.kf_comments for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users delete own comments or admins" on public.kf_comments;
create policy "Users delete own comments or admins" on public.kf_comments for delete to authenticated
  using ((select auth.uid()) = user_id or (select public.is_kf_admin()));
drop policy if exists "Users insert own view events" on public.kf_view_events;
create policy "Users insert own view events" on public.kf_view_events for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users read own view events" on public.kf_view_events;
create policy "Users read own view events" on public.kf_view_events for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "Users update own view events" on public.kf_view_events;
create policy "Users update own view events" on public.kf_view_events for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);