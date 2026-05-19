-- Phase 12: Storage bucket for user-uploaded and AI-generated images.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user-media',
  'user-media',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "user_media public read" on storage.objects;
create policy "user_media public read" on storage.objects
  for select using (bucket_id = 'user-media');

drop policy if exists "user_media owner insert" on storage.objects;
create policy "user_media owner insert" on storage.objects
  for insert with check (
    bucket_id = 'user-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "user_media owner update" on storage.objects;
create policy "user_media owner update" on storage.objects
  for update using (
    bucket_id = 'user-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "user_media owner delete" on storage.objects;
create policy "user_media owner delete" on storage.objects
  for delete using (
    bucket_id = 'user-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
