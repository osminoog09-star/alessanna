-- 055_activity_log_and_consent.sql
-- ============================================================================
-- Аудит-логи, cookie-согласия и версионированные правовые документы.
--
-- ЗАЧЕМ.
--   1. Сейчас в БД нет ни одной таблицы, куда падали бы события «кто, когда,
--      откуда что-то сделал». Если завтра у клиента уплыла бронь, или у
--      сотрудника пропал доступ, восстановить «как это случилось» можно
--      только глазами в логах PostgREST/Vite, и то лишь по горячим следам.
--      Бизнес попросил полные логи действий с фильтрацией по сотруднику и
--      по клиенту (через cookie_id), плюс IP и устройство.
--
--   2. Публичный сайт сейчас не запрашивает у посетителя cookie-согласие.
--      Требование GDPR (и эстонского KKM-ka): нужно показать баннер с
--      категориями (essential / analytics / marketing) и сохранить выбор
--      пользователя (с версией политики, IP и user-agent на момент клика).
--
--   3. Тексты политики конфиденциальности и cookie-политики раньше нигде
--      не хранились. Делаем versioned-таблицу, чтобы:
--        – в любой момент можно показать клиенту актуальную версию;
--        – согласие пользователя привязано к конкретной версии;
--        – при правке политики можно перепросить согласие.
--
-- ЧТО СОЗДАЁТСЯ.
--   • activity_log         — универсальный аудит-лог. RLS «всё закрыто»,
--                             доступ только через RPC. Поля: actor_kind,
--                             actor_id (для staff), client_cookie_id (для
--                             посетителей сайта), action, resource_*,
--                             ip_address, user_agent, meta jsonb.
--   • cookie_consents      — каждое нажатие «Принять» или «Только обяза-
--                             тельные». Содержит cookie_id, версию полити-
--                             ки, выбранные категории, IP, UA, время.
--   • legal_documents      — версионированные тексты privacy/cookie/terms
--                             на ru/et. Anon может читать только активную
--                             версию (is_active=true).
--
-- НОВЫЕ RPC.
--   • _log_activity(...)               — internal helper, вызываем из RPC.
--   • client_log_activity(cookie, …)   — публичный, для script.js.
--                                         Rate-limit 50 событий/час/cookie.
--   • client_record_consent(cookie,…)  — фиксирует выбор куки-баннера,
--                                         параллельно пишет в activity_log.
--   • staff_my_activity(actor_id, …)   — staff читает свою историю.
--   • staff_admin_activity(...)        — admin/manager читает чужие логи
--                                         (по actor_id ИЛИ по cookie_id).
--   • legal_get_active(kind, lang)     — публичный, отдаёт активную версию
--                                         документа (privacy/cookie/terms).
--
-- ОБНОВЛЕНИЯ.
--   • staff_login дополнен вызовами _log_activity на ключевые исходы:
--     ok (PIN/trusted/salon/legacy), invalid_pin, pin_locked, requires_pin,
--     access_denied, и при успешной выдаче нового trusted-токена.
--   • Сидим стартовые тексты privacy/cookie на ru и et (можно перепи-
--     сать через legal_publish позже).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) activity_log
-- ----------------------------------------------------------------------------

create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_kind text not null
    check (actor_kind in ('staff','client','anon','system')),
  /* Для staff-событий — public.staff.id. */
  actor_id uuid,
  /* Для публичных посетителей — стабильный cookie_id из localStorage
   * (UUIDv4 строкой). На прод-сайте создаётся в cookie-banner.js при
   * первом визите и хранится в localStorage["alessanna.client.cookieId"]. */
  client_cookie_id text,
  action text not null,
  resource_type text,
  resource_id text,
  ip_address inet,
  user_agent text,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists activity_log_actor_id_idx
  on public.activity_log (actor_id, occurred_at desc)
  where actor_id is not null;
create index if not exists activity_log_cookie_idx
  on public.activity_log (client_cookie_id, occurred_at desc)
  where client_cookie_id is not null;
create index if not exists activity_log_action_idx
  on public.activity_log (action, occurred_at desc);
create index if not exists activity_log_occurred_at_idx
  on public.activity_log (occurred_at desc);

comment on table public.activity_log is
  'Универсальный аудит-лог: staff и публичные клиенты. Доступ только через RPC.';

alter table public.activity_log enable row level security;
drop policy if exists activity_log_no_direct on public.activity_log;
create policy activity_log_no_direct on public.activity_log
  for all to anon, authenticated
  using (false) with check (false);

-- ----------------------------------------------------------------------------
-- 2) cookie_consents
-- ----------------------------------------------------------------------------

create table if not exists public.cookie_consents (
  id bigint generated always as identity primary key,
  cookie_id text not null,
  policy_version text not null,
  /* 'essential','analytics','marketing'. essential нельзя «отключить» —
   * он всегда в массиве, иначе сайт не работает. */
  categories text[] not null default '{}'::text[],
  ip_address inet,
  user_agent text,
  granted_at timestamptz not null default now(),
  /* Если пользователь потом отозвал согласие — ставим время отзыва.
   * Активная запись = withdrawn_at IS NULL для данного cookie_id. */
  withdrawn_at timestamptz
);

create index if not exists cookie_consents_cookie_idx
  on public.cookie_consents (cookie_id, granted_at desc);

comment on table public.cookie_consents is
  'История нажатий cookie-баннера: каждый «Принять/Только обязательные» — отдельная строка.';

alter table public.cookie_consents enable row level security;
drop policy if exists cookie_consents_no_direct on public.cookie_consents;
create policy cookie_consents_no_direct on public.cookie_consents
  for all to anon, authenticated
  using (false) with check (false);

-- ----------------------------------------------------------------------------
-- 3) legal_documents
-- ----------------------------------------------------------------------------

create table if not exists public.legal_documents (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('privacy','cookie','terms')),
  lang text not null check (lang in ('ru','et','en')),
  version text not null,
  title text not null,
  body_md text not null,
  is_active boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists legal_documents_kind_lang_version_uq
  on public.legal_documents (kind, lang, version);
/* Обеспечиваем «не более одной активной версии» через partial unique. */
create unique index if not exists legal_documents_active_uq
  on public.legal_documents (kind, lang) where is_active = true;

comment on table public.legal_documents is
  'Версионированные тексты privacy/cookie/terms на ru/et. anon может читать только is_active=true.';

alter table public.legal_documents enable row level security;
drop policy if exists legal_documents_public_read on public.legal_documents;
create policy legal_documents_public_read on public.legal_documents
  for select to anon, authenticated
  using (is_active = true);

-- ----------------------------------------------------------------------------
-- 4) _log_activity — internal helper
--    NOT exposed to anon/authenticated напрямую (роли могут вызвать через
--    другие RPC, которые сами решают, кому что писать).
-- ----------------------------------------------------------------------------

create or replace function public._log_activity(
  p_actor_kind text,
  p_actor_id uuid,
  p_client_cookie_id text,
  p_action text,
  p_resource_type text,
  p_resource_id text,
  p_meta jsonb
) returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  new_id bigint;
  ua text;
begin
  begin
    ua := nullif(trim(coalesce(current_setting('request.headers', true)::jsonb ->> 'user-agent','')), '');
  exception when others then
    ua := null;
  end;
  insert into public.activity_log (
    actor_kind, actor_id, client_cookie_id, action,
    resource_type, resource_id, ip_address, user_agent, meta
  ) values (
    coalesce(nullif(trim(p_actor_kind), ''), 'system'),
    p_actor_id,
    nullif(trim(coalesce(p_client_cookie_id,'')), ''),
    coalesce(nullif(trim(p_action), ''), 'unknown'),
    nullif(trim(coalesce(p_resource_type,'')), ''),
    nullif(trim(coalesce(p_resource_id,'')), ''),
    public._staff_request_client_ip(),
    ua,
    coalesce(p_meta, '{}'::jsonb)
  ) returning id into new_id;
  return new_id;
exception when others then
  /* Лог никогда не должен валить основной RPC. Если вдруг сломалось
   * (повреждённый jsonb или индексы) — молча пропускаем. */
  return null;
end;
$$;

revoke all on function public._log_activity(text, uuid, text, text, text, text, jsonb)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5) client_log_activity — для публичного сайта (script.js).
--    Rate-limit 50 событий за последний час с одного cookie_id защищает
--    от случайного flood / простой DDoS.
-- ----------------------------------------------------------------------------

create or replace function public.client_log_activity(
  p_cookie_id text,
  p_action text,
  p_meta jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  recent_count int;
begin
  if p_cookie_id is null or length(trim(p_cookie_id)) < 8 then
    return jsonb_build_object('status','invalid_cookie');
  end if;
  if p_action is null or length(trim(p_action)) = 0 then
    return jsonb_build_object('status','invalid_action');
  end if;
  /* Любой нелогированный посетитель шлёт события под одним cookie_id;
   * fan-out защищаем простым «не более 50 событий/час». 500 записей в
   * сутки это нормальная нагрузка для одного устройства. */
  select count(*) into recent_count
    from public.activity_log
    where client_cookie_id = p_cookie_id
      and occurred_at > now() - interval '1 hour';
  if recent_count >= 50 then
    return jsonb_build_object('status','rate_limited');
  end if;

  perform public._log_activity(
    'client', null, p_cookie_id,
    left(p_action, 80), null, null,
    coalesce(p_meta, '{}'::jsonb)
  );
  return jsonb_build_object('status','ok');
end;
$$;

revoke all on function public.client_log_activity(text, text, jsonb) from public;
grant execute on function public.client_log_activity(text, text, jsonb)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6) client_record_consent — записывает нажатие cookie-баннера.
--    Параллельно пишет событие в activity_log (для трассировки в CRM).
-- ----------------------------------------------------------------------------

create or replace function public.client_record_consent(
  p_cookie_id text,
  p_policy_version text,
  p_categories text[]
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  ua text;
  new_id bigint;
  cleaned_cats text[];
begin
  if p_cookie_id is null or length(trim(p_cookie_id)) < 8 then
    return jsonb_build_object('status','invalid_cookie');
  end if;

  begin
    ua := nullif(trim(coalesce(current_setting('request.headers', true)::jsonb ->> 'user-agent','')), '');
  exception when others then
    ua := null;
  end;

  /* essential всегда в наборе (без него сайт не работает: сессия, корзина,
   * базовая безопасность). Дополнительно нормализуем имена категорий —
   * принимаем только известный список, чтобы клиент не инжектил что-то
   * странное в массив. */
  select coalesce(
    array_agg(distinct c) filter (where c in ('essential','analytics','marketing','functional')),
    '{}'::text[]
  )
  into cleaned_cats
  from unnest(coalesce(p_categories, '{}'::text[])) c;
  if not ('essential' = any(cleaned_cats)) then
    cleaned_cats := array_append(cleaned_cats, 'essential');
  end if;

  insert into public.cookie_consents (
    cookie_id, policy_version, categories, ip_address, user_agent
  ) values (
    p_cookie_id,
    coalesce(nullif(trim(p_policy_version), ''), 'unknown'),
    cleaned_cats,
    public._staff_request_client_ip(),
    ua
  )
  returning id into new_id;

  perform public._log_activity(
    'client', null, p_cookie_id,
    'consent.granted', 'cookie_consent', new_id::text,
    jsonb_build_object('categories', cleaned_cats, 'version', p_policy_version)
  );

  return jsonb_build_object('status','ok','consent_id', new_id, 'categories', cleaned_cats);
end;
$$;

revoke all on function public.client_record_consent(text, text, text[]) from public;
grant execute on function public.client_record_consent(text, text, text[])
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7) staff_my_activity — своя история (любой staff).
-- ----------------------------------------------------------------------------

create or replace function public.staff_my_activity(
  p_actor_id uuid,
  p_limit int default 100,
  p_before_at timestamptz default null
) returns setof jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_actor_id is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  /* Безопасности ради проверим, что такой staff существует и активен.
   * actor_id передаёт фронтенд — при компрометации anon-key это снижает
   * риск slurp чужой истории, потому что неактивный сотрудник не вернёт
   * данных. (Фактическая авторизация в CRM делается через PIN+device.) */
  if not exists (select 1 from public.staff where id = p_actor_id and is_active = true) then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  return query
    select jsonb_build_object(
      'id', a.id,
      'occurred_at', a.occurred_at,
      'action', a.action,
      'resource_type', a.resource_type,
      'resource_id', a.resource_id,
      'ip_address', host(a.ip_address),
      'user_agent', a.user_agent,
      'meta', a.meta
    )
    from public.activity_log a
    where a.actor_id = p_actor_id
      and (p_before_at is null or a.occurred_at < p_before_at)
    order by a.occurred_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

revoke all on function public.staff_my_activity(uuid, int, timestamptz) from public;
grant execute on function public.staff_my_activity(uuid, int, timestamptz)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 8) staff_admin_activity — admin/manager смотрит чужую историю
--    (или историю клиента по cookie_id).
-- ----------------------------------------------------------------------------

create or replace function public.staff_admin_activity(
  p_actor_id uuid,
  p_target_actor_id uuid default null,
  p_target_cookie_id text default null,
  p_limit int default 100,
  p_before_at timestamptz default null
) returns setof jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._staff_assert_manage(p_actor_id);
  if p_target_actor_id is null and (p_target_cookie_id is null or length(trim(p_target_cookie_id)) = 0) then
    raise exception 'target_required' using errcode = '22023';
  end if;
  return query
    select jsonb_build_object(
      'id', a.id,
      'occurred_at', a.occurred_at,
      'actor_kind', a.actor_kind,
      'actor_id', a.actor_id,
      'client_cookie_id', a.client_cookie_id,
      'action', a.action,
      'resource_type', a.resource_type,
      'resource_id', a.resource_id,
      'ip_address', host(a.ip_address),
      'user_agent', a.user_agent,
      'meta', a.meta
    )
    from public.activity_log a
    where (
        (p_target_actor_id is not null and a.actor_id = p_target_actor_id)
        or (p_target_cookie_id is not null and a.client_cookie_id = p_target_cookie_id)
      )
      and (p_before_at is null or a.occurred_at < p_before_at)
    order by a.occurred_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

revoke all on function public.staff_admin_activity(uuid, uuid, text, int, timestamptz) from public;
grant execute on function public.staff_admin_activity(uuid, uuid, text, int, timestamptz)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 9) legal_get_active — публичный, отдаёт активную версию документа.
-- ----------------------------------------------------------------------------

create or replace function public.legal_get_active(
  p_kind text,
  p_lang text
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', d.id,
    'kind', d.kind,
    'lang', d.lang,
    'version', d.version,
    'title', d.title,
    'body_md', d.body_md,
    'published_at', d.published_at
  )
  from public.legal_documents d
  where d.kind = p_kind
    and d.lang = coalesce(nullif(trim(p_lang), ''), 'ru')
    and d.is_active = true
  order by d.published_at desc nulls last
  limit 1;
$$;

revoke all on function public.legal_get_active(text, text) from public;
grant execute on function public.legal_get_active(text, text)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 10) staff_login — добавляем логирование событий входа.
--     Берём последнюю версию из 054 и в каждом исходе вызываем _log_activity.
-- ----------------------------------------------------------------------------

create or replace function public.staff_login(
  phone_input text,
  pin_input text default null,
  device_token text default null,
  trust_this_device boolean default false,
  device_label text default null,
  user_agent_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.staff;
  device_row public.staff_trusted_devices;
  new_token text;
  new_token_hash text;
begin
  s := public._staff_resolve_by_phone(phone_input);
  if s.id is null then
    perform public._log_activity('anon', null, null, 'staff.login.access_denied',
      'staff_login', null, jsonb_build_object('phone_tail', right(coalesce(phone_input,''), 4)));
    return jsonb_build_object('status', 'access_denied');
  end if;

  if s.pin_hash is null then
    perform public._log_activity('staff', s.id, null, 'staff.login.ok',
      'staff_login', s.id::text, jsonb_build_object('mode','legacy_no_pin'));
    return jsonb_build_object(
      'status', 'ok',
      'mode', 'legacy_no_pin',
      'staff', public._staff_to_public_json(s)
    );
  end if;

  if device_token is not null and device_token <> '' then
    select td.* into device_row
    from public.staff_trusted_devices td
    where td.device_token_hash = public._staff_token_hash(device_token)
      and td.revoked_at is null
      and (
        td.staff_id = s.id
        or (td.is_salon_device = true and s.is_active = true)
      )
    limit 1;
    if device_row.id is not null then
      update public.staff_trusted_devices
        set last_seen_at = now()
        where id = device_row.id;
      update public.staff
        set pin_failed_attempts = 0,
            pin_locked_until = null
        where id = s.id;
      perform public._log_activity('staff', s.id, null, 'staff.login.ok',
        'staff_login', s.id::text,
        jsonb_build_object(
          'mode', case when device_row.is_salon_device then 'salon_device' else 'trusted_device' end,
          'device_id', device_row.id::text,
          'device_label', device_row.label
        ));
      return jsonb_build_object(
        'status', 'ok',
        'mode', case when device_row.is_salon_device
                     then 'salon_device'
                     else 'trusted_device' end,
        'staff', public._staff_to_public_json(s)
      );
    end if;
  end if;

  if s.pin_locked_until is not null and s.pin_locked_until > now() then
    perform public._log_activity('staff', s.id, null, 'staff.login.pin_locked',
      'staff_login', s.id::text,
      jsonb_build_object('locked_until', s.pin_locked_until));
    return jsonb_build_object(
      'status', 'pin_locked',
      'locked_until', s.pin_locked_until
    );
  end if;

  if pin_input is null or pin_input = '' then
    perform public._log_activity('staff', s.id, null, 'staff.login.requires_pin',
      'staff_login', s.id::text, '{}'::jsonb);
    return jsonb_build_object(
      'status', 'requires_pin',
      'staff_name', s.name
    );
  end if;

  if s.pin_hash <> crypt(pin_input, s.pin_hash) then
    update public.staff
      set pin_failed_attempts = pin_failed_attempts + 1,
          pin_locked_until = case
            when pin_failed_attempts + 1 >= 5 then now() + interval '15 minutes'
            else null
          end
      where id = s.id;
    perform public._log_activity('staff', s.id, null, 'staff.login.invalid_pin',
      'staff_login', s.id::text,
      jsonb_build_object('failed_attempts', s.pin_failed_attempts + 1));
    return jsonb_build_object('status', 'invalid_pin');
  end if;

  update public.staff
    set pin_failed_attempts = 0,
        pin_locked_until = null
    where id = s.id;

  if trust_this_device then
    new_token := encode(gen_random_bytes(24), 'base64');
    new_token := replace(replace(replace(new_token, '+', '-'), '/', '_'), '=', '');
    new_token_hash := public._staff_token_hash(new_token);
    insert into public.staff_trusted_devices (
      staff_id, device_token_hash, label, user_agent, last_seen_at
    ) values (
      s.id,
      new_token_hash,
      coalesce(nullif(trim(device_label), ''), 'Браузер CRM'),
      user_agent_input,
      now()
    );
    perform public._log_activity('staff', s.id, null, 'staff.login.ok',
      'staff_login', s.id::text,
      jsonb_build_object('mode','pin_with_new_device','trusted', true));
    return jsonb_build_object(
      'status', 'ok',
      'mode', 'pin_with_new_device',
      'staff', public._staff_to_public_json(s),
      'new_device_token', new_token
    );
  end if;

  perform public._log_activity('staff', s.id, null, 'staff.login.ok',
    'staff_login', s.id::text, jsonb_build_object('mode','pin_only'));
  return jsonb_build_object(
    'status', 'ok',
    'mode', 'pin_only',
    'staff', public._staff_to_public_json(s)
  );
end;
$$;

revoke all on function public.staff_login(text, text, text, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.staff_login(text, text, text, boolean, text, text)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 11) Seed: стартовые тексты политик (ru + et). Активные.
--     Markdown короткий, потом админ может переписать через UI.
-- ----------------------------------------------------------------------------

insert into public.legal_documents (kind, lang, version, title, body_md, is_active, published_at)
values
('privacy','ru','2026-04-19','Политика конфиденциальности',
$$# Политика конфиденциальности

**AlesSanna Ilusalong** (далее — «салон», «мы») заботится о ваших данных.
Этот документ объясняет, какие данные мы собираем, зачем и как вы можете
ими управлять.

## Какие данные мы собираем

* **Контакты для брони:** имя и телефон, который вы оставляете при записи
  на услугу. Без них мы не можем подтвердить запись или связаться с вами.
* **Технические данные:** IP-адрес, тип устройства и браузера. Используются
  для безопасности и борьбы с накруткой ботов.
* **Куки:** см. [Политику использования cookie](/cookies).

## Зачем

* Подтвердить и провести вашу запись.
* Напомнить о визите за день.
* Анализировать загрузку салона и улучшать график мастеров.
* Обеспечить безопасность сайта (антифрод, защита от спама).

## С кем делимся

Мы **не продаём** ваши данные. Передача третьим лицам возможна только:
* провайдеру хостинга (Supabase, EU-регион) — для технического хранения;
* по требованию закона (полиция, суд).

## Сколько храним

* Данные брони — 3 года после визита (для рекламаций / возвратов).
* Технические логи — 90 дней.
* Cookie-согласия — 2 года (это требование GDPR).

## Ваши права

Вы можете в любой момент:
* запросить копию своих данных;
* потребовать удаления (право быть забытым);
* отозвать cookie-согласие — кнопка в футере.

Контакт по вопросам данных: **alessanna.ilusalong@gmail.com**

## Версия

Действующая редакция: **2026-04-19**.
$$,
true, now()),

('cookie','ru','2026-04-19','Политика использования cookie',
$$# Политика использования cookie

Сайт использует cookie и аналогичные технологии для базовой работы и для
улучшения опыта.

## Категории

* **Обязательные (essential).** Без них сайт не работает: сессия, корзина
  выбранных услуг, базовая защита от бот-атак. Включены всегда.
* **Аналитика (analytics).** Анонимная статистика: какие услуги чаще
  смотрят, в каком порядке листают, на каком экране уходят. Помогает
  улучшить расписание и наполнение каталога. **Можно отключить.**
* **Маркетинг (marketing).** Тег для ремаркетинга в Instagram/Google
  (если вы перешли по рекламе). На текущий момент **не активен**, но
  оставлен в баннере на будущее.

## Как управлять

Кликните «Настройки cookie» в футере сайта или нажмите «Сбросить»
в панели браузера. После сброса баннер появится снова и мы перепросим
ваше согласие.

## Хранение

Каждое нажатие «Принять» / «Только обязательные» сохраняем с указанием
версии политики, IP-адреса и user-agent. Это нужно нам, чтобы доказать
факт вашего согласия по запросу регулятора.

Контакт: **alessanna.ilusalong@gmail.com**

## Версия

Действующая редакция: **2026-04-19**.
$$,
true, now()),

('privacy','et','2026-04-19','Privaatsuspoliitika',
$$# Privaatsuspoliitika

**AlesSanna Ilusalong** (edaspidi «salong», «meie») hoiab teie andmeid hoolega.
See dokument selgitab, milliseid andmeid me kogume, miks ja kuidas saate neid
ise hallata.

## Milliseid andmeid kogume

* **Broneeringu kontakt:** nimi ja telefoninumber, mille jätate broneerides.
  Ilma nendeta ei saa me broneeringut kinnitada.
* **Tehnilised andmed:** IP-aadress, seadme ja brauseri tüüp.
  Kasutame turvalisuseks ja botide tõrjeks.
* **Küpsised:** vt [Küpsiste poliitika](/cookies).

## Miks

* Broneeringu kinnitamiseks ja täitmiseks.
* Päev varem meeldetuletuse saatmiseks.
* Salongi koormuse analüüsimiseks ja meistrite graafiku parandamiseks.
* Saidi turvalisuse tagamiseks.

## Kellega jagame

Me **ei müü** teie andmeid. Edastame kolmandatele isikutele ainult:
* hostinguteenuse pakkujale (Supabase, EU);
* seaduse alusel (politsei, kohus).

## Kui kaua hoiame

* Broneeringu andmed — 3 aastat pärast külastust.
* Tehnilised logid — 90 päeva.
* Küpsiste nõusolekud — 2 aastat (GDPR nõue).

## Teie õigused

Saate igal hetkel:
* küsida koopia oma andmetest;
* nõuda kustutamist (õigus olla unustatud);
* võtta tagasi küpsiste nõusoleku — nupp jaluses.

Kontakt: **alessanna.ilusalong@gmail.com**

## Versioon

Kehtiv redaktsioon: **2026-04-19**.
$$,
true, now()),

('cookie','et','2026-04-19','Küpsiste poliitika',
$$# Küpsiste poliitika

Sait kasutab küpsiseid ja sarnaseid tehnoloogiaid baastöö ja kasutuskogemuse
parandamiseks.

## Kategooriad

* **Kohustuslikud (essential).** Ilma nendeta sait ei tööta: sessioon,
  korv, baasturvalisus. Alati sisse lülitatud.
* **Analüütika (analytics).** Anonüümne statistika: mida vaadatakse,
  millises järjekorras, kus ekraanilt lahkutakse. **Saab välja lülitada.**
* **Turundus (marketing).** Remarketingi tag Instagram/Google jaoks
  (kui tulite reklaamilingilt). Praegu **pole aktiivne**, aga jäetud
  bannerile tuleviku tarbeks.

## Kuidas hallata

Klõpsake «Küpsiste seaded» jaluses või lähtestage brauseri paneelis.
Pärast lähtestamist banner kuvatakse uuesti.

## Säilitamine

Iga «Nõustun» / «Ainult kohustuslikud» klõps salvestatakse koos
poliitika versiooni, IP-aadressi ja user-agentiga.

Kontakt: **alessanna.ilusalong@gmail.com**

## Versioon

Kehtiv redaktsioon: **2026-04-19**.
$$,
true, now())
on conflict (kind, lang, version) do nothing;

commit;
