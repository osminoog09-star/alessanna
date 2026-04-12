import { useCallback, useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useBookingsRealtime } from "../hooks/useSalonRealtime";
import { useAuth } from "../context/AuthContext";
import { useEffectiveRole } from "../context/EffectiveRoleContext";

type LineRow = {
  id: string;
  appointment_id: string;
  staff_id: string;
  service_id: number;
  start_time: string;
  end_time: string;
  appointments: { status: string; client_name: string } | null;
  services: { name_et: string } | null;
  staff: { name: string } | null;
};

export function BookingsPage() {
  const { t } = useTranslation();
  const { staffMember, isReceptionMode } = useAuth();
  const { canManage, isWorkerOnlyEffective } = useEffectiveRole();
  const [rows, setRows] = useState<LineRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    let q = supabase
      .from("appointment_services")
      .select(
        `
        id, appointment_id, staff_id, service_id, start_time, end_time,
        appointments ( status, client_name ),
        services ( name_et ),
        staff ( name )
      `
      )
      .order("start_time", { ascending: false });
    if (isWorkerOnlyEffective && staffMember) {
      q = q.eq("staff_id", staffMember.id);
    }
    const { data, error } = await q;
    if (!error && data) {
      setRows(
        (data as LineRow[]).filter((r) => r.appointments && r.appointments.status !== "cancelled")
      );
    }
    setLoading(false);
  }, [isWorkerOnlyEffective, staffMember]);

  useEffect(() => {
    void load();
  }, [load]);

  useBookingsRealtime(load);

  const canShowCancel =
    canManage || isReceptionMode || (isWorkerOnlyEffective && staffMember);

  async function cancelVisit(appointmentId: string) {
    if (!canShowCancel) return;
    if (!canManage && !isReceptionMode && isWorkerOnlyEffective && staffMember) {
      const { data: touch } = await supabase
        .from("appointment_services")
        .select("id")
        .eq("appointment_id", appointmentId)
        .eq("staff_id", staffMember.id)
        .limit(1);
      if (!touch?.length) return;
    }
    await supabase.from("appointments").update({ status: "cancelled" }).eq("id", appointmentId);
    void load();
  }

  function statusLabel(status: string) {
    if (status === "pending") return t("bookings.statusPending");
    if (status === "confirmed") return t("bookings.statusConfirmed");
    if (status === "cancelled") return t("bookings.statusCancelled");
    return status;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-white">{t("bookings.title")}</h1>
        <p className="text-sm text-zinc-500">{t("bookings.subtitle")}</p>
      </header>

      {loading ? (
        <p className="text-zinc-500">{t("common.loading")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-950 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">{t("bookings.when")}</th>
                <th className="px-4 py-3">{t("bookings.client")}</th>
                <th className="px-4 py-3">{t("bookings.staff")}</th>
                <th className="px-4 py-3">{t("bookings.service")}</th>
                <th className="px-4 py-3">{t("bookings.status")}</th>
                {canShowCancel && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {rows.map((r) => {
                const st = r.appointments?.status ?? "confirmed";
                return (
                  <tr key={r.id} className="bg-zinc-950/80">
                    <td className="px-4 py-3 text-zinc-300">
                      {r.start_time && r.end_time
                        ? `${format(parseISO(r.start_time), "yyyy-MM-dd HH:mm")}–${format(parseISO(r.end_time), "HH:mm")}`
                        : t("common.dash")}
                    </td>
                    <td className="px-4 py-3 text-white">{r.appointments?.client_name ?? t("common.dash")}</td>
                    <td className="px-4 py-3 text-zinc-400">{r.staff?.name ?? t("common.dash")}</td>
                    <td className="px-4 py-3 text-zinc-400">{r.services?.name_et ?? t("common.dash")}</td>
                    <td className="px-4 py-3 capitalize text-zinc-400">{statusLabel(st)}</td>
                    {canShowCancel && (
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => void cancelVisit(r.appointment_id)}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          {t("bookings.cancelVisit")}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
