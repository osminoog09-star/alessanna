"use strict";

function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

/** Понедельник = 1 … суббота = 6; воскресенье = null (закрыто в seed) */
function salonWeekday(date) {
  const d = date.getDay();
  if (d === 0) return null;
  return d;
}

function toIso(dateStr, minutesFromMidnight) {
  const h = Math.floor(minutesFromMidnight / 60);
  const m = minutesFromMidnight % 60;
  return `${dateStr}T${pad2(h)}:${pad2(m)}:00`;
}

function overlaps(s1, e1, s2, e2) {
  return s1 < e2 && e1 > s2;
}

function getSlots(db, { employeeId, dateStr, serviceId }) {
  const service = db.prepare("SELECT duration_min, buffer_after_min FROM services WHERE id = ? AND active = 1").get(serviceId);
  if (!service) return [];

  const d = new Date(dateStr + "T12:00:00");
  const wd = salonWeekday(d);
  if (wd == null) return [];

  const hours = db.prepare("SELECT open_min, close_min FROM salon_hours WHERE weekday = ?").get(wd);
  if (!hours) return [];

  const duration = service.duration_min;
  const buffer = service.buffer_after_min;
  const step = 30;

  const existing = db
    .prepare(
      `SELECT start_at, end_at FROM bookings
       WHERE employee_id = ? AND status != 'cancelled' AND substr(start_at, 1, 10) = ?`
    )
    .all(employeeId, dateStr);

  const slots = [];
  for (let t = hours.open_min; t + duration <= hours.close_min; t += step) {
    const startAt = toIso(dateStr, t);
    const endMin = t + duration + buffer;
    const endAt = toIso(dateStr, endMin);
    let ok = true;
    for (const b of existing) {
      if (overlaps(startAt, endAt, b.start_at, b.end_at)) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const hh = Math.floor(t / 60);
      const mm = t % 60;
      slots.push(`${pad2(hh)}:${pad2(mm)}`);
    }
  }
  return slots;
}

function bookingEndAt(dateStr, timeHHMM, durationMin, bufferMin) {
  const [hh, mm] = timeHHMM.split(":").map(Number);
  const startMin = hh * 60 + mm;
  const endMin = startMin + durationMin + bufferMin;
  return { startAt: toIso(dateStr, startMin), endAt: toIso(dateStr, endMin) };
}

module.exports = { getSlots, bookingEndAt, salonWeekday, toIso, overlaps };
