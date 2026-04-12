-- Идемпотентно: можно выполнять повторно без ошибки 42710 (policy already exists).
-- Вставь это ПЕРЕД своим CREATE POLICY "Allow read staff".

drop policy if exists "Allow read staff" on public.staff;

create policy "Allow read staff"
  on public.staff
  for select
  using (true);

-- Если нужны только anon/authenticated, замени последнюю строку на:
-- to anon, authenticated
-- using (true);
