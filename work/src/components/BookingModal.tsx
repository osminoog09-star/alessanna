import { FormEvent, useEffect, useMemo, useState } from "react";
import { addMinutes } from "date-fns";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import type { StaffMember, StaffServiceRow, ServiceRow } from "../types/database";
import { staffEligibleForService, servicesEligibleForStaff } from "../lib/roles";
import { eurFromCents } from "../lib/format";
import { overlapsExistingAppointments } from "../lib/slots";

const LAST_SERVICE_KEY = "crm:last-booking-service-id";
const LAST_EXTRA_BLOCK_KEY = "crm:last-booking-extra-block-min";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  initialStart: Date;
  initialStaffId: string;
  staffList: StaffMember[];
  services: ServiceRow[];
  links?: StaffServiceRow[];
  lockStaff?: boolean;
  variant?: "default" | "pro";
};

export function BookingModal({
  open,
  onClose,
  onSaved,
  initialStart,
  initialStaffId,
  staffList,
  services,
  links = [],
  lockStaff = false,
  variant = "default",
}: Props) {
  const { t, i18n } = useTranslation();
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [staffId, setStaffId] = useState(initialStaffId);
  /* `services.id` приходит и как UUID (service_listings), и как bigint (services).
   * Поэтому serviceId — `string | number`, чтобы fallback-цепочки не ломались. */
  const [serviceId, setServiceId] = useState<string | number>(0);
  const [manualServiceNote, setManualServiceNote] = useState("");
  const [extraBlockMin, setExtraBlockMin] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const initialStaffRow = useMemo(
    () => staffList.find((e) => e.id === initialStaffId) ?? null,
    [staffList, initialStaffId]
  );

  const eligibleServices = useMemo(() => {
    if (lockStaff)
      return servicesEligibleForStaff(services, links, initialStaffId, initialStaffRow);
    return services.filter((s) => s.active);
  }, [services, links, lockStaff, initialStaffId, initialStaffRow]);

  const eligibleStaff = useMemo(
    () => staffEligibleForService(staffList, links, serviceId || null),
    [staffList, links, serviceId]
  );

  useEffect(() => {
    if (!open) return;
    setStaffId(initialStaffId);
    setClientName("");
    setClientPhone("");
    setManualServiceNote("");
    setExtraBlockMin(0);
    setError("");
    let preferredService: string | number | null = null;
    let preferredExtraBlock = 0;
    try {
      const raw = localStorage.getItem(LAST_SERVICE_KEY);
      if (raw && raw.trim()) {
        const n = Number(raw);
        preferredService = Number.isFinite(n) && String(n) === raw ? n : raw;
      }
      const rawExtra = Number(localStorage.getItem(LAST_EXTRA_BLOCK_KEY) || 0);
      preferredExtraBlock = Number.isFinite(rawExtra) ? Math.max(0, Math.min(240, rawExtra)) : 0;
    } catch {
      /* ignore storage errors */
    }
    const fallback = eligibleServices[0]?.id ?? services.find((s) => s.active)?.id ?? 0;
    const nextService =
      preferredService != null && eligibleServices.some((s) => String(s.id) === String(preferredService))
        ? preferredService
        : fallback;
    setServiceId(nextService);
    setExtraBlockMin(preferredExtraBlock);
  }, [open, initialStaffId, eligibleServices, services]);

  useEffect(() => {
    if (!open) return;
    if (lockStaff) return;
    if (!eligibleStaff.length) return;
    if (!eligibleStaff.some((e) => e.id === staffId)) {
      setStaffId(eligibleStaff[0].id);
    }
  }, [open, lockStaff, eligibleStaff, staffId]);

  if (!open) return null;

  const svc = services.find((s) => s.id === serviceId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!svc) {
      setError(t("modal.pickService"));
      return;
    }
    if (lockStaff) {
      const allowed = servicesEligibleForStaff(services, links, initialStaffId, initialStaffRow);
      if (!allowed.some((s) => s.id === serviceId)) {
        setError(t("modal.pickService"));
        return;
      }
    }
    const staffOk = lockStaff || eligibleStaff.some((e) => e.id === staffId && e.active);
    if (!staffOk) {
      setError(t("modal.pickStaff"));
      return;
    }
    setSaving(true);
    const start = initialStart;
    if (start.getTime() < Date.now()) {
      setSaving(false);
      setError("Нельзя создать запись в прошедшее время. Выберите актуальный слот.");
      return;
    }
    const safeExtraBlockMin = Number.isFinite(extraBlockMin) ? Math.max(0, Math.min(240, extraBlockMin)) : 0;
    const end = addMinutes(start, svc.duration_min + svc.buffer_after_min + safeExtraBlockMin);

    const { data: existingRows, error: loadErr } = await supabase
      .from("appointments")
      .select("start_time, end_time")
      .eq("staff_id", staffId)
      .neq("status", "cancelled")
      .limit(500);
    if (loadErr) {
      setSaving(false);
      setError(t("auth.error.rpcFailed", { message: loadErr.message }));
      return;
    }
    if (overlapsExistingAppointments(start, end, (existingRows ?? []) as { start_time: string; end_time: string }[])) {
      setSaving(false);
      setError(t("modal.overlap"));
      return;
    }

    /* Колонки `source` и `notes` нет в актуальной схеме `appointments` (миграции
     *  030/031). Если включить их в payload — PostgREST падает с «Could not find
     *  the 'source' column of 'appointments' in the schema cache» и запись не
     *  создаётся. Поэтому отправляем только реально существующие колонки. */
    const normalizedClientName = clientName.trim() || "Клиент (CRM)";
    const normalizedManualService = manualServiceNote.trim();
    const noteParts = [
      normalizedManualService ? `Услуга вручную: ${normalizedManualService}` : null,
      safeExtraBlockMin > 0 ? `Доп. блок после услуги: ${safeExtraBlockMin} мин` : null,
    ].filter(Boolean);
    const { error: insErr } = await supabase.from("appointments").insert({
      client_name: normalizedClientName,
      client_phone: clientPhone.trim() || null,
      note: noteParts.length ? noteParts.join("\n") : null,
      staff_id: staffId,
      service_id: serviceId,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      status: "confirmed",
    });
    setSaving(false);
    if (insErr) {
      if (insErr.code === "23P01" || /overlap|занят/i.test(String(insErr.message || ""))) {
        setError(t("modal.overlap"));
        return;
      }
      setError(t("auth.error.rpcFailed", { message: insErr.message }));
      return;
    }
    try {
      localStorage.setItem(LAST_SERVICE_KEY, String(serviceId));
      localStorage.setItem(LAST_EXTRA_BLOCK_KEY, String(safeExtraBlockMin));
    } catch {
      /* ignore storage errors */
    }
    onSaved();
    onClose();
    setClientName("");
    setClientPhone("");
    setManualServiceNote("");
    setExtraBlockMin(0);
  }

  const shell =
    variant === "pro"
      ? "border border-amber-500/25 bg-zinc-950/90 shadow-[0_0_60px_rgba(245,158,11,0.12),0_24px_80px_rgba(0,0,0,0.75)] backdrop-blur-xl"
      : "border border-zinc-800 bg-zinc-950 shadow-2xl";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-[2px]">
      <div className={`w-full max-w-md rounded-2xl p-6 ${shell}`}>
        <h2 className="text-lg font-semibold text-white">{t("modal.newBooking")}</h2>
        <p className="mt-1 text-sm text-zinc-500">
          {initialStart.toLocaleString(i18n.language, {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div>
            <label className="text-xs text-zinc-500">{t("modal.service")}</label>
            {eligibleServices.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {eligibleServices.slice(0, 8).map((s) => {
                  const active = s.id === serviceId;
                  return (
                    <button
                      key={`quick-${s.id}`}
                      type="button"
                      onClick={() => setServiceId(s.id)}
                      className={`rounded-md border px-2 py-1 text-[11px] transition ${
                        active
                          ? "border-sky-500 bg-sky-950/50 text-sky-100"
                          : "border-zinc-700 bg-zinc-900/40 text-zinc-300 hover:border-zinc-500"
                      }`}
                    >
                      {s.name_et}
                    </button>
                  );
                })}
              </div>
            )}
            <select
              value={serviceId || ""}
              onChange={(e) => {
                /* UUID-id (service_listings) → строкой; bigint-id (services) → числом. */
                const v = e.target.value;
                const n = Number(v);
                setServiceId(Number.isFinite(n) && String(n) === v ? n : v);
              }}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
              disabled={!eligibleServices.length}
            >
              {eligibleServices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name_et} · {eurFromCents(s.price_cents)}
                </option>
              ))}
            </select>
            {!eligibleServices.length && (
              /* Раньше тут просто был пустой dropdown — ни клиент, ни менеджер
               *  не понимали, что делать. Показываем явное сообщение со ссылкой
               *  на источник проблемы (нет привязок мастер↔услуга в /admin/staff
               *  или нет активных услуг в /admin/services). */
              <p className="mt-1 text-xs text-amber-500/90">{t("modal.noServices")}</p>
            )}
          </div>
          {!lockStaff && (
            <div>
              <label className="text-xs text-zinc-500">{t("modal.staff")}</label>
              <select
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
              >
                {eligibleStaff
                  .filter((x) => x.active)
                  .map((em) => (
                    <option key={em.id} value={em.id}>
                      {em.name}
                    </option>
                  ))}
              </select>
              {!eligibleStaff.filter((x) => x.active).length && (
                <p className="mt-1 text-xs text-amber-500/90">{t("modal.pickStaff")}</p>
              )}
            </div>
          )}
          <div>
            <label className="text-xs text-zinc-500">{t("modal.client")}</label>
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Необязательно"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500">{t("modal.phone")}</label>
            <input
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              placeholder="Необязательно"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500">Описание услуги вручную (необязательно)</label>
            <textarea
              value={manualServiceNote}
              onChange={(e) => setManualServiceNote(e.target.value)}
              rows={2}
              placeholder="Например: сложное окрашивание + уход"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500">Закрыть время после услуги (мин)</label>
            <input
              type="number"
              min={0}
              max={240}
              step={5}
              value={extraBlockMin}
              onChange={(e) => setExtraBlockMin(Number(e.target.value || 0))}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Добавляет дополнительный блок после услуги, чтобы следующий слот был позже.
            </p>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                variant === "pro"
                  ? "bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 shadow-[0_0_24px_rgba(245,158,11,0.25)]"
                  : "bg-sky-600 hover:bg-sky-500"
              }`}
            >
              {t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
