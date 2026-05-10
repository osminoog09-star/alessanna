/** Календарь и «сегодня» для публичной записи: Europe/Tallinn. */

export const SALON_TIME_ZONE = "Europe/Tallinn";

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  const mlen = [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return mlen[m - 1];
}

/** Сегодняшняя дата по календарю Таллина (yyyy-MM-dd). */
export function salonCalendarYmd(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: SALON_TIME_ZONE });
}

/** Дата yyyy-MM-dd для момента `d` в зоне салона. */
export function salonYmdFromAnyDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: SALON_TIME_ZONE });
}

/** Следующий календарный день (Григориан, как в Эстонии). */
export function gregorianAddDays(ymd: string, delta: number): string {
  if (delta === 0) return ymd;
  let [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  let day = d + delta;
  while (day > daysInMonth(y, m)) {
    day -= daysInMonth(y, m);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  while (day < 1) {
    m--;
    if (m < 1) {
      m = 12;
      y--;
    }
    day += daysInMonth(y, m);
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Первый день, на который разрешена онлайн-запись: завтра по Таллину. */
export function salonFirstBookableYmd(now: Date = new Date()): string {
  return gregorianAddDays(salonCalendarYmd(now), 1);
}

/** Сравнение yyyy-MM-dd. */
export function compareSalonYmd(a: string, b: string): number {
  return a.localeCompare(b);
}

export function isSalonBookableYmd(ymd: string, now: Date = new Date()): boolean {
  return compareSalonYmd(ymd, salonFirstBookableYmd(now)) >= 0;
}

function zonedParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return {
    y: +parts.year,
    m: +parts.month,
    d: +parts.day,
    hour: +parts.hour,
    minute: +parts.minute,
    second: +parts.second,
  };
}

/**
 * UTC-момент начала календарного дня ymd в Europe/Tallinn (00:00 местного времени).
 */
export function salonDayStartUtc(ymd: string): Date {
  const [y, mo, d] = ymd.split("-").map((x) => parseInt(x, 10));
  let t = Date.UTC(y, mo - 1, d - 1, 22, 0, 0);
  for (let i = 0; i < 1440; i++) {
    const p = zonedParts(new Date(t), SALON_TIME_ZONE);
    const cur = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
    if (cur === ymd && p.hour === 0 && p.minute === 0) {
      return new Date(t);
    }
    t += 60_000;
  }
  throw new Error(`salonDayStartUtc: could not resolve ${ymd}`);
}

/**
 * Защита от битой даты в состоянии: иначе salonDayStartUtc / salonWeekdaySun0 роняют рендер.
 * Объявлено после salonDayStartUtc, чтобы порядок в бандле был однозначным.
 */
export function normalizePublicBookingDayStr(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return salonFirstBookableYmd();
  try {
    salonDayStartUtc(ymd);
    return ymd;
  } catch {
    return salonFirstBookableYmd();
  }
}

/** День недели 0–6 (вс–сб) для календарного дня ymd в Таллине. */
export function salonWeekdaySun0(ymd: string): number {
  const t = salonDayStartUtc(ymd);
  const w = new Intl.DateTimeFormat("en-US", {
    timeZone: SALON_TIME_ZONE,
    weekday: "long",
  }).format(t);
  const map: Record<string, number> = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };
  const n = map[w];
  if (n === undefined) throw new Error(`salonWeekdaySun0: unexpected weekday ${w}`);
  return n;
}
