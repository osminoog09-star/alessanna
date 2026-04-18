-- Idempotent: bucket + storage policies for visitor chat attachments.
-- Дублирует блок из 023_support_chat.sql на случай, если миграция 023
-- применялась частично или bucket удаляли вручную.

insert into storage.buckets (id, name, public)
values ('support-attachments', 'support-attachments', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'support_attachments_insert'
  ) then
    create policy "support_attachments_insert"
      on storage.objects for insert
      to anon, authenticated
      with check (bucket_id = 'support-attachments');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'support_attachments_select'
  ) then
    create policy "support_attachments_select"
      on storage.objects for select
      to anon, authenticated
      using (bucket_id = 'support-attachments');
  end if;
end $$;
