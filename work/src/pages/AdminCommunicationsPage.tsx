import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";

type EmailJob = {
  id: string;
  appointment_id: string | null;
  recipient_email: string;
  recipient_name: string | null;
  job_type: "confirmation" | "reminder_24h" | "thank_you_followup" | "manual";
  scheduled_at: string;
  status: "pending" | "sent" | "failed" | "cancelled" | "skipped";
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
};

type StatusFilter = "all" | "pending" | "sent" | "failed" | "cancelled";

const STATUS_BADGE: Record<EmailJob["status"], string> = {
  pending: "border-amber-700/60 bg-amber-950/40 text-amber-200",
  sent: "border-emerald-700/60 bg-emerald-950/40 text-emerald-200",
  failed: "border-red-700/60 bg-red-950/40 text-red-300",
  cancelled: "border-zinc-700 bg-zinc-900 text-zinc-500",
  skipped: "border-zinc-700 bg-zinc-900 text-zinc-500",
};

export function AdminCommunicationsPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<EmailJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const q = supabase
      .from("email_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    const { data, error } = await q;
    setLoading(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setRows((data ?? []) as EmailJob[]);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [rows, statusFilter]);

  const counts = useMemo(() => {
    const c: Record<EmailJob["status"], number> = {
      pending: 0,
      sent: 0,
      failed: 0,
      cancelled: 0,
      skipped: 0,
    };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  async function retry(id: string) {
    const { error } = await supabase.rpc("email_jobs_retry", { job_id: id });
    if (error) alert(error.message);
    else await reload();
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            {t("communications.title", { defaultValue: "Письма клиентам" })}
          </h1>
          <p className="text-sm text-zinc-500">
            {t("communications.subtitle", {
              defaultValue:
                "Очередь автоматических писем: подтверждение, напоминание, follow-up.",
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900"
        >
          {t("common.refresh", { defaultValue: "Обновить" })}
        </button>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label={t("communications.statusTotal", { defaultValue: "Всего" })} value={rows.length} active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
        <Stat label={t("communications.statusPending", { defaultValue: "Ждут" })} value={counts.pending} active={statusFilter === "pending"} onClick={() => setStatusFilter("pending")} tone="amber" />
        <Stat label={t("communications.statusSent", { defaultValue: "Отправлено" })} value={counts.sent} active={statusFilter === "sent"} onClick={() => setStatusFilter("sent")} tone="emerald" />
        <Stat label={t("communications.statusFailed", { defaultValue: "Ошибки" })} value={counts.failed} active={statusFilter === "failed"} onClick={() => setStatusFilter("failed")} tone="red" />
        <Stat label={t("communications.statusCancelled", { defaultValue: "Отменено" })} value={counts.cancelled} active={statusFilter === "cancelled"} onClick={() => setStatusFilter("cancelled")} tone="zinc" />
      </div>

      {err && <p className="rounded border border-red-900 bg-red-950/40 p-2 text-sm text-red-300">{err}</p>}

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase text-zinc-400">
            <tr>
              <th className="px-3 py-2">{t("communications.col.date", { defaultValue: "Создано" })}</th>
              <th className="px-3 py-2">{t("communications.col.type", { defaultValue: "Тип" })}</th>
              <th className="px-3 py-2">{t("communications.col.recipient", { defaultValue: "Получатель" })}</th>
              <th className="px-3 py-2">{t("communications.col.scheduled", { defaultValue: "Отправка" })}</th>
              <th className="px-3 py-2">{t("communications.col.status", { defaultValue: "Статус" })}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {loading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  {t("common.loading")}
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  {t("communications.empty", { defaultValue: "Писем нет" })}
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2 text-zinc-400">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-3 py-2 text-zinc-300">
                  {t(`communications.type.${r.job_type}`, { defaultValue: r.job_type })}
                </td>
                <td className="px-3 py-2 text-white">
                  {r.recipient_name || "—"} <span className="text-zinc-500">· {r.recipient_email}</span>
                </td>
                <td className="px-3 py-2 text-zinc-400">{new Date(r.scheduled_at).toLocaleString()}</td>
                <td className="px-3 py-2">
                  <span className={`rounded border px-2 py-0.5 text-xs ${STATUS_BADGE[r.status]}`}>
                    {t(`communications.status.${r.status}`, { defaultValue: r.status })}
                  </span>
                  {r.last_error && (
                    <p className="mt-1 max-w-xs truncate text-xs text-red-400" title={r.last_error}>
                      {r.last_error}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {(r.status === "failed" || r.status === "cancelled") && (
                    <button
                      type="button"
                      onClick={() => void retry(r.id)}
                      className="text-xs text-sky-400 hover:underline"
                    >
                      {t("communications.retry", { defaultValue: "Повторить" })}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  active,
  onClick,
  tone,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
  tone?: "amber" | "emerald" | "red" | "zinc";
}) {
  const toneClass =
    tone === "amber"
      ? "border-amber-700/60"
      : tone === "emerald"
      ? "border-emerald-700/60"
      : tone === "red"
      ? "border-red-700/60"
      : tone === "zinc"
      ? "border-zinc-700"
      : "border-zinc-700";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border bg-zinc-950 px-3 py-2 text-left ${toneClass} ${
        active ? "ring-2 ring-sky-500" : ""
      }`}
    >
      <p className="text-xs text-zinc-400">{label}</p>
      <p className="text-xl font-semibold text-white">{value}</p>
    </button>
  );
}
