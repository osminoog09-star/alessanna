import { FormEvent, useEffect, useMemo, useState } from "react";
import { addMinutes } from "date-fns";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import type { StaffMember, StaffServiceRow, ServiceRow } from "../types/database";
import { staffEligibleForService, servicesEligibleForStaff } from "../lib/roles";
import { restrictAndOrderStaffByServiceHall, serviceRowToPublicCatalogEntry } from "../lib/publicMasterPanel";
import { overlapsExistingAppointments } from "../lib/slots";
import { ServiceListPicker } from "./service-picker/ServiceListPicker";

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
  /** Колонки «волосы» / «ногти» (как на ресепшене). Если заданы вместе с fullPanel — список мастеров режется по залу выбранной услуги. */
  mastersHallSplit?: { hair: StaffMember[]; nails: StaffMember[] };
  mastersHallFullPanel?: StaffMember[];
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
  mastersHallSplit,
  mastersHallFullPanel,
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

  const eligibleStaff = useMemo(() => {
    const base = staffEligibleForService(staffList, links, serviceId || null);
    if (!mastersHallSplit || !mastersHallFullPanel) return base;
    const svc = services.find((s) => s.id === serviceId);
    return restrictAndOrderStaffByServiceHall(
      base,
      serviceRowToPublicCatalogEntry(svc),
      mastersHallSplit,
      mastersHallFullPanel,
    );
  }, [staffList, links, serviceId, services, mastersHallSplit, mastersHallFullPanel]);

  const modalServiceRows = useMemo(
    () =>
      eligibleServices.map((s) => ({
        id: String(s.id),
        name: s.name_et,
        durationMin: s.duration_min,
        priceEur: Number.isFinite(s.price_cents) ? s.price_cents / 100 : null,
        categoryName: s.category,
      })),
    [eligibleServices],
  );

  useEffect(() => {
    if (!open) return;
    setStaffId(initialStaffId);
    setClientName("");
    setClientPhone("");
    setManualServiceNote("");
    setExtraBlockMin(0);
    setError("");
    const firstSvc = eligibleServices[0]?.id ?? services.find((s) => s.active)?.id ?? 0;
    setServiceId(firstSvc);
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
            {eligibleServices.length > 0 ? (
              <div className="mt-2 rounded-xl border border-zinc-800 bg-black/40 p-2">
                <ServiceListPicker
                  items={modalServiceRows}
                  selectedId={String(serviceId)}
                  onSelect={(id) => {
                    const row = eligibleServices.find((s) => String(s.id) === id);
                    if (row) setServiceId(row.id);
                  }}
                  t={t}
                  storageKey="crm_booking_modal_service_v1"
                  groupByCategory
                  priceUnknownLabel={t("quickBook.priceOnConfirm")}
                  minLabel={t("quickBook.min")}
                  listMaxClassName="max-h-[min(40vh,320px)]"
                  compact
                />
              </div>
            ) : (
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
