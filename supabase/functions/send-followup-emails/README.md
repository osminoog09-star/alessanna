# send-followup-emails

Edge function-отправщик автоматических писем клиентам.

## Что делает

Раз в минуту (через `pg_cron` + `pg_net.http_post`) забирает до 25 due-jobs из
таблицы `public.email_jobs` (см. миграцию `043_email_followup_jobs.sql`),
рендерит шаблон и отправляет через [Resend API](https://resend.com).

Шаблоны (RU):

- `confirmation` — сразу при создании записи.
- `reminder_24h` — за 24 часа до начала.
- `thank_you_followup` — через 24 часа после окончания.

Можно поменять провайдера (SendGrid, Postmark, Mailgun) — поправьте функцию
`sendOne()` в `index.ts`.

## Деплой

```bash
# 1. Логин и линковка проекта
supabase login
supabase link --project-ref eclrkusmwcrtnxqhzpky

# 2. Секреты (один раз)
supabase secrets set RESEND_API_KEY=re_xxx_your_key
supabase secrets set EMAIL_FROM='Alessanna <hello@alessannailu.com>'
supabase secrets set EMAIL_BCC=''                    # опц., копия себе
supabase secrets set PUBLIC_SITE_URL=https://alessannailu.com

# 3. Деплой
supabase functions deploy send-followup-emails --no-verify-jwt
```

## Активация cron-вызова (после деплоя)

В SQL Editor Supabase Studio:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'send-followup-emails-tick',
  '* * * * *',  -- каждую минуту
  $$
    select net.http_post(
      url := 'https://eclrkusmwcrtnxqhzpky.functions.supabase.co/send-followup-emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true),
        'Content-Type',  'application/json'
      ),
      body := '{}'
    );
  $$
);
```

## Тест

Создайте тестовую запись с client_email — в `public.email_jobs` должно
появиться 3 строки. Через минуту (или вручную: `curl -X POST ...`) первое
письмо должно уйти и `status` стать `sent`.

## Откат

```sql
select cron.unschedule('send-followup-emails-tick');
-- и при желании удалить таблицу:
-- drop trigger trg_appointments_generate_email_jobs on public.appointments;
-- drop trigger trg_appointments_cancel_email_jobs on public.appointments;
-- drop table public.email_jobs;
```
