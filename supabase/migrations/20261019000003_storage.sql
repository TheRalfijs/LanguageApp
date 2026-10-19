-- Storage buckets.
--
-- tts-cache       public read. Generated item audio (listening questions,
--                 speaking prompts). File names are content hashes, so audio is
--                 generated once and served from the CDN forever.
-- speaking-audio  PRIVATE. User recordings at <attempt_id>/<response_id>.<ext>.
--                 Uploads use signed upload URLs issued by a function, playback
--                 uses short-lived signed URLs. Deleted after 30 days (step 10).
--
-- No storage.objects policies are created for anon/authenticated: only the
-- service role (Netlify Functions) reads or writes these buckets. Public
-- buckets are readable via their public URL without a policy.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('tts-cache', 'tts-cache', true, 5242880, array['audio/mpeg']),
  ('speaking-audio', 'speaking-audio', false, 10485760,
   array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-m4a', 'audio/aac'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
