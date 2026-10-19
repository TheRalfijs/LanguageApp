-- Row Level Security on EVERY table, plus explicit grants.
--
-- Model: the browser (anon key) only READS its own rows. All writes that
-- matter (attempts, responses, purchases, grading) go through Netlify
-- Functions using the service role key, which bypasses RLS. The only thing a
-- user can write directly is their own locale / target level / exam date.

alter table public.profiles            enable row level security;
alter table public.items               enable row level security;
alter table public.attempts            enable row level security;
alter table public.responses           enable row level security;
alter table public.purchases           enable row level security;
alter table public.calibration_scripts enable row level security;
alter table public.ai_usage            enable row level security;
alter table public.rate_limits         enable row level security;
alter table public.withdrawal_requests enable row level security;

-- Supabase grants everything to anon/authenticated by default; start from zero.
revoke all on all tables in schema public from anon, authenticated;

-- Helper: is the current user an admin? security definer so it can read
-- profiles without recursing into the profiles policies.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false)
$$;

-- Server-only functions must not be callable through the API.
revoke execute on function public.bump_rate_limit(text, text, integer) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------- profiles
grant select on public.profiles to authenticated;
-- Column-level: users can never change is_admin (or id) themselves.
grant update (locale, target_level, exam_date) on public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ------------------------------------------------------------------- items
-- Users get items through functions (answer keys stripped). Admins manage directly.
grant select, insert, update, delete on public.items to authenticated;

create policy items_admin_all on public.items
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------- attempts
grant select on public.attempts to authenticated;

create policy attempts_select_own on public.attempts
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- --------------------------------------------------------------- responses
grant select on public.responses to authenticated;

-- Own responses only, and only once feedback is released.
create policy responses_select_own on public.responses
  for select to authenticated
  using (
    (select public.is_admin())
    or (
      released_at is not null
      and exists (
        select 1 from public.attempts a
        where a.id = responses.attempt_id and a.user_id = (select auth.uid())
      )
    )
  );

-- --------------------------------------------------------------- purchases
grant select on public.purchases to authenticated;

create policy purchases_select_own on public.purchases
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- ----------------------------------------------------- calibration_scripts
grant select, insert, update, delete on public.calibration_scripts to authenticated;

create policy calibration_admin_all on public.calibration_scripts
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------- ai_usage
grant select on public.ai_usage to authenticated;

create policy ai_usage_admin_select on public.ai_usage
  for select to authenticated
  using ((select public.is_admin()));

-- ------------------------------------------------------------- rate_limits
-- No grants, no policies: service role only.

-- ----------------------------------------------------- withdrawal_requests
grant select on public.withdrawal_requests to authenticated;

create policy withdrawals_select_own on public.withdrawal_requests
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
