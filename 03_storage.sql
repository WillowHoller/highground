-- =====================================================================================
-- HighGround database — part 3 of 4: file storage
--
-- district-files  (private)  uploads, attachments, generated reports
--   path: <district id>/<area>/<file>     area = imports | attachments | reports
--   read: district members · add: anyone who can plan or handle finance · delete: district admin
--   Files are never overwritten; a corrected file is a new upload.
-- district-public (public)   logos only, readable by anyone with the URL
--   path: <district id>/<file>            add/replace/delete: district admin
-- =====================================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('district-files', 'district-files', false, 52428800)                      -- 50 MB
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('district-public', 'district-public', true, 2097152,                        -- 2 MB
        array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy "hg members read files" on storage.objects for select to authenticated
  using (bucket_id = 'district-files'
         and public.is_member(public.try_uuid((storage.foldername(name))[1])));

create policy "hg writers add files" on storage.objects for insert to authenticated
  with check (bucket_id = 'district-files'
              and (storage.foldername(name))[2] in ('imports','attachments','reports')
              and (public.can_plan(public.try_uuid((storage.foldername(name))[1]))
                   or public.can_finance(public.try_uuid((storage.foldername(name))[1]))));

create policy "hg admins delete files" on storage.objects for delete to authenticated
  using (bucket_id = 'district-files'
         and public.is_district_admin(public.try_uuid((storage.foldername(name))[1])));

create policy "hg members see logos" on storage.objects for select to authenticated
  using (bucket_id = 'district-public'
         and public.is_member(public.try_uuid((storage.foldername(name))[1])));

create policy "hg admins add logos" on storage.objects for insert to authenticated
  with check (bucket_id = 'district-public'
              and public.is_district_admin(public.try_uuid((storage.foldername(name))[1])));

create policy "hg admins replace logos" on storage.objects for update to authenticated
  using (bucket_id = 'district-public'
         and public.is_district_admin(public.try_uuid((storage.foldername(name))[1])))
  with check (bucket_id = 'district-public'
              and public.is_district_admin(public.try_uuid((storage.foldername(name))[1])));

create policy "hg admins delete logos" on storage.objects for delete to authenticated
  using (bucket_id = 'district-public'
         and public.is_district_admin(public.try_uuid((storage.foldername(name))[1])));
