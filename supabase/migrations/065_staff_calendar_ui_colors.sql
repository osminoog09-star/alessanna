-- Цвета календаря мастера из Google Calendar (calendarList), для отображения в CRM / сайте.
alter table public.staff
  add column if not exists calendar_color_hex text null,
  add column if not exists calendar_foreground_hex text null;

comment on column public.staff.calendar_color_hex is
  'Фон календаря в Google (calendarList.backgroundColor), например #f4511e. Заполняется импортом google-calendar-import.';
comment on column public.staff.calendar_foreground_hex is
  'Текст/иконки календаря в Google (calendarList.foregroundColor). Опционально.';
