import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const url = globalThis.SALON_SUPABASE_URL;
const key = globalThis.SALON_SUPABASE_ANON_KEY;

const warn = document.getElementById("config-warn");
const servicesEl = document.getElementById("services-list");
const employeesEl = document.getElementById("employees-list");
const slotsEl = document.getElementById("slots-list");
const slotHint = document.getElementById("slot-hint");
const form = document.getElementById("confirm-form");
const doneMsg = document.getElementById("done-msg");

if (!url || !key) {
  warn.hidden = false;
}

const supabase = url && key ? createClient(url, key) : null;

let state = {
  services: [],
  employees: [],
  links: [],
  schedules: [],
  bookings: [],
  serviceId: null,
  employeeId: null,
  slotStart: null,
};

function showStep(n) {
  document.querySelectorAll(".step").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.step === String(n));
  });
}

function minutesFromTime(t) {
  const part = String(t).slice(0, 5);
  const [h, m] = part.split(":").map(Number);
  return h * 60 + m;
}

function mergeWindows(windows) {
  if (!windows.length) return [];
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  const out = [];
  let cur = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const w = sorted[i];
    if (w.start <= cur.end) cur.end = Math.max(cur.end, w.end);
    else {
      out.push(cur);
      cur = { ...w };
    }
  }
  out.push(cur);
  return out;
}

function approvedWindows(schedules, employeeId, weekday) {
  const raw = schedules
    .filter((s) => s.employee_id === employeeId && s.day === weekday && s.status === "approved")
    .map((s) => ({
      start: minutesFromTime(s.start_time),
      end: minutesFromTime(s.end_time),
    }));
  return mergeWindows(raw);
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addMinutes(d, m) {
  return new Date(d.getTime() + m * 60000);
}

function buildSlots(day, employeeId, durationMin) {
  const weekday = day.getDay();
  const windows = approvedWindows(state.schedules, employeeId, weekday);
  const existing = state.bookings.filter((b) => {
    if (b.employee_id !== employeeId || b.status === "cancelled") return false;
    const iso = b.appointment_at || b.start_at;
    if (!iso) return false;
    const t = new Date(iso);
    return t.toDateString() === day.toDateString();
  });

  const slots = [];
  const base = startOfDay(day);
  for (const w of windows) {
    for (let m = w.start; m + durationMin <= w.end; m += 30) {
      const start = addMinutes(base, m);
      const end = addMinutes(start, durationMin);
      const clash = existing.some((b) => {
        const iso = b.appointment_at || b.start_at;
        const bs = new Date(iso);
        const be = new Date(b.end_at);
        return start < be && end > bs;
      });
      if (!clash) slots.push(start);
    }
  }
  return slots;
}

async function load() {
  if (!supabase) return;
  const [sv, em, lk, sch, bk] = await Promise.all([
    supabase.from("services").select("*").eq("active", true).order("sort_order"),
    supabase.from("employees").select("*").eq("active", true).order("name"),
    supabase.from("employee_services").select("*"),
    supabase.from("schedules").select("*").eq("status", "approved"),
    supabase.from("bookings").select("*").in("status", ["pending", "confirmed"]),
  ]);

  state.services = sv.data || [];
  state.employees = em.data || [];
  state.links = lk.data || [];
  state.schedules = sch.data || [];
  state.bookings = bk.data || [];

  renderServices();
}

function renderServices() {
  servicesEl.innerHTML = "";
  state.services.forEach((s) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card";
    btn.innerHTML = `<strong>${escapeHtml(s.name_et)}</strong><br/><span class="muted">${(s.price_cents / 100).toFixed(0)} € · ${s.duration_min} min</span>`;
    btn.addEventListener("click", () => {
      state.serviceId = s.id;
      document.querySelectorAll("#services-list .card").forEach((c) => c.classList.remove("is-picked"));
      btn.classList.add("is-picked");
      renderEmployees();
      showStep(2);
    });
    servicesEl.appendChild(btn);
  });
}

function employeesForService(serviceId) {
  const linked = state.links.filter((l) => l.service_id === serviceId).map((l) => l.employee_id);
  if (!linked.length) return state.employees;
  return state.employees.filter((e) => linked.includes(e.id));
}

function renderEmployees() {
  employeesEl.innerHTML = "";
  const list = employeesForService(state.serviceId);
  if (!list.length) {
    employeesEl.innerHTML = "<p class='muted'>Aktiivseid meistreid pole.</p>";
    return;
  }
  list.forEach((e) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card";
    btn.textContent = e.name;
    btn.addEventListener("click", () => {
      state.employeeId = e.id;
      document.querySelectorAll("#employees-list .card").forEach((c) => c.classList.remove("is-picked"));
      btn.classList.add("is-picked");
      renderSlots();
      showStep(3);
    });
    employeesEl.appendChild(btn);
  });
}

function renderSlots() {
  const svc = state.services.find((s) => s.id === state.serviceId);
  const duration = svc ? svc.duration_min + (svc.buffer_after_min || 0) : 60;
  const days = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  slotsEl.innerHTML = "";
  slotHint.textContent = "Vabad ajad (järgmised 14 päeva, 30 min samm).";

  for (const day of days) {
    const slots = buildSlots(day, state.employeeId, duration);
    if (!slots.length) continue;
    const h = document.createElement("div");
    h.className = "muted";
    h.style.marginTop = "0.75rem";
    h.textContent = day.toLocaleDateString("et-EE", { weekday: "long", day: "numeric", month: "long" });
    slotsEl.appendChild(h);
    slots.forEach((start) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "slot-btn";
      b.textContent = start.toLocaleTimeString("et-EE", { hour: "2-digit", minute: "2-digit" });
      b.addEventListener("click", () => {
        state.slotStart = start;
        showStep(4);
      });
      slotsEl.appendChild(b);
    });
  }
  if (!slotsEl.querySelector(".slot-btn")) {
    slotHint.textContent = "Hetkel pole kinnitatud graafikut või vabu aegu. Proovi teist meistrit.";
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

form?.addEventListener("submit", async (e) => {
  if (!supabase) return;
  e.preventDefault();
  const fd = new FormData(form);
  const client_name = String(fd.get("client_name") || "").trim();
  const client_phone = String(fd.get("client_phone") || "").trim();
  const svc = state.services.find((s) => s.id === state.serviceId);
  if (!svc || !state.slotStart) return;

  const start = state.slotStart;
  const end = addMinutes(start, svc.duration_min + (svc.buffer_after_min || 0));

  const { error } = await supabase.from("bookings").insert({
    client_name,
    client_phone,
    employee_id: state.employeeId,
    service_id: state.serviceId,
    appointment_at: start.toISOString(),
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    status: "confirmed",
    source: "online",
  });

  if (error) {
    alert(error.message);
    return;
  }

  form.hidden = true;
  doneMsg.hidden = false;
  await load();
});

if (supabase) await load();
