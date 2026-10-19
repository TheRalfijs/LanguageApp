-- Diagnostic / practice flow support.

-- Which items an attempt was given (answers to other items are rejected) and
-- the UI language feedback should be written in.
alter table public.attempts
  add column plan_json jsonb,
  add column locale text not null default 'lv' check (locale ~ '^[a-z]{2}$');

-- One answer per item per attempt.
alter table public.responses
  add constraint responses_one_per_item unique (attempt_id, item_id);

-- Speaking answers exist before their audio is uploaded; grading start time
-- lets the status endpoint detect a grading run that died.
alter table public.responses
  drop constraint responses_grading_status_check,
  add constraint responses_grading_status_check
    check (grading_status in ('awaiting_upload', 'pending', 'grading', 'graded', 'failed', 'not_needed')),
  add column grading_started_at timestamptz;

create index responses_audio_age on public.responses (created_at) where audio_path is not null;
