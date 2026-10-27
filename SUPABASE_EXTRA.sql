-- Run this once in Supabase > SQL Editor > New query.
-- Adds video duration so "Continue watching" can show progress bars.
alter table public.watch_progress
  add column if not exists duration_seconds double precision not null default 0
  check (duration_seconds >= 0);
