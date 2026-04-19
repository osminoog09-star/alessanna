import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

/**
 * /admin/integrations — управление внешними интеграциями салона.
 *
 * Сейчас поддержано:
 *   * Google Calendar САЛОНА — общий календарь, в который попадают все записи.
 *   * Google Calendar МАСТЕРОВ — каждый сотрудник опционально подключает
 *     свой Google Calendar, и его персональные записи дублируются туда.
 *
 * Никаких email-уведомлений салону/клиенту НЕ отправляется (это спам);
 * Google Calendar сам уведомляет владельца календаря через push/web/mobile.
 *
 * Реальная отправка событий в Google Calendar делается отдельным
 * Supabase Edge Function под `service_role`-ключом (этап 2).
 * Эта страница — пульт оператора:
 *   - видеть статус подключения салона и каждого сотрудника;
 *   - инициировать подключение (когда Edge Function задеплоен);
 *   - отслеживать outbox-очередь, повторять упавшие задачи,
 *     «прогонять» накопившиеся skipped-задачи после первого подключения.
 */

type GoogleStatus = "disconnected" | "connecting" | "connected" | "error";

type SettingsMap = {
  google_calendar_status: GoogleStatus;
  google_calendar_account_email: string | null;
  google_calendar_id: string | null;
  google_calendar_last_sync_at: string | null;
  google_calendar_last_error: string | null;
};

const DEFAULTS: SettingsMap = {
  google_calendar_status: "disconnected",
  google_calendar_account_email: null,
  google_calendar_id: null,
  google_calendar_last_sync_at: null,
  google_calendar_last_error: null,
};

type StaffCalendarRow = {
  id: string;
  name: string;
  is_active: boolean;
  google_calendar_status: GoogleStatus;
  google_calendar_account_email: string | null;
  google_calendar_id: string | null;
  google_calendar_last_sync_at: string | null;
  google_calendar_last_error: string | null;
};

type OutboxRow = {
  id: string;
  appointment_id: string | null;
  kind: "google_calendar_event" | "email" | "sms" | "telegram";
  target_scope: string;
  payload: Record<string, unknown>;
  status: "pending" | "sent" | "error" | "skipped";
  attempts: number;
  last_error: string | null;
  last_attempt_at: string | null;
  sent_at: string | null;
  external_ref: string | null;
  created_at: string;
  updated_at: string;
};

type StatusFilter = "all" | OutboxRow["status"];
type ScopeFilter = "all" | "salon" | "staff";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("ru-RU", {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function statusBadge(s: OutboxRow["status"]): { label: string; className: string } {
  switch (s) {
    case "pending":
      return { label: "В очереди", className: "border-sky-700/60 bg-sky-950/40 text-sky-200" };
    case "sent":
      return { label: "Отправлено", className: "border-emerald-700/60 bg-emerald-950/40 text-emerald-200" };
    case "error":
      return { label: "Ошибка", className: "border-rose-700/60 bg-rose-950/40 text-rose-200" };
    case "skipped":
      return { label: "Пропущено", className: "border-zinc-700/60 bg-zinc-900/60 text-zinc-300" };
  }
}

function googleStatusBadge(s: GoogleStatus): { label: string; className: string } {
  switch (s) {
    case "connected":
      return { label: "Подключено", className: "border-emerald-700/60 bg-emerald-950/40 text-emerald-200" };
    case "connecting":
      return { label: "Подключаем…", className: "border-amber-700/60 bg-amber-950/40 text-amber-200" };
    case "error":
      return { label: "Ошибка", className: "border-rose-700/60 bg-rose-950/40 text-rose-200" };
    case "disconnected":
    default:
      return { label: "Не подключено", className: "border-zinc-700/60 bg-zinc-900/60 text-zinc-400" };
  }
}

/* Превращаем target_scope из БД ('salon' / 'staff:<uuid>') в человеко-читаемое
 * имя. Для 'staff:<uuid>' пытаемся подставить имя из staffById (карта),
 * иначе показываем «Мастер · короткий-id». */
function scopeLabel(scope: string, staffById: Map<string, string>): string {
  if (scope === "salon") return "Салон";
  if (scope.startsWith("staff:")) {
    const id = scope.slice("staff:".length);
    const name = staffById.get(id);
    return name ? `Мастер · ${name}` : `Мастер · ${id.slice(0, 8)}`;
  }
  return scope;
}

export function AdminIntegrationsPage() {
  const [settings, setSettings] = useState<SettingsMap>(DEFAULTS);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const [staff, setStaff] = useState<StaffCalendarRow[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [staffError, setStaffError] = useState<string | null>(null);

  const [outbox, setOutbox] = useState<OutboxRow[]>([]);
  const [outboxLoading, setOutboxLoading] = useState(true);
  const [outboxError, setOutboxError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setSettingsError(null);
    const { data, error } = await supabase
      .from("salon_settings")
      .select("key,value")
      .in("key", [
        "google_calendar_status",
        "google_calendar_account_email",
        "google_calendar_id",
        "google_calendar_last_sync_at",
        "google_calendar_last_error",
      ]);
    if (error) {
      setSettingsError(error.message);
      setSettingsLoading(false);
      return;
    }
    const map = { ...DEFAULTS };
    for (const r of data ?? []) {
      const key = (r as { key: keyof SettingsMap }).key;
      const value = (r as { value: string | null }).value;
      if (key === "google_calendar_status") {
        map.google_calendar_status =
          value === "connected" || value === "connecting" || value === "error"
            ? value
            : "disconnected";
      } else if (key in map) {
        (map as unknown as Record<string, string | null>)[key] = value ?? null;
      }
    }
    setSettings(map);
    setSettingsLoading(false);
  }, []);

  const loadStaff = useCallback(async () => {
    setStaffError(null);
    const { data, error } = await supabase
      .from("staff")
      .select(
        "id,name,is_active,google_calendar_status,google_calendar_account_email,google_calendar_id,google_calendar_last_sync_at,google_calendar_last_error"
      )
      .order("name", { ascending: true });
    if (error) {
      setStaffError(error.message);
      setStaffLoading(false);
      return;
    }
    setStaff(
      ((data ?? []) as Array<Partial<StaffCalendarRow>>).map((r) => ({
        id: String(r.id ?? ""),
        name: String(r.name ?? ""),
        is_active: r.is_active !== false,
        google_calendar_status:
          (r.google_calendar_status as GoogleStatus | undefined) ?? "disconnected",
        google_calendar_account_email: r.google_calendar_account_email ?? null,
        google_calendar_id: r.google_calendar_id ?? null,
        google_calendar_last_sync_at: r.google_calendar_last_sync_at ?? null,
        google_calendar_last_error: r.google_calendar_last_error ?? null,
      }))
    );
    setStaffLoading(false);
  }, []);

  const loadOutbox = useCallback(async () => {
    setOutboxError(null);
    let q = supabase
      .from("notifications_outbox")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (statusFilter !== "all") q = q.eq("status", statusFilter);
    if (scopeFilter === "salon") q = q.eq("target_scope", "salon");
    else if (scopeFilter === "staff") q = q.like("target_scope", "staff:%");
    const { data, error } = await q;
    if (error) {
      setOutboxError(error.message);
      setOutboxLoading(false);
      return;
    }
    setOutbox((data ?? []) as OutboxRow[]);
    setOutboxLoading(false);
  }, [statusFilter, scopeFilter]);

  useEffect(() => {
    void loadSettings();
    void loadStaff();
  }, [loadSettings, loadStaff]);

  useEffect(() => {
    void loadOutbox();
  }, [loadOutbox]);

  /* Auto-refresh queue every 15 sec — видно как Edge Function (когда
   * задеплоится) меняет статусы pending → sent. */
  useEffect(() => {
    const id = window.setInterval(() => {
      void loadOutbox();
    }, 15_000);
    return () => window.clearInterval(id);
  }, [loadOutbox]);

  const counts = useMemo(() => {
    const acc = { pending: 0, sent: 0, error: 0, skipped: 0 };
    for (const r of outbox) acc[r.status] += 1;
    return acc;
  }, [outbox]);

  const staffById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of staff) m.set(s.id, s.name);
    return m;
  }, [staff]);

  async function retryOne(id: string) {
    setActionBusy(id);
    const { error } = await supabase.rpc("outbox_retry", { p_id: id });
    setActionBusy(null);
    if (error) {
      setOutboxError(error.message);
      return;
    }
    void loadOutbox();
  }

  async function resumeAllSkipped(scope: "all" | "salon" | "staff") {
    const key = `resume-${scope}`;
    setActionBusy(key);
    /* p_scope=null → все; для 'salon' и 'staff' будем фильтровать на
     * клиенте через несколько вызовов (точнее: для 'staff' нет одного
     * текста, у каждого мастера свой). Поэтому:
     *   - 'all'   → outbox_resume_skipped()
     *   - 'salon' → outbox_resume_skipped('salon')
     *   - 'staff' → outbox_resume_skipped() и потом откат для салона
     * Чтобы не плодить RPC, для 'staff' пойдём прямо через UPDATE-RPC
     * с null + предварительный UPDATE статуса salon-задач не трогаем
     * (они уже в их собственном состоянии). Но проще: пока 'staff'
     * ведёт себя как 'all' — это безопасно, поскольку salon-задача
     * в отключённом состоянии всё равно skipped. */
    const args =
      scope === "salon"
        ? { p_scope: "salon" }
        : scope === "all"
          ? { p_scope: null }
          : { p_scope: null };
    const { error } = await supabase.rpc("outbox_resume_skipped", args);
    setActionBusy(null);
    if (error) {
      setOutboxError(error.message);
      return;
    }
    void loadOutbox();
  }

  async function disconnectStaffCalendar(staffId: string) {
    const key = `staff-disconnect-${staffId}`;
    setActionBusy(key);
    const { error } = await supabase.rpc("staff_google_calendar_disconnect", {
      p_staff_id: staffId,
    });
    setActionBusy(null);
    if (error) {
      setStaffError(error.message);
      return;
    }
    void loadStaff();
  }

  const status = settings.google_calendar_status;
  const statusInfo = googleStatusBadge(status);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Интеграции</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Внешние сервисы салона: календари, оплата. Здесь видно статус
          подключения и очередь синхронизации. E-mail-уведомления специально не
          отправляются — Google Calendar сам уведомит владельца через push/web/
          mobile.
        </p>
      </div>

      {/* ─────── Google Calendar — Salon ─────── */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500/20 to-emerald-500/20 text-sky-300"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
                <path d="M3 8h18M7 3v4m10-4v4M4 8h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <div>
              <h2 className="text-lg font-semibold text-white">Google Calendar — Салон</h2>
              <p className="text-xs text-zinc-500">
                Общий рабочий календарь салона. В него попадают <strong>все</strong> записи —
                с публичного сайта и созданные администратором в CRM.
              </p>
            </div>
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide ${statusInfo.className}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
            {statusInfo.label}
          </span>
        </header>

        {settingsError && (
          <p className="mt-3 rounded-md border border-rose-700/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
            {settingsError}
          </p>
        )}

        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-zinc-800 bg-black/40 p-3">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Подключённый аккаунт Google
            </dt>
            <dd className="mt-1 truncate text-sm text-zinc-100">
              {settings.google_calendar_account_email ?? (
                <span className="text-zinc-500">— не подключено —</span>
              )}
            </dd>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-black/40 p-3">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Целевой календарь
            </dt>
            <dd className="mt-1 truncate text-sm text-zinc-100">
              {settings.google_calendar_id ? (
                <code className="text-emerald-300">{settings.google_calendar_id}</code>
              ) : (
                <span className="text-zinc-500">создастся как «AlesSanna — Записи» при подключении</span>
              )}
            </dd>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-black/40 p-3">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Последняя синхронизация
            </dt>
            <dd className="mt-1 text-sm text-zinc-100">
              {formatDate(settings.google_calendar_last_sync_at)}
            </dd>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-black/40 p-3">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Сервис уведомлений
            </dt>
            <dd className="mt-1 text-sm text-zinc-100">
              <span className="text-zinc-300">Только Google Calendar</span>
              <span className="ml-1 text-[10px] text-zinc-600">(никаких писем)</span>
            </dd>
          </div>
        </dl>

        {settings.google_calendar_last_error && (
          <p className="mt-3 rounded-md border border-rose-700/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
            <span className="font-semibold">Последняя ошибка:</span>{" "}
            {settings.google_calendar_last_error}
          </p>
        )}

        <div className="mt-5 rounded-lg border border-amber-800/40 bg-amber-950/30 p-4 text-sm text-amber-100">
          <p className="font-semibold">Подключение по OAuth — следующий этап</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-200/80">
            База готова: записи уже копятся в очереди (см. ниже). Чтобы события
            начали попадать в Google Calendar — нужно задеплоить Supabase Edge
            Function с Google OAuth client. Скажи «подключаем календарь» и я
            пройдусь по шагам Google Cloud + деплой одной командой.
          </p>
        </div>

        {settingsLoading && (
          <p className="mt-3 text-[11px] text-zinc-600">Загружаем статус…</p>
        )}
      </section>

      {/* ─────── Google Calendar — Staff ─────── */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5">
        <header>
          <h2 className="text-lg font-semibold text-white">Календари мастеров</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Каждый мастер опционально подключает свой Google Calendar — туда
            будут дублироваться только <strong>его</strong> записи. Это удобно,
            если мастер хочет видеть расписание салона в одном календаре с
            личными встречами.
          </p>
        </header>

        {staffError && (
          <p className="mt-3 rounded-md border border-rose-700/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
            {staffError}
          </p>
        )}

        <div className="mt-4 overflow-hidden rounded-lg border border-zinc-800">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="bg-zinc-900/60 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="w-[26%] px-3 py-2">Мастер</th>
                <th className="w-[16%] px-3 py-2">Статус</th>
                <th className="w-[26%] px-3 py-2">Подключённый Google-аккаунт</th>
                <th className="w-[16%] px-3 py-2">Синхронизация</th>
                <th className="w-[16%] px-3 py-2 text-right">Действие</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {staffLoading ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-xs text-zinc-500">
                    Загрузка…
                  </td>
                </tr>
              ) : staff.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-xs text-zinc-500">
                    В CRM пока нет мастеров. Добавьте в разделе «Персонал».
                  </td>
                </tr>
              ) : (
                staff.map((s) => {
                  const badge = googleStatusBadge(s.google_calendar_status);
                  const disconnectKey = `staff-disconnect-${s.id}`;
                  return (
                    <tr key={s.id} className="bg-black/40 align-top hover:bg-zinc-900/40">
                      <td className="px-3 py-2 text-sm text-zinc-100">
                        <div className="flex items-center gap-2">
                          <span>{s.name}</span>
                          {!s.is_active && (
                            <span className="rounded-full border border-zinc-700 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-zinc-500">
                              неактивен
                            </span>
                          )}
                        </div>
                        {s.google_calendar_last_error && (
                          <p className="mt-1 text-[10px] text-rose-300" title={s.google_calendar_last_error}>
                            {s.google_calendar_last_error}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-300">
                        {s.google_calendar_account_email ?? (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-400">
                        {formatDate(s.google_calendar_last_sync_at)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {s.google_calendar_status === "connected" || s.google_calendar_status === "error" ? (
                          <button
                            type="button"
                            onClick={() => void disconnectStaffCalendar(s.id)}
                            disabled={actionBusy === disconnectKey}
                            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] font-medium text-zinc-200 transition hover:border-rose-700 hover:text-rose-200 disabled:opacity-40"
                            title="Отозвать токен и стереть привязку (мастер сможет подключить заново)"
                          >
                            {actionBusy === disconnectKey ? "…" : "Отключить"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled
                            className="cursor-not-allowed rounded-md border border-zinc-800 bg-zinc-900/40 px-2 py-1 text-[10px] font-medium text-zinc-500"
                            title="Появится после деплоя Edge Function для Google OAuth"
                          >
                            Подключить
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[11px] text-zinc-600">
          Кнопка «Подключить» станет активной после деплоя Edge Function. До
          этого момента личные записи мастеров копятся в очереди как{" "}
          <code className="text-zinc-400">skipped</code> и автоматически
          запустятся, когда мастер впервые подключится.
        </p>
      </section>

      {/* ─────── Outbox ─────── */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Очередь синхронизации</h2>
            <p className="text-xs text-zinc-500">
              Каждая новая запись попадает сюда — до двух строк: одна для
              салона, одна для мастера. Edge Function обрабатывает строки со
              статусом <code className="text-sky-300">pending</code>. Пока
              подключения нет — копятся как{" "}
              <code className="text-zinc-300">skipped</code>.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void resumeAllSkipped("all")}
            disabled={actionBusy === "resume-all" || counts.skipped === 0}
            className="rounded-md border border-emerald-700/60 bg-emerald-950/40 px-3 py-1.5 text-xs font-medium text-emerald-200 transition hover:bg-emerald-900/50 disabled:opacity-40"
            title="Перевести все skipped-задачи в pending — Edge Function их обработает при первом запуске."
          >
            {actionBusy === "resume-all" ? "Подождите…" : `Прогнать ${counts.skipped} skipped`}
          </button>
        </header>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px]">
          {(["all", "pending", "sent", "error", "skipped"] as StatusFilter[]).map((s) => {
            const isActive = statusFilter === s;
            const label =
              s === "all"
                ? `Все (${outbox.length})`
                : s === "pending"
                  ? `В очереди (${counts.pending})`
                  : s === "sent"
                    ? `Отправлено (${counts.sent})`
                    : s === "error"
                      ? `Ошибки (${counts.error})`
                      : `Пропущено (${counts.skipped})`;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`rounded-full border px-2.5 py-1 transition ${
                  isActive
                    ? "border-sky-500/60 bg-sky-950/50 text-sky-100"
                    : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                }`}
              >
                {label}
              </button>
            );
          })}
          <span className="mx-2 hidden h-4 w-px bg-zinc-800 sm:inline-block" />
          {(["all", "salon", "staff"] as ScopeFilter[]).map((s) => {
            const isActive = scopeFilter === s;
            const label = s === "all" ? "Все адресаты" : s === "salon" ? "Салон" : "Мастера";
            return (
              <button
                key={s}
                type="button"
                onClick={() => setScopeFilter(s)}
                className={`rounded-full border px-2.5 py-1 transition ${
                  isActive
                    ? "border-amber-500/60 bg-amber-950/50 text-amber-100"
                    : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {outboxError && (
          <p className="mt-3 rounded-md border border-rose-700/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
            {outboxError}
          </p>
        )}

        <div className="mt-4 overflow-hidden rounded-lg border border-zinc-800">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="bg-zinc-900/60 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="w-[15%] px-3 py-2">Создано</th>
                <th className="w-[12%] px-3 py-2">Статус</th>
                <th className="w-[18%] px-3 py-2">Адресат</th>
                <th className="w-[35%] px-3 py-2">Запись</th>
                <th className="w-[10%] px-3 py-2 text-right">Попыток</th>
                <th className="w-[10%] px-3 py-2 text-right">Действие</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {outboxLoading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-xs text-zinc-500">
                    Загрузка…
                  </td>
                </tr>
              ) : outbox.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-xs text-zinc-500">
                    Пока пусто. Создайте новую запись в CRM или с публичного сайта —
                    она появится здесь.
                  </td>
                </tr>
              ) : (
                outbox.map((row) => {
                  const badge = statusBadge(row.status);
                  const payload = row.payload || {};
                  const client = (payload as { client_name?: string }).client_name ?? "";
                  const startTime = (payload as { start_time?: string }).start_time ?? null;
                  const isStaffScope = row.target_scope.startsWith("staff:");
                  return (
                    <tr key={row.id} className="bg-black/40 align-top hover:bg-zinc-900/40">
                      <td className="px-3 py-2 text-xs text-zinc-400">{formatDate(row.created_at)}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${badge.className}`}>
                          {badge.label}
                        </span>
                        {row.last_error && (
                          <p
                            className="mt-1 truncate text-[10px] text-rose-300"
                            title={row.last_error}
                          >
                            {row.last_error}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span
                          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${
                            isStaffScope
                              ? "border-amber-700/60 bg-amber-950/40 text-amber-200"
                              : "border-sky-700/60 bg-sky-950/40 text-sky-200"
                          }`}
                        >
                          {scopeLabel(row.target_scope, staffById)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <p className="truncate text-zinc-200">
                          {client || <span className="text-zinc-500">—</span>}
                        </p>
                        <p className="truncate text-[10px] text-zinc-500">
                          {formatDate(startTime)}
                          {row.appointment_id && (
                            <>
                              {" · "}
                              <code className="text-zinc-600">{row.appointment_id.slice(0, 8)}</code>
                            </>
                          )}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-zinc-400">{row.attempts}</td>
                      <td className="px-3 py-2 text-right">
                        {(row.status === "error" || row.status === "skipped") && (
                          <button
                            type="button"
                            onClick={() => void retryOne(row.id)}
                            disabled={actionBusy === row.id}
                            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] font-medium text-zinc-200 transition hover:border-sky-700 hover:text-sky-200 disabled:opacity-40"
                          >
                            {actionBusy === row.id ? "…" : "Повторить"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[11px] text-zinc-600">
          Очередь обновляется автоматически каждые 15 секунд.
        </p>
      </section>
    </div>
  );
}
