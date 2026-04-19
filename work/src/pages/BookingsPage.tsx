import { useCallback, useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useBookingsRealtime } from "../hooks/useSalonRealtime";
import { useAuth } from "../context/AuthContext";
import { useEffectiveRole } from "../context/EffectiveRoleContext";
import type { AppointmentRow } from "../types/database";

/* ============================================================
 * BookingsPage — список всех записей.
 *
 * UX-прокачка:
 *   • Поиск по имени клиента / телефону / услуге / мастеру / заметке.
 *   • Сегментированный фильтр статуса: Все / Активные / Ожидают /
 *     Подтверждены / Отменены. По умолчанию «Активные» (= не cancelled),
 *     потому что 99% времени отменённые не нужны и зашумляют список.
 *   • Empty/Filtered-empty/Error состояния — раньше на пустой ответ или
 *     сетевую ошибку показывалась пустая таблица без объяснения.
 *   • Счётчик «X из N» — сразу видно, отрезала фильтрация половину или
 *     вообще ничего не нашлось.
 * ============================================================ */

type StaffName = { id: string; name: string };
type ServiceName = { id: string; name: string };

type StatusFilter = "all" | "active" | "pending" | "confirmed" | "cancelled";

const STATUS_FILTERS: StatusFilter[] = [
  "active",
  "pending",
  "confirmed",
  "cancelled",
  "all",
];

function passesStatus(filter: StatusFilter, status: string): boolean {
  if (filter === "all") return true;
  if (filter === "active") return status !== "cancelled";
  return status === filter;
}

export function BookingsPage() {
  const { t } = useTranslation();
  const { staffMember } = useAuth();
  const { canManage, isWorkerOnlyEffective } = useEffectiveRole();

  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [staffNames, setStaffNames] = useState<StaffName[]>([]);
  const [services, setServices] = useState<ServiceName[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /* фильтры/поиск */
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");

  const load = useCallback(async () => {
    setLoadError(null);
    let q = supabase.from("appointments").select("*").order("start_time", { ascending: false });
    if (isWorkerOnlyEffective && staffMember) {
      q = q.eq("staff_id", staffMember.id);
    }
    /* `appointments.service_id` мог быть записан из двух каталогов: legacy `services`
     * (bigint) и актуальный `service_listings` (uuid). Грузим оба источника и мёржим
     * по стринговому id — иначе в колонке «Услуга» у новых записей всегда прочерк. */
    try {
      const [b, e, legacySvc, listingSvc] = await Promise.all([
        q,
        supabase.from("staff").select("id,name"),
        supabase.from("services").select("id,name_et"),
        supabase.from("service_listings").select("id,name"),
      ]);
      if (b.error) throw b.error;
      if (b.data) setRows(b.data as AppointmentRow[]);
      if (e.data) setStaffNames(e.data as StaffName[]);
      const merged: ServiceName[] = [];
      if (legacySvc.data) {
        for (const r of legacySvc.data as Array<{ id: unknown; name_et: string | null }>) {
          merged.push({ id: String(r.id), name: r.name_et ?? "" });
        }
      }
      if (listingSvc.data) {
        for (const r of listingSvc.data as Array<{ id: unknown; name: string | null }>) {
          merged.push({ id: String(r.id), name: r.name ?? "" });
        }
      }
      setServices(merged);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t("bookings.loadError"));
    } finally {
      setLoading(false);
    }
  }, [isWorkerOnlyEffective, staffMember, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useBookingsRealtime(load);

  /* Подготовка отфильтрованного списка. */
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((b) => {
      if (!passesStatus(statusFilter, b.status)) return false;
      if (!q) return true;
      const em = staffNames.find((x) => x.id === b.staff_id);
      const sv = services.find((x) => x.id === String(b.service_id));
      const haystack = [
        b.client_name,
        b.client_phone,
        em?.name,
        sv?.name,
        b.note,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search, statusFilter, staffNames, services]);

  const filtersActive = statusFilter !== "active" || search.trim().length > 0;

  async function cancelBooking(id: string) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    if (canManage) {
      /* ok */
    } else if (isWorkerOnlyEffective && staffMember && row.staff_id === staffMember.id) {
      /* ok */
    } else {
      return;
    }
    let q = supabase.from("appointments").update({ status: "cancelled" }).eq("id", id);
    if (!canManage && isWorkerOnlyEffective && staffMember) {
      q = q.eq("staff_id", staffMember.id);
    }
    await q;
    load();
  }

  function statusLabel(status: string) {
    if (status === "pending") return t("bookings.statusPending");
    if (status === "confirmed") return t("bookings.statusConfirmed");
    if (status === "cancelled") return t("bookings.statusCancelled");
    return status;
  }

  function statusTone(status: string) {
    if (status === "pending") return "border-amber-700/60 bg-amber-950/40 text-amber-200";
    if (status === "confirmed") return "border-emerald-700/60 bg-emerald-950/40 text-emerald-200";
    if (status === "cancelled") return "border-zinc-700 bg-zinc-900 text-zinc-500";
    return "border-zinc-700 bg-zinc-900 text-zinc-300";
  }

  /* Источник записи (миграция 053). Цветовая схема выбрана так, чтобы
   * сразу отличать «пришёл сам через сайт» (нейтральный голубой) от
   * «принял сотрудник» (фиолетовый/изумрудный — подчёркивает участие
   * персонала). Legacy-значения отображаем серым «прочерком», чтобы не
   * путать аналитику. */
  function sourceMeta(source: string | null | undefined): {
    label: string;
    tone: string;
  } | null {
    const s = (source ?? "").toLowerCase();
    if (s === "public_site") {
      return {
        label: t("bookings.sourceSite", { defaultValue: "Сайт" }),
        tone: "border-sky-800/60 bg-sky-950/40 text-sky-200",
      };
    }
    if (s === "reception") {
      return {
        label: t("bookings.sourceReception", { defaultValue: "Ресепшен" }),
        tone: "border-violet-800/60 bg-violet-950/40 text-violet-200",
      };
    }
    if (s === "crm") {
      return {
        label: t("bookings.sourceCrm", { defaultValue: "CRM" }),
        tone: "border-emerald-800/60 bg-emerald-950/40 text-emerald-200",
      };
    }
    // Не отображаем бейдж для пустого/неизвестного — чтобы legacy-записи
    // (старая `online`/`manual`) не вводили в заблуждение.
    return null;
  }

  function filterLabel(f: StatusFilter): string {
    if (f === "all") return t("bookings.filterAll");
    if (f === "active") return t("bookings.filterActive");
    if (f === "pending") return t("bookings.filterPending");
    if (f === "confirmed") return t("bookings.filterConfirmed");
    return t("bookings.filterCancelled");
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t("bookings.title")}</h1>
          <p className="mt-0.5 text-sm text-zinc-500">{t("bookings.subtitle")}</p>
        </div>
        <p className="text-xs text-zinc-500">
          {t("bookings.counter", { shown: visible.length, total: rows.length })}
        </p>
      </header>

      {/* ── Фильтр-bar: поиск + segmented status ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("bookings.search")}
            className="w-full rounded-lg border border-zinc-800 bg-black/40 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-600/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
          />
        </div>
        <div
          role="tablist"
          aria-label={t("bookings.status")}
          className="flex flex-wrap items-center gap-1 rounded-lg border border-zinc-800 bg-black/30 p-1"
        >
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={statusFilter === f}
              onClick={() => setStatusFilter(f)}
              className={
                "rounded-md px-2.5 py-1 text-xs font-medium transition " +
                (statusFilter === f
                  ? "bg-zinc-200 text-black"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100")
              }
            >
              {filterLabel(f)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Состояния ── */}
      {loadError ? (
        <div className="rounded-lg border border-red-900/50 bg-red-950/40 p-4 text-sm text-red-200">
          <p className="font-medium">{t("bookings.loadError")}</p>
          <p className="mt-1 text-xs text-red-300/80">{loadError}</p>
        </div>
      ) : loading ? (
        <p className="text-zinc-500">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-10 text-center text-sm text-zinc-500">
          {t("bookings.empty")}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-10 text-center text-sm text-zinc-400">
          <p>{t("bookings.emptyFiltered")}</p>
          {filtersActive && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setStatusFilter("active");
              }}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 transition hover:border-zinc-600 hover:text-white"
            >
              {t("bookings.resetFilters")}
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-950 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">{t("bookings.when")}</th>
                <th className="px-4 py-3">{t("bookings.client")}</th>
                <th className="px-4 py-3">{t("bookings.staff")}</th>
                <th className="px-4 py-3">{t("bookings.service")}</th>
                <th className="px-4 py-3">{t("bookings.status")}</th>
                <th className="px-4 py-3">
                  {t("bookings.source", { defaultValue: "Источник" })}
                </th>
                {(canManage || (isWorkerOnlyEffective && staffMember)) && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {visible.map((b) => {
                const when = b.start_time;
                const em = staffNames.find((x) => x.id === b.staff_id);
                const sv = services.find((x) => x.id === String(b.service_id));
                const src = sourceMeta(b.source);
                const acceptedBy = b.created_by_staff_id
                  ? staffNames.find((x) => x.id === b.created_by_staff_id)
                  : null;
                return (
                  <tr key={b.id} className="bg-zinc-950/80">
                    <td className="px-4 py-3 text-zinc-300">
                      {when ? format(parseISO(when), "yyyy-MM-dd HH:mm") : t("common.dash")}
                    </td>
                    <td className="px-4 py-3 text-white">
                      <div>{b.client_name}</div>
                      {b.client_phone && (
                        <div className="mt-0.5 text-[11px] text-zinc-500">{b.client_phone}</div>
                      )}
                      {b.note && (
                        <div className="mt-0.5 text-xs italic text-zinc-500" title={b.note}>
                          &laquo;{b.note.length > 80 ? b.note.slice(0, 80) + "…" : b.note}&raquo;
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{em?.name ?? t("common.dash")}</td>
                    <td className="px-4 py-3 text-zinc-400">{sv?.name || t("common.dash")}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
                          statusTone(b.status)
                        }
                      >
                        {statusLabel(b.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {src ? (
                        <span
                          className={
                            "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
                            src.tone
                          }
                          title={
                            acceptedBy
                              ? t("bookings.acceptedBy", {
                                  defaultValue: "Принял: {{name}}",
                                  name: acceptedBy.name,
                                })
                              : undefined
                          }
                        >
                          {src.label}
                        </span>
                      ) : (
                        <span className="text-zinc-600">{t("common.dash")}</span>
                      )}
                      {acceptedBy && (
                        <div className="mt-0.5 text-[10px] text-zinc-500">
                          {t("bookings.acceptedBy", {
                            defaultValue: "Принял: {{name}}",
                            name: acceptedBy.name,
                          })}
                        </div>
                      )}
                    </td>
                    {(canManage || (isWorkerOnlyEffective && staffMember)) && (
                      <td className="px-4 py-3">
                        {b.status !== "cancelled" && (
                          <button
                            type="button"
                            onClick={() => void cancelBooking(b.id)}
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            {t("bookings.cancel")}
                          </button>
                        )}
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
