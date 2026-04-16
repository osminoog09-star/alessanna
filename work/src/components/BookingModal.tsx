import { FormEvent, useEffect, useMemo, useState } from "react";
import { addMinutes } from "date-fns";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import type { StaffMember, StaffServiceRow, ServiceRow } from "../types/database";
import { staffEligibleForService, servicesEligibleForStaff } from "../lib/roles";
import { eurFromCents } from "../lib/format";
import { overlapsExistingAppointments } from "../lib/slots";

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
  const [serviceId, setServiceId] = useState(0);
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
    if (!clientName.trim()) {
      setError(t("modal.fillAll"));
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
    const end = addMinutes(start, svc.duration_min + svc.buffer_after_min);

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

    const { error: insErr } = await supabase.from("appointments").insert({
      client_name: clientName.trim(),
      client_phone: clientPhone.trim() || null,
      staff_id: staffId,
      service_id: serviceId,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      status: "confirmed",
      source: "manual",
    });
    setSaving(false);
    if (insErr) {
      setError(t("auth.error.rpcFailed", { message: insErr.message }));
      return;
    }
    onSaved();
    onClose();
    setClientName("");
    setClientPhone("");
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
            <select
              value={serviceId || ""}
              onChange={(e) => setServiceId(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
            >
              {eligibleServices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name_et} · {eurFromCents(s.price_cents)}
                </option>
              ))}
            </select>
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
              required
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500">{t("modal.phone")}</label>
            <input
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
            />
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
