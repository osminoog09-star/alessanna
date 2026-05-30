import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const url = globalThis.SALON_SUPABASE_URL;
const key = globalThis.SALON_SUPABASE_ANON_KEY;
const GC_FUNC_URL = url ? `${url}/functions/v1/google-calendar-sync` : null;

const warnEl = document.getElementById("config-warn");
const servicesEl = document.getElementById("services-list");
const employeesEl = document.getElementById("employees-list");
const slotsEl = document.getElementById("slots-list");
const slotHint = document.getElementById("slot-hint");
const form = document.getElementById("confirm-form");
const doneMsg = document.getElementById("done-msg");
const summaryEl = document.getElementById("booking-summary");
const submitBtn = document.getElementById("submit-btn");
const submitBtnText = document.getElementById("submit-btn-text");

if (!url || !key) warnEl && (warnEl.hidden = false);

const supabase = url && key ? createClient(url, key) : null;

let state = {
  services: [],
  staff: [],
  links: [],
  schedules: [],
  appointments: [],
  serviceId: null,
  staffId: null,
  slotStart: null,
};

// ── Navigation ──────────────────────────────────────────────────────────────

function showStep(n) {
  document.querySelectorAll(".step").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.step === String(n));
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ── Slot computation ─────────────────────────────────────────────────────────

function minutesFromTime(t) {
  const [h, m] = String(t).slice(0, 5).split(":").map(Number);
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
    else { out.push(cur); cur = { ...w }; }
  }
  out.push(cur);
  return out;
}

function approvedWindows(staffId, weekday) {
  const raw = state.schedules
    .filter((s) => String(s.staff_id) === String(staffId) && Number(s.day_of_week) === weekday)
    .map((s) => ({ start: minutesFromTime(s.start_time), end: minutesFromTime(s.end_time) }));
  return mergeWindows(raw);
}

function addMinutes(d, m) {
  return new Date(d.getTime() + m * 60000);
}

function buildSlots(day, staffId, durationMin) {
  const weekday = day.getDay();
  const windows = approvedWindows(staffId, weekday);
  const dayStr = day.toDateString();
  const existing = state.appointments.filter((b) => {
    if (String(b.staff_id) !== String(staffId)) return false;
    if (b.status === "cancelled") return false;
    return new Date(b.start_time).toDateString() === dayStr;
  });

  const slots = [];
  const base = new Date(day);
  base.setHours(0, 0, 0, 0);
  // require at least 1 hour notice
  const earliest = Date.now() + 60 * 60 * 1000;

  for (const w of windows) {
    for (let m = w.start; m + durationMin <= w.end; m += 30) {
      const start = addMinutes(base, m);
      if (start.getTime() < earliest) continue;
      const end = addMinutes(start, durationMin);
      const clash = existing.some((b) => {
        const bs = new Date(b.start_time);
        const be = new Date(b.end_time);
        return start < be && end > bs;
      });
      if (!clash) slots.push(start);
    }
  }
  return slots;
}

// ── Rendering ────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderServices() {
  servicesEl.innerHTML = "";
  if (!state.services.length) {
    servicesEl.innerHTML = "<p class='muted'>Teenuseid ei leitud.</p>";
    return;
  }
  state.services.forEach((s) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card";
    const name = s.name || "Teenus";
    const price = Number.isFinite(Number(s.price_cents)) ? Number(s.price_cents) / 100 : 0;
    const dur = Number(s.duration || 0);
    const meta = [price > 0 ? price.toFixed(0) + " €" : null, dur > 0 ? dur + " min" : null]
      .filter(Boolean).join(" · ");
    btn.innerHTML = `<strong>${escapeHtml(name)}</strong>${meta ? `<br/><span class="muted">${escapeHtml(meta)}</span>` : ""}`;
    btn.addEventListener("click", () => {
      state.serviceId = s.id;
      renderStaff();
      showStep(2);
    });
    servicesEl.appendChild(btn);
  });
}

function staffForService(serviceId) {
  const linked = state.links.filter((l) => String(l.service_id) === String(serviceId));
  if (!linked.length) return state.staff;
  const visible = linked.filter((l) => l.show_on_site !== false).map((l) => String(l.staff_id));
  if (!visible.length) return [];
  return state.staff.filter((e) => visible.includes(String(e.id)));
}

function renderStaff() {
  employeesEl.innerHTML = "";
  const list = staffForService(state.serviceId);
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
      state.staffId = e.id;
      renderSlots();
      showStep(3);
    });
    employeesEl.appendChild(btn);
  });
}

function renderSlots() {
  const svc = state.services.find((s) => String(s.id) === String(state.serviceId));
  const duration = svc ? Number(svc.duration || 60) + Number(svc.buffer_after_min || 0) : 60;
  slotsEl.innerHTML = "";
  slotHint.textContent = "";
  let totalSlots = 0;

  for (let i = 0; i < 14; i++) {
    const day = new Date();
    day.setDate(day.getDate() + i);
    day.setHours(0, 0, 0, 0);
    const slots = buildSlots(day, state.staffId, duration);
    if (!slots.length) continue;
    totalSlots += slots.length;

    const header = document.createElement("div");
    header.className = "slot-day";
    header.textContent = day.toLocaleDateString("et-EE", { weekday: "long", day: "numeric", month: "long" });
    slotsEl.appendChild(header);

    const row = document.createElement("div");
    row.className = "slots";
    slots.forEach((start) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "slot-btn";
      b.textContent = start.toLocaleTimeString("et-EE", { hour: "2-digit", minute: "2-digit" });
      b.addEventListener("click", () => {
        state.slotStart = start;
        renderSummary();
        showStep(4);
      });
      row.appendChild(b);
    });
    slotsEl.appendChild(row);
  }

  if (!totalSlots) {
    slotHint.textContent = "Hetkel pole vabu aegu. Proovi teist meistrit.";
  }
}

function renderSummary() {
  if (!summaryEl) return;
  const svc = state.services.find((s) => String(s.id) === String(state.serviceId));
  const staff = state.staff.find((s) => String(s.id) === String(state.staffId));
  const svcName = svc ? svc.name || "Teenus" : "";
  const staffName = staff ? staff.name : "";
  const slotStr = state.slotStart
    ? state.slotStart.toLocaleDateString("et-EE", { weekday: "long", day: "numeric", month: "long" }) +
      ", kell " + state.slotStart.toLocaleTimeString("et-EE", { hour: "2-digit", minute: "2-digit" })
    : "";

  summaryEl.innerHTML = `
    <div class="summary-row"><span class="summary-label">Teenus:</span> ${escapeHtml(svcName)}</div>
    <div class="summary-row"><span class="summary-label">Meister:</span> ${escapeHtml(staffName)}</div>
    <div class="summary-row"><span class="summary-label">Aeg:</span> ${escapeHtml(slotStr)}</div>
  `;
}

// ── Load ─────────────────────────────────────────────────────────────────────

async function load() {
  if (!supabase) return;

  const { data: panelOn, error: panelErr } = await supabase.rpc("public_site_booking_panel_enabled");
  if (!panelErr && panelOn === false) {
    const root = document.querySelector("main") || document.body;
    if (root) root.innerHTML = "<p style='padding:2rem;color:#888;'>Broneerimine pole hetkel saadaval.</p>";
    return;
  }

  try {
    const [sv, st, lk, sch, ap] = await Promise.all([
      supabase.from("service_listings")
        .select("id,name,duration,buffer_after_min,price_cents,show_on_site")
        .eq("is_active", true)
        .order("sort_order"),
      supabase.from("staff")
        .select("id,name,show_on_marketing_site")
        .eq("is_active", true)
        .order("name"),
      supabase.from("staff_services")
        .select("staff_id,service_id,show_on_site"),
      supabase.from("staff_schedule")
        .select("staff_id,day_of_week,start_time,end_time"),
      supabase.from("appointments")
        .select("staff_id,start_time,end_time,status")
        .in("status", ["pending", "confirmed"])
        .gte("start_time", new Date().toISOString()),
    ]);

    state.services = (sv.data || []).filter((s) => s.show_on_site !== false);
    state.staff = (st.data || []).filter((s) => s.show_on_marketing_site !== false);
    state.links = lk.data || [];
    state.schedules = sch.data || [];
    state.appointments = ap.data || [];
  } catch (err) {
    console.error("[public-book] load error", err);
  }

  renderServices();
}

// ── Back navigation ──────────────────────────────────────────────────────────

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-back]");
  if (!btn) return;
  const target = Number(btn.dataset.back);
  showStep(target);
});

// ── Submit ───────────────────────────────────────────────────────────────────

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!supabase || !state.slotStart || !state.serviceId || !state.staffId) return;

  const fd = new FormData(form);
  const clientName = String(fd.get("client_name") || "").trim();
  const clientPhone = String(fd.get("client_phone") || "").trim();
  const note = String(fd.get("note") || "").trim();
  if (!clientName) return;

  const errEl = document.getElementById("booking-error");
  if (errEl) errEl.hidden = true;

  setSubmitting(true);

  const svc = state.services.find((s) => String(s.id) === String(state.serviceId));
  const durationMin = svc ? Number(svc.duration || 60) + Number(svc.buffer_after_min || 0) : 60;
  const endTime = addMinutes(state.slotStart, durationMin);

  try {
    // 1. Try Google Calendar booking via edge function
    if (GC_FUNC_URL) {
      const gcRes = await fetch(GC_FUNC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
          "apikey": key,
        },
        body: JSON.stringify({
          mode: "website_booking",
          staffId: state.staffId,
          serviceId: state.serviceId,
          clientName,
          clientPhone: clientPhone || null,
          startTime: state.slotStart.toISOString(),
          endTime: endTime.toISOString(),
          note: note || "",
        }),
      });
      const gcData = await gcRes.json().catch(() => ({}));

      if (gcData.ok === true) {
        showSuccess();
        return;
      }

      // If Google Calendar not configured for this master → fall through to direct booking
      const gcErr = String(gcData.error || "");
      const gcUnavailable =
        gcErr.includes("not connected") ||
        gcErr.includes("not configured") ||
        gcErr.includes("sync is disabled") ||
        gcErr.includes("Missing staff.google_calendar_id") ||
        gcErr.includes("Missing salon google_calendar_id");

      if (!gcUnavailable) {
        // Real booking error (slot taken, etc.)
        throw new Error(gcErr || "Broneerimine ebaõnnestus");
      }
    }

    // 2. Fallback: direct booking via public_book_chain RPC
    const { data: rpcData, error: rpcErr } = await supabase.rpc("public_book_chain", {
      p_staff_id: state.staffId,
      p_service_id: state.serviceId,
      p_client_name: clientName,
      p_client_phone: clientPhone || null,
      p_start: state.slotStart.toISOString(),
      p_end: endTime.toISOString(),
      p_note: note || null,
    });

    if (rpcErr) throw new Error(rpcErr.message);
    if (rpcData?.ok === false) throw new Error(rpcData.error || "Broneerimine ebaõnnestus");

    showSuccess();
  } catch (err) {
    const msg = String(err.message || err);
    if (errEl) { errEl.textContent = msg; errEl.hidden = false; }
    else alert(msg);
  } finally {
    setSubmitting(false);
  }
});

function setSubmitting(on) {
  if (submitBtn) submitBtn.disabled = on;
  if (submitBtnText) submitBtnText.textContent = on ? "Saadan..." : "Broneeri";
}

function showSuccess() {
  form && (form.hidden = true);
  doneMsg && (doneMsg.hidden = false);
}

void load();
