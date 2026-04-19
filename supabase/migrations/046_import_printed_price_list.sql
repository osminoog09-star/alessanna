-- 046: импорт услуг из печатного прайса (Hinnakiri).
-- Источник: 7 PDF-картинок прайса салона на эстонском, присланные владельцем.
-- Стратегия:
--   1) UPDATE существующих позиций, где название однозначно совпадает с пунктом
--      из прайса — обновляем цену под актуальный прайс.
--   2) INSERT новых позиций (только name + price + category_id) для пунктов,
--      которых раньше в CRM не было. Длительность и порядок сортировки
--      владелец проставит сам в /admin/services.
--   3) Чтобы случайно не задвоить услугу, INSERT обёрнут проверкой NOT EXISTS
--      по (lower(name), category_id).
--
-- Категории (готовые в public.service_categories):
--   0c694168-acb2-42d3-8799-5e36628f6ab2  Брови и ресницы
--   0d452ffe-6ffa-4c6b-b59e-c0e687cfb819  Маникюр
--   9b2b9aa4-a001-4c4b-818d-481a66330cec  Окрашивание
--   2d9b4adc-ad3b-466c-814a-d0405adad61a  Педикюр
--   c90bb2b0-663b-424f-9c6c-cb5cc5775ea9  Стрижка
--   35f5952d-f69e-4d6f-b5a2-fee96a9f95a0  Укладки
--   47608217-600f-4f74-9431-9e8b130c1094  Химическая завивка

begin;

-- ───────────── 1) UPDATE существующих позиций под прайс ─────────────
-- Брови и ресницы: фактический прайс ниже того, что было в CRM.
update public.service_listings set price = 8  where id = 'ec8641d8-2d76-4bdd-9bd0-b44efc9998ca'; -- Коррекция бровей (Kulmude kitkumine)
update public.service_listings set price = 7  where id = 'bb2a0976-b17f-4589-acc3-fa01dccf6e04'; -- Окрашивание бровей (Kulmude värvimine)
update public.service_listings set price = 7  where id = '2bd972bf-2ff1-47ba-a880-630466b6b4ce'; -- Окрашивание ресниц (Ripsmete värvimine)

-- Маникюр
update public.service_listings set price = 20 where id = '2c92f3c0-a08e-4f38-a067-3629399c23d9'; -- Классический маникюр (Maniküür 15-20)
update public.service_listings set price = 30 where id = '3e143c73-4299-4a29-80ed-6a571dff4a73'; -- Маникюр + гель-лак (Maniküür geellakiga)

-- Педикюр
update public.service_listings set price = 35 where id = 'e4bd90c4-48a6-4793-a614-3cec027ad6ca'; -- Классический педикюр (Pediküür 30-35)
update public.service_listings set price = 40 where id = '21fef99d-dbd4-4034-aa12-1bb2327d476f'; -- Педикюр + гель-лак (Pediküür geellakiga)

-- Стрижка
update public.service_listings set price = 15 where id = '6fcc7b24-04b5-4046-bba0-0f6a9237360b'; -- Детская стрижка (Lapsed Lõikus kuni 12a)
update public.service_listings set price = 20 where id = 'e654d9b4-6d8b-4045-97c8-f5fd03607406'; -- Мужская стрижка (Mehed Lõikus)
update public.service_listings set price = 30 where id = '5e40e820-a8ea-4333-bb54-312177c2e1b2'; -- Женская стрижка (Naised Juuste lõikus 25-30)

-- Окрашивание (только корни)
update public.service_listings set price = 40 where id = '0f94d038-a2a7-4de7-8545-5a617ced034d'; -- Окрашивание корней (Järelkasvu värvimine ~2cm 35-40)

-- Химическая завивка: в прайсе короткие/длинные — это вершины диапазона
update public.service_listings set price = 43 where id = 'b40b2ca7-3fa8-4c36-97c4-5ce86228adac'; -- Хим. завивка (короткие) (Lühikesed 43)
update public.service_listings set price = 60 where id = '22109204-233f-48e9-aa7b-716e0fddd1ea'; -- Хим. завивка (длинные) (Pikad 50-60)

-- ───────────── 2) INSERT новых позиций по категориям ─────────────
-- Защита от задвоения: смотрим по (lower(name), category_id).

-- ── Брови и ресницы
insert into public.service_listings (name, price, category_id)
select 'Окрашивание бровей и ресниц + коррекция', 20, '0c694168-acb2-42d3-8799-5e36628f6ab2'
where not exists (
  select 1 from public.service_listings
  where category_id = '0c694168-acb2-42d3-8799-5e36628f6ab2'
    and lower(name) = lower('Окрашивание бровей и ресниц + коррекция')
);

-- ── Маникюр
insert into public.service_listings (name, price, category_id)
select 'Покрытие лаком', 7, '0d452ffe-6ffa-4c6b-b59e-c0e687cfb819'
where not exists (
  select 1 from public.service_listings
  where category_id = '0d452ffe-6ffa-4c6b-b59e-c0e687cfb819' and lower(name) = lower('Покрытие лаком')
);

insert into public.service_listings (name, price, category_id)
select 'Снятие гель-лака (с классическим маникюром)', 25, '0d452ffe-6ffa-4c6b-b59e-c0e687cfb819'
where not exists (
  select 1 from public.service_listings
  where category_id = '0d452ffe-6ffa-4c6b-b59e-c0e687cfb819' and lower(name) = lower('Снятие гель-лака (с классическим маникюром)')
);

insert into public.service_listings (name, price, category_id)
select 'Снятие гель-лака', 15, '0d452ffe-6ffa-4c6b-b59e-c0e687cfb819'
where not exists (
  select 1 from public.service_listings
  where category_id = '0d452ffe-6ffa-4c6b-b59e-c0e687cfb819' and lower(name) = lower('Снятие гель-лака')
);

insert into public.service_listings (name, price, category_id)
select 'Наращивание ногтей (гель)', 50, '0d452ffe-6ffa-4c6b-b59e-c0e687cfb819'
where not exists (
  select 1 from public.service_listings
  where category_id = '0d452ffe-6ffa-4c6b-b59e-c0e687cfb819' and lower(name) = lower('Наращивание ногтей (гель)')
);

insert into public.service_listings (name, price, category_id)
select 'Коррекция гель-ногтей', 40, '0d452ffe-6ffa-4c6b-b59e-c0e687cfb819'
where not exists (
  select 1 from public.service_listings
  where category_id = '0d452ffe-6ffa-4c6b-b59e-c0e687cfb819' and lower(name) = lower('Коррекция гель-ногтей')
);

insert into public.service_listings (name, price, category_id)
select 'Снятие наращенных ногтей', 25, '0d452ffe-6ffa-4c6b-b59e-c0e687cfb819'
where not exists (
  select 1 from public.service_listings
  where category_id = '0d452ffe-6ffa-4c6b-b59e-c0e687cfb819' and lower(name) = lower('Снятие наращенных ногтей')
);

insert into public.service_listings (name, price, category_id)
select 'Ремонт одного ногтя', 7, '0d452ffe-6ffa-4c6b-b59e-c0e687cfb819'
where not exists (
  select 1 from public.service_listings
  where category_id = '0d452ffe-6ffa-4c6b-b59e-c0e687cfb819' and lower(name) = lower('Ремонт одного ногтя')
);

-- ── Педикюр
insert into public.service_listings (name, price, category_id)
select 'Снятие гель-лака (с классическим педикюром)', 35, '2d9b4adc-ad3b-466c-814a-d0405adad61a'
where not exists (
  select 1 from public.service_listings
  where category_id = '2d9b4adc-ad3b-466c-814a-d0405adad61a' and lower(name) = lower('Снятие гель-лака (с классическим педикюром)')
);

insert into public.service_listings (name, price, category_id)
select 'Мужской педикюр', 35, '2d9b4adc-ad3b-466c-814a-d0405adad61a'
where not exists (
  select 1 from public.service_listings
  where category_id = '2d9b4adc-ad3b-466c-814a-d0405adad61a' and lower(name) = lower('Мужской педикюр')
);

-- ── Стрижка
insert into public.service_listings (name, price, category_id)
select 'Мужская стрижка машинкой', 15, 'c90bb2b0-663b-424f-9c6c-cb5cc5775ea9'
where not exists (
  select 1 from public.service_listings
  where category_id = 'c90bb2b0-663b-424f-9c6c-cb5cc5775ea9' and lower(name) = lower('Мужская стрижка машинкой')
);

insert into public.service_listings (name, price, category_id)
select 'Стрижка бороды и усов', 10, 'c90bb2b0-663b-424f-9c6c-cb5cc5775ea9'
where not exists (
  select 1 from public.service_listings
  where category_id = 'c90bb2b0-663b-424f-9c6c-cb5cc5775ea9' and lower(name) = lower('Стрижка бороды и усов')
);

insert into public.service_listings (name, price, category_id)
select 'Мытьё головы', 5, 'c90bb2b0-663b-424f-9c6c-cb5cc5775ea9'
where not exists (
  select 1 from public.service_listings
  where category_id = 'c90bb2b0-663b-424f-9c6c-cb5cc5775ea9' and lower(name) = lower('Мытьё головы')
);

insert into public.service_listings (name, price, category_id)
select 'Подравнивание кончиков', 20, 'c90bb2b0-663b-424f-9c6c-cb5cc5775ea9'
where not exists (
  select 1 from public.service_listings
  where category_id = 'c90bb2b0-663b-424f-9c6c-cb5cc5775ea9' and lower(name) = lower('Подравнивание кончиков')
);

insert into public.service_listings (name, price, category_id)
select 'Стрижка чёлки', 5, 'c90bb2b0-663b-424f-9c6c-cb5cc5775ea9'
where not exists (
  select 1 from public.service_listings
  where category_id = 'c90bb2b0-663b-424f-9c6c-cb5cc5775ea9' and lower(name) = lower('Стрижка чёлки')
);

insert into public.service_listings (name, price, category_id)
select 'Мытьё + дневная укладка', 20, 'c90bb2b0-663b-424f-9c6c-cb5cc5775ea9'
where not exists (
  select 1 from public.service_listings
  where category_id = 'c90bb2b0-663b-424f-9c6c-cb5cc5775ea9' and lower(name) = lower('Мытьё + дневная укладка')
);

-- ── Укладки
insert into public.service_listings (name, price, category_id)
select 'Дневная укладка', 20, '35f5952d-f69e-4d6f-b5a2-fee96a9f95a0'
where not exists (
  select 1 from public.service_listings
  where category_id = '35f5952d-f69e-4d6f-b5a2-fee96a9f95a0' and lower(name) = lower('Дневная укладка')
);

insert into public.service_listings (name, price, category_id)
select 'Выпрямление волос', 25, '35f5952d-f69e-4d6f-b5a2-fee96a9f95a0'
where not exists (
  select 1 from public.service_listings
  where category_id = '35f5952d-f69e-4d6f-b5a2-fee96a9f95a0' and lower(name) = lower('Выпрямление волос')
);

insert into public.service_listings (name, price, category_id)
select 'Укладка локонами', 25, '35f5952d-f69e-4d6f-b5a2-fee96a9f95a0'
where not exists (
  select 1 from public.service_listings
  where category_id = '35f5952d-f69e-4d6f-b5a2-fee96a9f95a0' and lower(name) = lower('Укладка локонами')
);

insert into public.service_listings (name, price, category_id)
select 'Праздничная укладка', 35, '35f5952d-f69e-4d6f-b5a2-fee96a9f95a0'
where not exists (
  select 1 from public.service_listings
  where category_id = '35f5952d-f69e-4d6f-b5a2-fee96a9f95a0' and lower(name) = lower('Праздничная укладка')
);

insert into public.service_listings (name, price, category_id)
select 'Свадебная укладка', 45, '35f5952d-f69e-4d6f-b5a2-fee96a9f95a0'
where not exists (
  select 1 from public.service_listings
  where category_id = '35f5952d-f69e-4d6f-b5a2-fee96a9f95a0' and lower(name) = lower('Свадебная укладка')
);

-- ── Химическая завивка
insert into public.service_listings (name, price, category_id)
select 'Химическая завивка (средние)', 50, '47608217-600f-4f74-9431-9e8b130c1094'
where not exists (
  select 1 from public.service_listings
  where category_id = '47608217-600f-4f74-9431-9e8b130c1094' and lower(name) = lower('Химическая завивка (средние)')
);

-- ── Окрашивание (детализация по длине из печатного прайса).
-- Существующие «Полное окрашивание» 75€ и «Тонирование» 45€ оставляем
-- — это «общие» позиции; конкретика по длине идёт отдельными услугами,
-- как в печатном Hinnakiri (картинка 2: Juuste värvimine ilma lõikuseta).
insert into public.service_listings (name, price, category_id)
select 'Окрашивание (короткие волосы)', 40, '9b2b9aa4-a001-4c4b-818d-481a66330cec'
where not exists (
  select 1 from public.service_listings
  where category_id = '9b2b9aa4-a001-4c4b-818d-481a66330cec' and lower(name) = lower('Окрашивание (короткие волосы)')
);

insert into public.service_listings (name, price, category_id)
select 'Окрашивание (средние волосы)', 45, '9b2b9aa4-a001-4c4b-818d-481a66330cec'
where not exists (
  select 1 from public.service_listings
  where category_id = '9b2b9aa4-a001-4c4b-818d-481a66330cec' and lower(name) = lower('Окрашивание (средние волосы)')
);

insert into public.service_listings (name, price, category_id)
select 'Окрашивание (длинные волосы)', 50, '9b2b9aa4-a001-4c4b-818d-481a66330cec'
where not exists (
  select 1 from public.service_listings
  where category_id = '9b2b9aa4-a001-4c4b-818d-481a66330cec' and lower(name) = lower('Окрашивание (длинные волосы)')
);

insert into public.service_listings (name, price, category_id)
select 'Окрашивание (очень длинные волосы)', 65, '9b2b9aa4-a001-4c4b-818d-481a66330cec'
where not exists (
  select 1 from public.service_listings
  where category_id = '9b2b9aa4-a001-4c4b-818d-481a66330cec' and lower(name) = lower('Окрашивание (очень длинные волосы)')
);

insert into public.service_listings (name, price, category_id)
select 'Окрашивание своим красителем', 33, '9b2b9aa4-a001-4c4b-818d-481a66330cec'
where not exists (
  select 1 from public.service_listings
  where category_id = '9b2b9aa4-a001-4c4b-818d-481a66330cec' and lower(name) = lower('Окрашивание своим красителем')
);

insert into public.service_listings (name, price, category_id)
select 'Мелирование (короткие волосы)', 45, '9b2b9aa4-a001-4c4b-818d-481a66330cec'
where not exists (
  select 1 from public.service_listings
  where category_id = '9b2b9aa4-a001-4c4b-818d-481a66330cec' and lower(name) = lower('Мелирование (короткие волосы)')
);

insert into public.service_listings (name, price, category_id)
select 'Мелирование (средние волосы)', 50, '9b2b9aa4-a001-4c4b-818d-481a66330cec'
where not exists (
  select 1 from public.service_listings
  where category_id = '9b2b9aa4-a001-4c4b-818d-481a66330cec' and lower(name) = lower('Мелирование (средние волосы)')
);

insert into public.service_listings (name, price, category_id)
select 'Мелирование (длинные волосы)', 60, '9b2b9aa4-a001-4c4b-818d-481a66330cec'
where not exists (
  select 1 from public.service_listings
  where category_id = '9b2b9aa4-a001-4c4b-818d-481a66330cec' and lower(name) = lower('Мелирование (длинные волосы)')
);

insert into public.service_listings (name, price, category_id)
select 'Мелирование (очень длинные волосы)', 70, '9b2b9aa4-a001-4c4b-818d-481a66330cec'
where not exists (
  select 1 from public.service_listings
  where category_id = '9b2b9aa4-a001-4c4b-818d-481a66330cec' and lower(name) = lower('Мелирование (очень длинные волосы)')
);

commit;
