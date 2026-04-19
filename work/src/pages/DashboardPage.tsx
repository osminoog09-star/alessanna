import { useCallback, useEffect, useState } from "react";
import { format, parseISO, startOfDay, isSameDay } from "date-fns";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useBookingsRealtime } from "../hooks/useSalonRealtime";
import type { AppointmentRow } from "../types/database";
import { useAuth } from "../context/AuthContext";
import { useEffectiveRole } from "../context/EffectiveRoleContext";
import { eurFromCents } from "../lib/format";

type KpiSnapshot = {
  today_count: number;
  today_revenue_cents: number;
  week_count: number;
  week_revenue_cents: number;
  month_count: number;
  month_revenue_cents: number;
  month_avg_check_cents: number;
  month_cancelled: number;
  email_due: number;
  email_failed: number;
  low_stock_count: number;
};

function KpiCard({
  label,
  value,
  hint,
  tone,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "emerald" | "amber" | "red";
  href?: string;
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-500/40"
      : tone === "amber"
      ? "border-amber-500/40"
      : tone === "red"
      ? "border-red-500/50"
      : "border-zinc-800";
  const inner = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </>
  );
  const cls = `rounded-xl border ${toneClass} bg-zinc-950 p-4 transition hover:border-zinc-600`;
  if (href) {
    return (
      <Link to={href} className={cls}>
        {inner}
      </Link>
    );
  }
  return <div className={cls}>{inner}</div>;
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { staffMember } = useAuth();
  const { isWorkerOnlyEffective, canManage } = useEffectiveRole();
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [kpi, setKpi] = useState<KpiSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    let q = supabase.from("appointments").select("*");
    if (isWorkerOnlyEffective && staffMember) {
      q = q.eq("staff_id", staffMember.id);
    }
    const tasks: Promise<unknown>[] = [
      Promise.resolve(q).then(({ data, error }) => {
        if (!error && data) setAppointments(data as AppointmentRow[]);
      }),
    ];
    if (canManage) {
      tasks.push(
        Promise.resolve(
          supabase.from("analytics_kpi_now").select("*").maybeSingle()
        ).then(({ data, error }) => {
          if (!error && data) setKpi(data as KpiSnapshot);
        })
      );
    }
    await Promise.all(tasks);
    setLoading(false);
  }, [isWorkerOnlyEffective, staffMember, canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  useBookingsRealtime(load);

  const today = startOfDay(new Date());
  const mine = appointments.filter((b) => b.status !== "cancelled");

  const todayAppointments = mine.filter((b) => {
    try {
      return isSameDay(parseISO(b.start_time), today);
    } catch {
      return false;
    }
  });

  const upcoming = mine
    .filter((b) => {
      try {
        return parseISO(b.start_time) >= new Date();
      } catch {
        return false;
      }
    })
    .slice(0, 8);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-white">{t("dashboard.title")}</h1>
        <p className="text-sm text-zinc-500">{t("dashboard.subtitle")}</p>
      </header>

      {loading ? (
        <p className="text-zinc-500">{t("common.loading")}</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {t("dashboard.today")}
              </p>
              <p className="mt-2 text-3xl font-semibold text-white">{todayAppointments.length}</p>
              <p className="text-sm text-zinc-500">{t("common.bookings")}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {t("dashboard.pipeline")}
              </p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {mine.filter((b) => b.status === "pending").length}
              </p>
              <p className="text-sm text-zinc-500">{t("dashboard.pending")}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {t("dashboard.upcoming")}
              </p>
              <p className="mt-2 text-3xl font-semibold text-white">{upcoming.length}</p>
              <p className="text-sm text-zinc-500">{t("dashboard.nextSlots")}</p>
            </div>
          </div>

          {canManage && kpi && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">
                  {t("dashboard.kpi.title", { defaultValue: "Бизнес-метрики" })}
                </h2>
                <Link
                  to="/analytics"
                  className="text-xs text-sky-400 hover:underline"
                >
                  {t("dashboard.kpi.openAnalytics", { defaultValue: "Подробная аналитика →" })}
                </Link>
              </div>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <KpiCard
                  label={t("dashboard.kpi.todayRevenue", { defaultValue: "Выручка сегодня" })}
                  value={eurFromCents(kpi.today_revenue_cents)}
                  hint={t("dashboard.kpi.bookings", { defaultValue: "{{n}} записей", n: kpi.today_count })}
                  tone="emerald"
                />
                <KpiCard
                  label={t("dashboard.kpi.weekRevenue", { defaultValue: "За неделю" })}
                  value={eurFromCents(kpi.week_revenue_cents)}
                  hint={t("dashboard.kpi.bookings", { defaultValue: "{{n}} записей", n: kpi.week_count })}
                />
                <KpiCard
                  label={t("dashboard.kpi.monthRevenue", { defaultValue: "За 30 дней" })}
                  value={eurFromCents(kpi.month_revenue_cents)}
                  hint={t("dashboard.kpi.avgCheck", {
                    defaultValue: "Ср. чек {{v}}",
                    v: eurFromCents(kpi.month_avg_check_cents),
                  })}
                />
                <KpiCard
                  label={t("dashboard.kpi.cancellations", { defaultValue: "Отменено за 30д." })}
                  value={String(kpi.month_cancelled)}
                  tone={kpi.month_cancelled > 0 ? "amber" : undefined}
                />
                {kpi.email_due + kpi.email_failed > 0 && (
                  <KpiCard
                    label={t("dashboard.kpi.emails", { defaultValue: "Очередь писем" })}
                    value={`${kpi.email_due} → ${kpi.email_failed} ✕`}
                    hint={t("dashboard.kpi.emailHint", {
                      defaultValue: "Ждёт / ошибки",
                    })}
                    tone={kpi.email_failed > 0 ? "red" : "amber"}
                    href="/admin/communications"
                  />
                )}
                {kpi.low_stock_count > 0 && (
                  <KpiCard
                    label={t("dashboard.kpi.lowStock", { defaultValue: "Заканчивается" })}
                    value={String(kpi.low_stock_count)}
                    hint={t("dashboard.kpi.lowStockHint", { defaultValue: "Материалов ниже порога" })}
                    tone="amber"
                    href="/admin/inventory"
                  />
                )}
              </div>
            </section>
          )}

          <section className="rounded-xl border border-zinc-800 bg-zinc-950">
            <div className="border-b border-zinc-800 px-5 py-3">
              <h2 className="text-sm font-semibold text-white">{t("dashboard.upcomingSection")}</h2>
            </div>
            <ul className="divide-y divide-zinc-800">
              {upcoming.length === 0 && (
                <li className="px-5 py-8 text-center text-sm text-zinc-500">
                  {t("dashboard.noUpcoming")}
                </li>
              )}
              {upcoming.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span className="font-medium text-zinc-200">{b.client_name}</span>
                  <span className="text-zinc-500">{format(parseISO(b.start_time), "EEE d MMM HH:mm")}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
