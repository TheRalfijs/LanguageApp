-- Core schema. Run migrations in file-name order.
-- Conventions: text + CHECK instead of enums (easier to extend), timestamptz in UTC,
-- every table gets RLS in the next migration.

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, created by trigger on sign-up
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  locale       text not null default 'lv',
  target_level text not null default 'B1',
  exam_date    date,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint profiles_locale_format check (locale ~ '^[a-z]{2}$')
);

-- ---------------------------------------------------------------------------
-- items: practice/exam content. Only status = 'approved' is ever shown to users.
-- content_json is safe to send to the browser; answer_key_json never is.
-- ---------------------------------------------------------------------------
create table public.items (
  id              uuid primary key default gen_random_uuid(),
  exam_code       text not null,
  skill           text not null,
  task_type       text not null,
  content_json    jsonb not null,
  answer_key_json jsonb,
  audio_path      text,
  status          text not null default 'draft' check (status in ('draft', 'approved', 'rejected')),
  source          text not null default 'manual' check (source in ('manual', 'llm', 'seed')),
  review_note     text,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index items_lookup on public.items (exam_code, skill, task_type, status);

-- ---------------------------------------------------------------------------
-- attempts: one diagnostic / practice / mock / essay check session.
-- Anonymous attempts store a SHA-256 hash of the browser's anon token, never the token.
-- ---------------------------------------------------------------------------
create table public.attempts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users (id) on delete cascade,
  anon_token        text,
  mode              text not null check (mode in ('diagnostic', 'practice', 'mock', 'essay_check')),
  exam_code         text not null,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  skill_scores_json jsonb,
  constraint attempts_owner check (user_id is not null or anon_token is not null)
);
create index attempts_user on public.attempts (user_id, started_at desc);
create index attempts_anon on public.attempts (anon_token) where anon_token is not null;

-- ---------------------------------------------------------------------------
-- responses: one answer to one item. ai_output_json keeps the FULL grader
-- output (incl. prompt version) so calibration can be re-run later.
-- released_at: when the user may see the feedback (essay checks wait for
-- admin review while the calibration gate is closed).
-- ---------------------------------------------------------------------------
create table public.responses (
  id                uuid primary key default gen_random_uuid(),
  attempt_id        uuid not null references public.attempts (id) on delete cascade,
  item_id           uuid not null references public.items (id) on delete restrict,
  answer_json       jsonb,
  audio_path        text,
  transcript        text,
  ai_output_json    jsonb,
  score             numeric(6, 2),
  max_score         numeric(6, 2),
  grading_status    text not null default 'pending'
                    check (grading_status in ('pending', 'grading', 'graded', 'failed', 'not_needed')),
  reviewed_by_admin boolean not null default false,
  released_at       timestamptz,
  created_at        timestamptz not null default now(),
  graded_at         timestamptz
);
create index responses_attempt on public.responses (attempt_id);
create index responses_review_queue on public.responses (created_at) where reviewed_by_admin = false;

-- ---------------------------------------------------------------------------
-- purchases: written ONLY by the Stripe webhook / admin functions.
-- user_id is kept nullable so purchase records survive account deletion
-- (accounting law); the deletion function also hashes the email.
-- ---------------------------------------------------------------------------
create table public.purchases (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid references auth.users (id) on delete set null,
  email                 text not null,
  product               text not null check (product in ('founding_pass', 'essay_check', 'b1_30', 'b1_90')),
  amount_cents          integer not null check (amount_cents >= 0),
  currency              text not null default 'eur',
  stripe_session_id     text unique,
  stripe_payment_intent text,
  attempt_id            uuid references public.attempts (id) on delete set null,
  status                text not null default 'pending'
                        check (status in ('pending', 'paid', 'refunded', 'failed', 'expired')),
  access_until          timestamptz,
  withdrawal_waiver_at  timestamptz,
  created_at            timestamptz not null default now(),
  paid_at               timestamptz,
  refunded_at           timestamptz
);
create index purchases_user on public.purchases (user_id);
create index purchases_email on public.purchases (lower(email));

-- ---------------------------------------------------------------------------
-- calibration_scripts: teacher-marked scripts for checking the AI grader.
-- ---------------------------------------------------------------------------
create table public.calibration_scripts (
  id                  uuid primary key default gen_random_uuid(),
  exam_code           text not null,
  task_type           text not null,
  prompt_text         text,
  text                text not null,
  teacher_scores_json jsonb not null,
  ai_output_json      jsonb,
  agreement_ok        boolean,
  graded_at           timestamptz,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now()
);
create index calibration_lookup on public.calibration_scripts (exam_code, task_type);

-- ---------------------------------------------------------------------------
-- ai_usage: one row per paid API call (LLM, STT, TTS) for cost tracking.
-- ---------------------------------------------------------------------------
create table public.ai_usage (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users (id) on delete set null,
  anon_key   text,
  provider   text not null,
  model      text,
  operation  text not null,
  units      numeric(12, 2) not null default 0,
  unit_type  text,
  cost_eur   numeric(10, 5) not null default 0,
  metadata   jsonb,
  created_at timestamptz not null default now()
);
create index ai_usage_day on public.ai_usage (created_at);
create index ai_usage_user on public.ai_usage (user_id, created_at);

-- ---------------------------------------------------------------------------
-- rate_limits: per-key, per-bucket daily counters (key = user id or anon hash).
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  key    text not null,
  bucket text not null,
  day    date not null default (now() at time zone 'utc')::date,
  count  integer not null default 0,
  primary key (key, bucket, day)
);

-- ---------------------------------------------------------------------------
-- withdrawal_requests: "Atteikties no līguma" button (consumer withdrawal).
-- ---------------------------------------------------------------------------
create table public.withdrawal_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users (id) on delete set null,
  email       text not null,
  purchase_id uuid references public.purchases (id) on delete set null,
  message     text,
  created_at  timestamptz not null default now(),
  notified_at timestamptz,
  handled_at  timestamptz
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger items_updated_at before update on public.items
  for each row execute function public.set_updated_at();

-- New auth user → profile. Locale comes from signInWithOtp({ options: { data: { locale } } }).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  requested text := new.raw_user_meta_data ->> 'locale';
begin
  insert into public.profiles (id, locale)
  values (new.id, case when requested ~ '^[a-z]{2}$' then requested else 'lv' end);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Atomic daily counter. Returns true if the call is allowed (and counts it).
create or replace function public.bump_rate_limit(p_key text, p_bucket text, p_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  new_count integer;
begin
  insert into public.rate_limits (key, bucket, count)
  values (p_key, p_bucket, 1)
  on conflict (key, bucket, day) do update set count = public.rate_limits.count + 1
  where public.rate_limits.count < p_limit
  returning count into new_count;
  return new_count is not null;
end $$;
