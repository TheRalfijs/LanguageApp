-- RLS / permission tests. Run via scripts/test-db.sh (local Postgres only).
\set ON_ERROR_STOP 1
grant all on all tables in schema public to service_role;

-- Fixtures (as superuser) ----------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'anna@example.com', '{"locale":"uk"}'),
  ('00000000-0000-0000-0000-00000000000b', 'boris@example.com', '{"locale":"bad-value"}'),
  ('00000000-0000-0000-0000-0000000000ad', 'admin@example.com', '{}');
update public.profiles set is_admin = true where id = '00000000-0000-0000-0000-0000000000ad';

insert into public.items (id, exam_code, skill, task_type, content_json, answer_key_json, status) values
  ('10000000-0000-0000-0000-000000000001', 'lv-b1', 'reading', 'reading_mcq', '{"q":"?"}', '{"correct":1}', 'approved'),
  ('10000000-0000-0000-0000-000000000002', 'lv-b1', 'writing', 'writing_short', '{"prompt":"?"}', null, 'approved');
insert into public.attempts (id, user_id, mode, exam_code) values
  ('20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'diagnostic', 'lv-b1'),
  ('20000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'diagnostic', 'lv-b1');
insert into public.attempts (id, anon_token, mode, exam_code) values
  ('20000000-0000-0000-0000-0000000000cc', 'hash-of-anon-token', 'diagnostic', 'lv-b1');
insert into public.responses (attempt_id, item_id, score, released_at) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 1, now()),
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', 5, null),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', 0, now());
insert into public.purchases (user_id, email, product, amount_cents, status) values
  ('00000000-0000-0000-0000-00000000000a', 'anna@example.com', 'founding_pass', 2900, 'paid'),
  ('00000000-0000-0000-0000-00000000000b', 'boris@example.com', 'essay_check', 500, 'paid');
insert into public.ai_usage (user_id, provider, operation, cost_eur) values
  ('00000000-0000-0000-0000-00000000000a', 'anthropic', 'grade_writing', 0.01);

-- Profile trigger ------------------------------------------------------------
do $$ begin
  assert (select locale from public.profiles where id = '00000000-0000-0000-0000-00000000000a') = 'uk', 'locale from metadata';
  assert (select locale from public.profiles where id = '00000000-0000-0000-0000-00000000000b') = 'lv', 'invalid locale → lv';
  assert (select count(*) from public.profiles) = 3, 'one profile per user';
end $$;

-- Anonymous visitor: sees nothing -------------------------------------------
set role anon;
do $$
declare t text;
begin
  foreach t in array array['profiles','items','attempts','responses','purchases','calibration_scripts','ai_usage','rate_limits','withdrawal_requests'] loop
    begin
      execute format('select count(*) from public.%I', t);
      raise exception 'anon could read %', t;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;
reset role;

-- User A ---------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select count(*) from public.profiles) = 1, 'A sees only own profile';
  assert (select count(*) from public.attempts) = 1, 'A sees only own attempts (not B, not anon)';
  assert (select count(*) from public.responses) = 1, 'A sees only own RELEASED responses';
  assert (select count(*) from public.purchases) = 1, 'A sees only own purchases';
  assert (select count(*) from public.items) = 0, 'non-admin sees no items directly';
  assert (select count(*) from public.ai_usage) = 0, 'non-admin sees no ai_usage';
  assert not public.is_admin(), 'A is not admin';
end $$;

-- A may change own locale …
update public.profiles set locale = 'en' where id = '00000000-0000-0000-0000-00000000000a';
-- … but not B's profile (silently 0 rows) …
update public.profiles set locale = 'en' where id = '00000000-0000-0000-0000-00000000000b';
-- … and never is_admin, never write attempts/purchases/responses.
do $$
declare stmt text;
begin
  foreach stmt in array array[
    $q$update public.profiles set is_admin = true where id = '00000000-0000-0000-0000-00000000000a'$q$,
    $q$insert into public.attempts (user_id, mode, exam_code) values ('00000000-0000-0000-0000-00000000000a', 'diagnostic', 'lv-b1')$q$,
    $q$update public.attempts set skill_scores_json = '{}' $q$,
    $q$insert into public.purchases (email, product, amount_cents) values ('x@x.lv', 'b1_90', 0)$q$,
    $q$update public.purchases set status = 'paid'$q$,
    $q$update public.responses set score = 100$q$,
    $q$delete from public.attempts$q$,
    $q$insert into public.items (exam_code, skill, task_type, content_json) values ('lv-b1','reading','x','{}')$q$,
    $q$select public.bump_rate_limit('k', 'b', 10)$q$
  ] loop
    begin
      execute stmt;
      raise exception 'A was allowed: %', stmt;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;
reset role;

do $$ begin
  assert (select locale from public.profiles where id = '00000000-0000-0000-0000-00000000000a') = 'en', 'A changed own locale';
  assert (select locale from public.profiles where id = '00000000-0000-0000-0000-00000000000b') = 'lv', 'B untouched';
  assert not (select is_admin from public.profiles where id = '00000000-0000-0000-0000-00000000000a'), 'A still not admin';
end $$;

-- Admin ----------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ad';
do $$ begin
  assert public.is_admin(), 'admin flag works';
  assert (select count(*) from public.items) = 2, 'admin sees items';
  assert (select count(*) from public.attempts) = 3, 'admin sees all attempts';
  assert (select count(*) from public.responses) = 3, 'admin sees all responses incl. unreleased';
  assert (select count(*) from public.purchases) = 2, 'admin sees all purchases';
  assert (select count(*) from public.ai_usage) = 1, 'admin sees ai_usage';
end $$;
insert into public.items (exam_code, skill, task_type, content_json) values ('lv-b1', 'reading', 'reading_mcq', '{}');
reset role;

-- Rate limit function (service side) -----------------------------------------
do $$ begin
  assert public.bump_rate_limit('user-a', 'grade', 2), '1st allowed';
  assert public.bump_rate_limit('user-a', 'grade', 2), '2nd allowed';
  assert not public.bump_rate_limit('user-a', 'grade', 2), '3rd blocked';
  assert public.bump_rate_limit('user-a', 'other', 2), 'other bucket independent';
  assert (select count from public.rate_limits where key = 'user-a' and bucket = 'grade') = 2, 'blocked call not counted';
end $$;

-- Deleting a user keeps purchases (accounting) but removes their attempts ----
delete from auth.users where id = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  assert (select count(*) from public.purchases where email = 'boris@example.com' and user_id is null) = 1, 'purchase kept, unlinked';
  assert (select count(*) from public.attempts where id = '20000000-0000-0000-0000-00000000000b') = 0, 'attempts deleted';
  assert (select count(*) from public.profiles where id = '00000000-0000-0000-0000-00000000000b') = 0, 'profile deleted';
end $$;

-- One answer per item per attempt; new grading status allowed ----------------
do $$ begin
  begin
    insert into public.responses (attempt_id, item_id) values
      ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001');
    raise exception 'duplicate answer was allowed';
  exception when unique_violation then null;
  end;
  insert into public.responses (attempt_id, item_id, grading_status) values
    ('20000000-0000-0000-0000-0000000000cc', '10000000-0000-0000-0000-000000000002', 'awaiting_upload');
end $$;

-- Storage buckets ------------------------------------------------------------
do $$ begin
  assert (select public from storage.buckets where id = 'speaking-audio') = false, 'recordings bucket private';
  assert (select public from storage.buckets where id = 'tts-cache') = true, 'tts bucket public';
end $$;

-- Every public table has RLS enabled -----------------------------------------
do $$ begin
  assert not exists (
    select 1 from pg_tables where schemaname = 'public' and not rowsecurity
  ), 'a public table is missing RLS';
end $$;

\echo 'ALL RLS TESTS PASSED'
