import { FormEvent, useEffect, useMemo, useState } from "react";
import { addMinutes } from "date-fns";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import type { StaffMember, StaffServiceRow, ServiceRow, AppointmentRow } from "../types/database";
import { staffEligibleForService, servicesEligibleForStaff } from "../lib/roles";
import { restrictAndOrderStaffByServiceHall, serviceRowToPublicCatalogEntry } from "../lib/publicMasterPanel";
import { overlapsExistingAppointments } from "../lib/slots";
import { priceMaxEur } from "../lib/serviceListing";
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
  layout?: "modal" | "drawer";
  /** Колонки «волосы» / «ногти» (как на ресепшене). Если заданы вместе с fullPanel — список мастеров режется по залу выбранной услуги. */
  mastersHallSplit?: { hair: StaffMember[]; nails: StaffMember[] };
  mastersHallFullPanel?: StaffMember[];
  /** When set, the modal edits this appointment (UPDATE + delete) instead of creating one. */
  editAppointment?: AppointmentRow | null;
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
  layout = "modal",
  mastersHallSplit,
  mastersHallFullPanel,
  editAppointment = null,
}: Props) {
  const { t, i18n } = useTranslation();
  const isEdit = editAppointment != null;
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [staffId, setStaffId] = useState(initialStaffId);
  /* `services.id` приходит и как UUID (service_listings), и как bigint (services).
   * Поэтому serviceId — `string | number`, чтобы fallback-цепочки не ломались. */
  const [serviceId, setServiceId] = useState<string | number>(0);
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
        priceMaxEur: priceMaxEur(s.price_max_cents),
        categoryName: s.category,
      })),
    [eligibleServices],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    setError("");
    if (editAppointment) {
      setStaffId(editAppointment.staff_id);
      setClientName(editAppointment.client_name ?? "");
      setClientPhone(editAppointment.client_phone ?? "");
      setServiceId(editAppointment.service_id as string | number);
      return;
    }
    setStaffId(initialStaffId);
    setClientName("");
    setClientPhone("");
    const firstSvc = eligibleServices[0]?.id ?? services.find((s) => s.active)?.id ?? 0;
    setServiceId(firstSvc);
  }, [open, initialStaffId, eligibleServices, services, editAppointment]);

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
    /* When editing keep the existing start; when creating reject past slots. */
    const start = isEdit && editAppointment ? new Date(editAppointment.start_time) : initialStart;
    if (!isEdit && start.getTime() < Date.now()) {
      setSaving(false);
      setError("Нельзя создать запись в прошедшее время. Выберите актуальный слот.");
      return;
    }
    const end = addMinutes(start, svc.duration_min + svc.buffer_after_min);

    const { data: existingRows, error: loadErr } = await supabase
      .from("appointments")
      .select("id, start_time, end_time")
      .eq("staff_id", staffId)
      .neq("status", "cancelled")
      .limit(500);
    if (loadErr) {
      setSaving(false);
      setError(t("auth.error.rpcFailed", { message: loadErr.message }));
      return;
    }
    const others = ((existingRows ?? []) as { id: string; start_time: string; end_time: string }[])
      .filter((r) => !isEdit || r.id !== editAppointment!.id);
    if (overlapsExistingAppointments(start, end, others)) {
      setSaving(false);
      setError(t("modal.overlap"));
      return;
    }

    /* Колонки `source` и `notes` нет в актуальной схеме `appointments` (миграции
     *  030/031). Если включить их в payload — PostgREST падает с «Could not find
     *  the 'source' column of 'appointments' in the schema cache» и запись не
     *  создаётся. Поэтому отправляем только реально существующие колонки. */
    const normalizedClientName = clientName.trim() || "Клиент (CRM)";
    const payload = {
      client_name: normalizedClientName,
      client_phone: clientPhone.trim() || null,
      note: null,
      staff_id: staffId,
      service_id: serviceId,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      status: "confirmed",
    };
    const { error: writeErr } = isEdit
      ? await supabase.from("appointments").update(payload).eq("id", editAppointment!.id)
      : await supabase.from("appointments").insert(payload);
    setSaving(false);
    if (writeErr) {
      if (writeErr.code === "23P01" || /overlap|занят/i.test(String(writeErr.message || ""))) {
        setError(t("modal.overlap"));
        return;
      }
      setError(t("auth.error.rpcFailed", { message: writeErr.message }));
      return;
    }
    onSaved();
    onClose();
    setClientName("");
    setClientPhone("");
  }

  async function handleDelete() {
    if (!editAppointment) return;
    if (!window.confirm(t("modal.deleteConfirm", { defaultValue: "Удалить эту запись?" }))) return;
    setSaving(true);
    const { error: delErr } = await supabase
      .from("appointments")
      .delete()
      .eq("id", editAppointment.id);
    setSaving(false);
    if (delErr) {
      setError(t("auth.error.rpcFailed", { message: delErr.message }));
      return;
    }
    onSaved();
    onClose();
  }

  const shell =
    variant === "pro"
      ? "border border-gold/25 bg-panel/95 shadow-[0_18px_50px_rgba(0,0,0,0.28)] backdrop-blur-xl"
      : "border border-line/12 bg-panel shadow-2xl";
  const isDrawer = layout === "drawer";
  const activeStaffName = eligibleStaff.find((s) => s.id === staffId)?.name ?? initialStaffRow?.name ?? "—";

  return (
    <div
      className={`fixed inset-0 z-[60] ${isDrawer ? "flex items-stretch justify-end bg-black/35 p-0 backdrop-blur-[1px]" : "flex items-center justify-center bg-black/75 p-4 backdrop-blur-[2px]"}`}
      role="presentation"
      onClick={onClose}
    >
      <div
        className={`${isDrawer ? "h-full w-full max-w-[440px] overflow-y-auto rounded-none border-l p-5 sm:max-w-[460px]" : "max-h-[min(92vh,calc(100vh-2rem))] w-full max-w-md overflow-y-auto rounded-2xl p-6"} ${shell}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="booking-modal-title" className="text-lg font-semibold text-fg">
              {isEdit ? t("modal.editBooking", { defaultValue: "Редактировать запись" }) : t("modal.newBooking")}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {initialStart.toLocaleString(i18n.language, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-line/15 bg-surface/80 text-lg leading-none text-fg hover:border-line/30 hover:bg-surface"
            aria-label={t("modal.closeBooking")}
          >
            ×
          </button>
        </div>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="rounded-xl border border-line/12 bg-canvas/30 px-3 py-2">
            <p className="text-xs text-muted">{t("calendar.day", { defaultValue: "День" })}</p>
            <p className="text-sm font-medium text-fg">
              {initialStart.toLocaleString(i18n.language, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
            <p className="mt-1 text-xs text-muted">
              {t("modal.staff")} · <span className="text-fg">{activeStaffName}</span>
            </p>
          </div>

          <div>
            <label className="text-xs text-muted">{t("modal.service")}</label>
            {eligibleServices.length > 0 ? (
              <div className="mt-2 rounded-xl border border-line/12 bg-canvas/30 p-2">
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
              <label className="text-xs text-muted">{t("modal.staff")}</label>
              <select
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line/15 bg-panel px-3 py-2 text-sm text-fg"
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
            <label className="text-xs text-muted">{t("modal.client")}</label>
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Необязательно"
              className="mt-1 w-full rounded-lg border border-line/15 bg-panel px-3 py-2 text-sm text-fg"
            />
          </div>
          <div>
            <label className="text-xs text-muted">{t("modal.phone")}</label>
            <input
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              placeholder="Необязательно"
              className="mt-1 w-full rounded-lg border border-line/15 bg-panel px-3 py-2 text-sm text-fg"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex items-center justify-end gap-2 pt-2">
            {isEdit && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="mr-auto rounded-lg border border-red-500/30 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                {t("common.delete", { defaultValue: "Удалить" })}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line/15 px-4 py-2 text-sm text-muted hover:bg-surface/80 hover:text-fg"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              className={`rounded-lg px-4 py-2 text-sm font-medium text-fg disabled:opacity-50 ${
                variant === "pro"
                  ? "bg-gradient-to-r from-gold-deep to-gold hover:brightness-110 shadow-[0_0_24px_rgba(196,165,116,0.25)]"
                  : "bg-sky-600 hover:bg-sky-500"
              }`}
            >
              {isEdit ? t("common.save", { defaultValue: "Сохранить" }) : t("calendar.createBooking", { defaultValue: "Сделать запись" })}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
