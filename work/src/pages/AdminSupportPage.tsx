import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { hasStaffRole } from "../lib/roles";

type Topic = "salon" | "site" | "staff";
type Status = "open" | "pending" | "closed";
type SenderType = "visitor" | "staff" | "system";

type ThreadSummary = {
  id: string;
  display_id: string | null;
  created_at: string;
  updated_at: string;
  topic: Topic;
  status: Status;
  visitor_name: string;
  visitor_email: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_sender_type: SenderType | null;
  unread_for_staff: boolean;
  assigned_staff_id: string | null;
  assigned_at: string | null;
  assigned_staff_name: string | null;
  staff_author_id?: string | null;
  staff_author_name?: string | null;
  is_suspicious?: boolean;
};

type ThreadDetail = ThreadSummary & {
  visitor_user_agent: string | null;
  visitor_origin_url: string | null;
  assigned_by_staff_id: string | null;
  assigned_by_staff_name: string | null;
  /* IP виден только админу — для менеджера приходит null. */
  client_ip: string | null;
  client_ip_set_at: string | null;
  device_fingerprint_short: string | null;
  ip_threads_24h: number;
  device_threads_24h: number;
  is_suspicious: boolean;
};

type StaffOption = { id: string; name: string };

type SupportStats = {
  open: number;
  pending: number;
  unassigned: number;
  mine: number;
  avg_first_response_seconds: number | null;
  closed_24h: number;
  closed_7d: number;
  suspicious_24h: number;
};

type Message = {
  id: string;
  created_at: string;
  sender_type: SenderType;
  sender_staff_id: string | null;
  sender_staff_name: string | null;
  body: string;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size_bytes: number | null;
};

const POLL_LIST_MS = 5000;
const POLL_THREAD_MS = 3000;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) {
      return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatBytes(n: number | null | undefined): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function isImage(mime: string | null | undefined): boolean {
  return !!mime && mime.startsWith("image/");
}

/** «3 ч 12 мин» / «42 мин» / «18 с» — компактно для плитки stats. */
function formatDurationShort(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s} с`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 24) return rest ? `${h} ч ${rest} мин` : `${h} ч`;
  const d = Math.floor(h / 24);
  const restH = h % 24;
  return restH ? `${d} д ${restH} ч` : `${d} д`;
}

function topicLabel(t: (k: string) => string, topic: Topic): string {
  if (topic === "site") return t("support.topicSite");
  if (topic === "staff") return t("support.topicStaff");
  return t("support.topicSalon");
}

function statusLabel(t: (k: string) => string, status: Status): string {
  if (status === "pending") return t("support.statusPending");
  if (status === "closed") return t("support.statusClosed");
  return t("support.statusOpen");
}

function statusTone(status: Status): string {
  if (status === "pending") return "border-amber-600/50 bg-amber-900/30 text-amber-200";
  if (status === "closed") return "border-zinc-700 bg-zinc-900/60 text-zinc-400";
  return "border-emerald-600/50 bg-emerald-900/30 text-emerald-200";
}

function topicTone(topic: Topic): string {
  if (topic === "site") return "border-violet-600/50 bg-violet-900/30 text-violet-200";
  if (topic === "staff") return "border-orange-600/50 bg-orange-900/30 text-orange-200";
  return "border-sky-600/50 bg-sky-900/30 text-sky-200";
}

type StatTone = "emerald" | "amber" | "violet" | "sky" | "zinc" | "rose";

const STAT_TONE: Record<StatTone, string> = {
  emerald: "border-emerald-700/40 bg-emerald-950/40 text-emerald-100",
  amber: "border-amber-700/40 bg-amber-950/40 text-amber-100",
  violet: "border-violet-700/40 bg-violet-950/40 text-violet-100",
  sky: "border-sky-700/40 bg-sky-950/40 text-sky-100",
  zinc: "border-zinc-800 bg-zinc-950/60 text-zinc-200",
  rose: "border-rose-700/60 bg-rose-950/40 text-rose-100",
};

function StatTile(props: {
  label: string;
  value: number | string;
  tone: StatTone;
  hint?: string;
}) {
  return (
    <div
      className={
        "rounded-lg border px-3 py-2 " + STAT_TONE[props.tone]
      }
      title={props.hint}
    >
      <div className="text-[10px] uppercase tracking-wider opacity-70">
        {props.label}
      </div>
      <div className="mt-0.5 text-lg font-semibold leading-none">
        {props.value}
      </div>
    </div>
  );
}

export function AdminSupportPage() {
  const { t } = useTranslation();
  const { staffMember } = useAuth();

  const isAdmin = hasStaffRole(staffMember, "admin");
  const isManager = hasStaffRole(staffMember, "manager");
  const canAccess = !!staffMember && (isAdmin || isManager);

  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  /* «Активные» — это NULL-фильтр на стороне клиента: open ИЛИ pending.
   * Бэкенд RPC принимает только конкретный Status или null = все.
   * Поэтому держим отдельный «view»-стейт и пересчитываем `statusFilter`
   * (что уходит в RPC) и `clientStatusFilter` (для дополнительного фильтра
   * на клиенте, чтобы не показывать closed). */
  type StatusView = "active" | "all" | "closed";
  const [statusView, setStatusView] = useState<StatusView>("active");
  const statusFilter: "" | Status = statusView === "closed" ? "closed" : "";
  const [topicFilter, setTopicFilter] = useState<"" | Topic>("");
  const [listLoading, setListLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [stats, setStats] = useState<SupportStats | null>(null);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [transferOpen, setTransferOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadList = useCallback(async () => {
    if (!staffMember) return;
    try {
      const { data, error } = await supabase.rpc("support_staff_list_threads", {
        p_staff_id: staffMember.id,
        p_status_filter: statusFilter || null,
        p_topic_filter: topicFilter || null,
        p_limit: 200,
      });
      if (error) throw error;
      const arr = Array.isArray(data) ? (data as ThreadSummary[]) : [];
      setThreads(arr);
      setListError(null);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setListLoading(false);
    }
  }, [staffMember, statusFilter, topicFilter]);

  const loadThread = useCallback(
    async (threadId: string, opts?: { silent?: boolean }) => {
      if (!staffMember) return;
      if (!opts?.silent) setThreadLoading(true);
      try {
        const { data, error } = await supabase.rpc("support_staff_fetch_messages", {
          p_staff_id: staffMember.id,
          p_thread_id: threadId,
        });
        if (error) throw error;
        const payload = data as { thread: ThreadDetail; messages: Message[] } | null;
        if (!payload || !payload.thread) {
          setDetail(null);
          setMessages([]);
          setThreadError(t("support.threadMissing"));
          return;
        }
        setDetail(payload.thread);
        setMessages(Array.isArray(payload.messages) ? payload.messages : []);
        setThreadError(null);
      } catch (err) {
        setThreadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!opts?.silent) setThreadLoading(false);
      }
    },
    [staffMember, t]
  );

  const loadStats = useCallback(async () => {
    if (!staffMember) return;
    try {
      const { data, error } = await supabase.rpc("support_staff_stats", {
        p_staff_id: staffMember.id,
        p_topic_filter: topicFilter || null,
      });
      if (error) throw error;
      setStats((data as SupportStats) ?? null);
    } catch {
      /* статистика — фоновая, без шумных ошибок */
    }
  }, [staffMember, topicFilter]);

  useEffect(() => {
    void loadList();
    void loadStats();
    const id = window.setInterval(() => {
      void loadList();
      void loadStats();
    }, POLL_LIST_MS);
    return () => window.clearInterval(id);
  }, [loadList, loadStats]);

  /* Список активных сотрудников — нужен админу для «передать другому».
     Менеджеру/мастеру не подгружаем. RLS на staff открыт, выбираем минимум. */
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void supabase
      .from("staff")
      .select("id,name,is_active")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        if (cancelled || !data) return;
        setStaffOptions(
          (data as Array<{ id: string; name: string }>).map((s) => ({
            id: s.id,
            name: s.name,
          }))
        );
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setMessages([]);
      return;
    }
    void loadThread(selectedId);
    const id = window.setInterval(
      () => void loadThread(selectedId, { silent: true }),
      POLL_THREAD_MS
    );
    return () => window.clearInterval(id);
  }, [selectedId, loadThread]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  useEffect(() => {
    if (!selectedId || !detail?.unread_for_staff || !staffMember) return;
    void supabase
      .rpc("support_staff_update_thread", {
        p_staff_id: staffMember.id,
        p_thread_id: selectedId,
        p_clear_unread: true,
      })
      .then(() => void loadList());
  }, [selectedId, detail?.unread_for_staff, staffMember, loadList]);

  const visibleThreads = useMemo(() => {
    if (statusView === "active") {
      return threads.filter((th) => th.status === "open" || th.status === "pending");
    }
    return threads;
  }, [threads, statusView]);

  const uploadAttachment = async (): Promise<{
    url: string;
    name: string;
    mime: string;
    size: number;
  } | null> => {
    if (!attachment) return null;
    setUploading(true);
    try {
      if (attachment.size > MAX_ATTACHMENT_BYTES) {
        throw new Error(t("support.attachmentTooLarge"));
      }
      const safeExt =
        (attachment.name.split(".").pop() || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 10) ||
        "bin";
      const pathKey = `staff-${staffMember?.id ?? "anon"}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}.${safeExt}`;
      const { error } = await supabase.storage
        .from("support-attachments")
        .upload(pathKey, attachment, {
          contentType: attachment.type || "application/octet-stream",
          upsert: false,
        });
      if (error) throw error;
      const pub = supabase.storage.from("support-attachments").getPublicUrl(pathKey);
      return {
        url: pub.data.publicUrl,
        name: attachment.name,
        mime: attachment.type || "application/octet-stream",
        size: attachment.size,
      };
    } finally {
      setUploading(false);
    }
  };

  const sendReply = async () => {
    if (!staffMember || !selectedId) return;
    const body = replyText.trim();
    if (!body && !attachment) return;
    setSending(true);
    setSendError(null);
    try {
      let att: Awaited<ReturnType<typeof uploadAttachment>> = null;
      if (attachment) {
        att = await uploadAttachment();
      }
      const { error } = await supabase.rpc("support_staff_post_message", {
        p_staff_id: staffMember.id,
        p_thread_id: selectedId,
        p_body: body,
        p_attachment_url: att?.url ?? null,
        p_attachment_name: att?.name ?? null,
        p_attachment_mime: att?.mime ?? null,
        p_attachment_size_bytes: att?.size ?? null,
      });
      if (error) throw error;
      setReplyText("");
      setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadThread(selectedId, { silent: true });
      await loadList();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const changeStatus = async (next: Status) => {
    if (!staffMember || !selectedId || !detail) return;
    if (detail.status === next) return;
    try {
      const { error } = await supabase.rpc("support_staff_update_thread", {
        p_staff_id: staffMember.id,
        p_thread_id: selectedId,
        p_status: next,
      });
      if (error) throw error;
      await loadThread(selectedId, { silent: true });
      await loadList();
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : String(err));
    }
  };

  const assignToMe = async () => {
    if (!staffMember || !selectedId || !detail) return;
    try {
      const { error } = await supabase.rpc("support_staff_update_thread", {
        p_staff_id: staffMember.id,
        p_thread_id: selectedId,
        p_assigned_staff_id: staffMember.id,
      });
      if (error) throw error;
      await loadThread(selectedId, { silent: true });
      await loadList();
      await loadStats();
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : String(err));
    }
  };

  const releaseAssignment = async () => {
    if (!staffMember || !selectedId || !detail) return;
    try {
      const { error } = await supabase.rpc("support_staff_update_thread", {
        p_staff_id: staffMember.id,
        p_thread_id: selectedId,
        p_clear_assignee: true,
      });
      if (error) throw error;
      await loadThread(selectedId, { silent: true });
      await loadList();
      await loadStats();
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : String(err));
    }
  };

  const transferTo = async (targetStaffId: string) => {
    if (!staffMember || !selectedId || !detail) return;
    if (!targetStaffId) {
      setTransferOpen(false);
      return;
    }
    try {
      const { error } = await supabase.rpc("support_staff_update_thread", {
        p_staff_id: staffMember.id,
        p_thread_id: selectedId,
        p_assigned_staff_id: targetStaffId,
      });
      if (error) throw error;
      setTransferOpen(false);
      await loadThread(selectedId, { silent: true });
      await loadList();
      await loadStats();
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!canAccess) {
    return (
      <div className="max-w-4xl space-y-3 text-zinc-200">
        <h1 className="text-xl font-semibold">{t("support.pageTitle")}</h1>
        <p className="rounded-lg border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-200">
          {t("support.noAccess")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-6rem)] max-w-[1400px] flex-col gap-3 text-zinc-200">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("support.pageTitle")}</h1>
          <p className="mt-0.5 text-xs text-zinc-500">
            {isAdmin ? t("support.visibilityAdmin") : t("support.visibilityManager")}
          </p>
        </div>
        {/* Один компактный фильтр-bar вместо двух рядов pill-кнопок:
         *   • статус (3 кнопки, по умолчанию «Активные» = open+pending);
         *   • тема — обычный select для админа (4 значения, занимает мало места).
         * Раньше было 4 + 4 = 8 кнопок одинаковой плотности, что и
         * вызывало жалобу «много вкладок и непонятно». */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div
            role="tablist"
            aria-label={t("support.filterStatusLabel")}
            className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-black/30 p-1"
          >
            {(["active", "all", "closed"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={statusView === s}
                onClick={() => setStatusView(s)}
                className={
                  "rounded-md px-2.5 py-1 text-xs font-medium transition " +
                  (statusView === s
                    ? "bg-zinc-200 text-black"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100")
                }
              >
                {s === "active"
                  ? t("support.filterActive")
                  : s === "closed"
                    ? t("support.filterClosed")
                    : t("support.filterAll")}
              </button>
            ))}
          </div>
          {isAdmin && (
            <label className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-black/30 px-2 py-1">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                {t("support.filterTopicLabel")}
              </span>
              <select
                value={topicFilter}
                onChange={(e) => setTopicFilter(e.target.value as "" | Topic)}
                className="bg-transparent text-xs text-zinc-100 focus:outline-none"
              >
                <option value="" className="bg-zinc-900">
                  {t("support.filterAllTopics")}
                </option>
                <option value="salon" className="bg-zinc-900">
                  {t("support.topicSalon")}
                </option>
                <option value="site" className="bg-zinc-900">
                  {t("support.topicSite")}
                </option>
                <option value="staff" className="bg-zinc-900">
                  {t("support.topicStaff")}
                </option>
              </select>
            </label>
          )}
        </div>
      </header>

      {listError && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/40 p-2 text-xs text-red-200">
          {listError}
        </div>
      )}

      {/* Компактный дашборд: 5 плиток (открытых / в ожидании / без ассайни /
       * мои / средн. время первого ответа). Если есть подозрительные за 24ч —
       * добавляем пунцовую плитку с предупреждением. Здесь нет интерактива:
       * это «градусник», чтобы менеджер с одного взгляда понимал нагрузку. */}
      {stats && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile label={t("support.statsOpen")} value={stats.open} tone="emerald" />
          <StatTile label={t("support.statsPending")} value={stats.pending} tone="amber" />
          <StatTile
            label={t("support.statsUnassigned")}
            value={stats.unassigned}
            tone={stats.unassigned > 0 ? "violet" : "zinc"}
            hint={t("support.statsUnassignedHint")}
          />
          <StatTile label={t("support.statsMine")} value={stats.mine} tone="sky" />
          <StatTile
            label={t("support.statsAvgReply")}
            value={formatDurationShort(stats.avg_first_response_seconds)}
            tone="zinc"
            hint={t("support.statsAvgReplyHint")}
          />
          {stats.suspicious_24h > 0 && (
            <StatTile
              label={t("support.statsSuspicious")}
              value={stats.suspicious_24h}
              tone="rose"
              hint={t("support.statsSuspiciousHint")}
            />
          )}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[340px_1fr]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
          <div className="border-b border-zinc-800 px-3 py-2 text-[11px] uppercase tracking-wider text-zinc-500">
            {t("support.threads")} · {visibleThreads.length}
          </div>
          <ul className="flex-1 overflow-y-auto">
            {listLoading && threads.length === 0 ? (
              <li className="px-3 py-4 text-xs text-zinc-500">{t("support.loading")}</li>
            ) : visibleThreads.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-zinc-500">
                {t("support.emptyThreads")}
              </li>
            ) : (
              visibleThreads.map((th) => {
                const active = th.id === selectedId;
                return (
                  <li key={th.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(th.id)}
                      className={
                        "flex w-full flex-col gap-1 border-b border-zinc-900 px-3 py-2.5 text-left transition " +
                        (active
                          ? "bg-zinc-900/80"
                          : "hover:bg-zinc-900/50")
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-zinc-100">
                          {th.unread_for_staff && (
                            <span
                              aria-hidden="true"
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"
                            />
                          )}
                          {th.is_suspicious && (
                            <span
                              aria-label={t("support.suspiciousBadge")}
                              title={t("support.suspiciousBadge")}
                              className="shrink-0 text-[11px] leading-none text-rose-400"
                            >
                              ⚠
                            </span>
                          )}
                          <span className="truncate">
                            {th.topic === "staff"
                              ? th.staff_author_name || th.visitor_name || "—"
                              : th.visitor_name || "—"}
                            {th.topic === "staff" && (
                              <span className="ml-1 text-[10px] text-orange-300/80">
                                · {t("support.staffMember")}
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="shrink-0 text-[10px] text-zinc-500">
                          {formatTime(th.last_message_at || th.updated_at)}
                        </span>
                      </div>
                      {/* display_id моноширинным мелким — чтобы можно было
                       * сослаться в звонке/чате: «открой SAL-000123». */}
                      {th.display_id && (
                        <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                          {th.display_id}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                        <span
                          className={
                            "rounded-full border px-1.5 py-[1px] " + topicTone(th.topic)
                          }
                        >
                          {topicLabel(t, th.topic)}
                        </span>
                        <span
                          className={
                            "rounded-full border px-1.5 py-[1px] " + statusTone(th.status)
                          }
                        >
                          {statusLabel(t, th.status)}
                        </span>
                        {th.assigned_staff_name && (
                          <span
                            className={
                              "inline-flex items-center gap-1 rounded-full border px-1.5 py-[1px] " +
                              (th.assigned_staff_id === staffMember?.id
                                ? "border-emerald-700/60 bg-emerald-900/30 text-emerald-200"
                                : "border-zinc-700 bg-zinc-900/60 text-zinc-300")
                            }
                            title={t("support.assignedTo", { name: th.assigned_staff_name })}
                          >
                            <span aria-hidden="true">👤</span>
                            <span className="max-w-[110px] truncate">
                              {th.assigned_staff_id === staffMember?.id
                                ? t("support.assignedMine")
                                : th.assigned_staff_name}
                            </span>
                          </span>
                        )}
                      </div>
                      {th.last_message_preview && (
                        <p className="line-clamp-2 text-xs text-zinc-500">
                          {th.last_sender_type === "staff" && (
                            <span className="mr-1 text-zinc-600">
                              {t("support.youReply")}:
                            </span>
                          )}
                          {th.last_message_preview}
                        </p>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-black/30">
          {!selectedId ? (
            <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
              {t("support.selectThread")}
            </div>
          ) : (
            <>
              <header className="border-b border-zinc-800 bg-zinc-950/70 px-4 py-3">
                {threadLoading && !detail ? (
                  <p className="text-xs text-zinc-500">{t("support.loading")}</p>
                ) : detail ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-sm font-semibold text-zinc-100">
                          {detail.topic === "staff"
                            ? detail.staff_author_name || detail.visitor_name
                            : detail.visitor_name}
                        </h2>
                        {detail.display_id && (
                          <span
                            className="rounded-full border border-zinc-700 bg-zinc-900/60 px-2 py-[1px] font-mono text-[10px] uppercase tracking-wider text-zinc-300"
                            title={t("support.threadIdHint")}
                          >
                            {detail.display_id}
                          </span>
                        )}
                        <span
                          className={
                            "rounded-full border px-2 py-[1px] text-[10px] " +
                            topicTone(detail.topic)
                          }
                        >
                          {topicLabel(t, detail.topic)}
                        </span>
                        <span
                          className={
                            "rounded-full border px-2 py-[1px] text-[10px] " +
                            statusTone(detail.status)
                          }
                        >
                          {statusLabel(t, detail.status)}
                        </span>
                        {detail.is_suspicious && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full border border-rose-700/60 bg-rose-900/30 px-2 py-[1px] text-[10px] text-rose-200"
                            title={t("support.suspiciousHint")}
                          >
                            <span aria-hidden="true">⚠</span>
                            {t("support.suspicious")}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        {detail.visitor_email ? (
                          <a
                            className="text-zinc-400 hover:text-zinc-200"
                            href={`mailto:${detail.visitor_email}`}
                          >
                            {detail.visitor_email}
                          </a>
                        ) : (
                          t("support.noEmail")
                        )}
                        {detail.visitor_origin_url ? (
                          <>
                            {" · "}
                            <span title={detail.visitor_origin_url}>
                              {t("support.fromPage")}
                            </span>
                          </>
                        ) : null}
                      </p>
                      {/* Бейдж «Закреплено за …»: всегда видим, чтобы любой
                       * менеджер/админ с одного взгляда понимал, чей это тред
                       * и к кому идти за статусом. Если пусто — «не закреплено». */}
                      <p className="mt-1 inline-flex items-center gap-1.5 text-[11px]">
                        <span aria-hidden="true">👤</span>
                        {detail.assigned_staff_id ? (
                          detail.assigned_staff_id === staffMember?.id ? (
                            <span className="text-emerald-300">
                              {t("support.assignedMineFull")}
                            </span>
                          ) : (
                            <span className="text-zinc-300">
                              {t("support.assignedTo", {
                                name: detail.assigned_staff_name || "—",
                              })}
                            </span>
                          )
                        ) : (
                          <span className="text-zinc-500">
                            {t("support.notAssigned")}
                          </span>
                        )}
                        {detail.assigned_by_staff_id &&
                          detail.assigned_by_staff_id !==
                            detail.assigned_staff_id && (
                            <span className="text-zinc-600">
                              ·{" "}
                              {t("support.assignedBy", {
                                name: detail.assigned_by_staff_name || "—",
                              })}
                            </span>
                          )}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Действия по ассайни:
                       *   • если тред не на мне  → «Взять себе»
                       *   • если на мне          → «Снять с себя»
                       *   • admin дополнительно  → «Передать другому…» (поповер)
                       * Менеджер не может перетянуть чужой тред — backend
                       * прокинет access_denied, кнопку и не показываем. */}
                      {detail.assigned_staff_id !== staffMember?.id ? (
                        <button
                          type="button"
                          onClick={() => void assignToMe()}
                          className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800"
                          disabled={
                            !!detail.assigned_staff_id && !isAdmin
                          }
                          title={
                            detail.assigned_staff_id && !isAdmin
                              ? t("support.assignedTakenHint", {
                                  name: detail.assigned_staff_name || "—",
                                })
                              : t("support.assignMe")
                          }
                        >
                          {t("support.assignMe")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void releaseAssignment()}
                          className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
                          title={t("support.releaseHint")}
                        >
                          {t("support.release")}
                        </button>
                      )}
                      {isAdmin && staffOptions.length > 0 && (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setTransferOpen((v) => !v)}
                            aria-haspopup="listbox"
                            aria-expanded={transferOpen}
                            className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800"
                          >
                            {t("support.transferTo")}
                          </button>
                          {transferOpen && (
                            <div
                              role="listbox"
                              className="absolute right-0 top-full z-20 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-1 shadow-2xl"
                            >
                              {staffOptions.map((s) => {
                                const isCurrent =
                                  s.id === detail.assigned_staff_id;
                                return (
                                  <button
                                    key={s.id}
                                    type="button"
                                    role="option"
                                    aria-selected={isCurrent}
                                    onClick={() => void transferTo(s.id)}
                                    className={
                                      "flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition " +
                                      (isCurrent
                                        ? "bg-emerald-900/30 text-emerald-100"
                                        : "text-zinc-200 hover:bg-zinc-900")
                                    }
                                  >
                                    <span className="truncate">{s.name}</span>
                                    {isCurrent && (
                                      <span aria-hidden="true">✓</span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Раньше тут был сегментированный селектор «Статус: open/pending».
                       * Дублировал status-badge в заголовке и сбивал с толку
                       * (выглядел как информационная пилюля, а был кликабельным).
                       * Теперь — одна явная кнопка «В ожидание» / «Вернуть в работу»,
                       * рядом с главной «Закрыть обращение». Всего 2 действия
                       * вместо 2 кнопок-выбора + 1 кнопки = 3, и логика очевидна. */}
                      {detail.status === "open" && (
                        <button
                          type="button"
                          onClick={() => void changeStatus("pending")}
                          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-200 transition hover:bg-zinc-800"
                          title={t("support.markPendingHint")}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                            <rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" />
                          </svg>
                          {t("support.markPending")}
                        </button>
                      )}
                      {detail.status === "pending" && (
                        <button
                          type="button"
                          onClick={() => void changeStatus("open")}
                          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-200 transition hover:bg-zinc-800"
                          title={t("support.resumeOpenHint")}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                            <polygon points="6 4 20 12 6 20 6 4" />
                          </svg>
                          {t("support.resumeOpen")}
                        </button>
                      )}

                      {/* Главная действующая кнопка: «Закрыть обращение».
                          Явная иконка-крестик + жёлтый/зинковый акцент,
                          чтобы её невозможно было пропустить. */}
                      {detail.status !== "closed" ? (
                        <button
                          type="button"
                          onClick={() => void changeStatus("closed")}
                          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-600 bg-zinc-100 px-3 py-1.5 text-[11px] font-semibold text-zinc-900 shadow-sm transition hover:bg-white"
                          title={t("support.closeThreadHint")}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          >
                            <path d="M5 13l4 4L19 7" />
                          </svg>
                          {t("support.closeThread")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void changeStatus("open")}
                          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-700/60 bg-emerald-900/30 px-3 py-1.5 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-900/60"
                          title={t("support.reopenThreadHint")}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          >
                            <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
                          </svg>
                          {t("support.reopenThread")}
                        </button>
                      )}
                    </div>
                  </div>
                ) : null}
                {threadError && (
                  <p className="mt-2 text-xs text-red-300">{threadError}</p>
                )}
              </header>

              {/* «Тех. контекст»: IP/устройство/счётчики. Помогает понять,
               * не накручивает ли один человек 10 обращений с разными именами.
               *   • admin видит сам IP и короткий fingerprint;
               *   • менеджер видит только обезличенные счётчики «N за 24ч»;
               *   • для тем 'staff' (тикеты сотрудников) скрываем —
               *     для них «мошенник» не имеет смысла. */}
              {detail && detail.topic !== "staff" && (
                (detail.ip_threads_24h > 1 ||
                  detail.device_threads_24h > 1 ||
                  detail.client_ip ||
                  detail.is_suspicious) && (
                  <section
                    aria-label={t("support.techContext")}
                    className={
                      "border-b px-4 py-2 text-[11px] " +
                      (detail.is_suspicious
                        ? "border-rose-900/60 bg-rose-950/30 text-rose-100"
                        : "border-zinc-800 bg-zinc-950/50 text-zinc-400")
                    }
                  >
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="uppercase tracking-wider text-zinc-500">
                        {t("support.techContext")}
                      </span>
                      {detail.client_ip ? (
                        <span>
                          IP:{" "}
                          <span className="font-mono text-zinc-200">
                            {detail.client_ip}
                          </span>
                        </span>
                      ) : (
                        !isAdmin && (
                          <span className="text-zinc-500">
                            {t("support.ipHidden")}
                          </span>
                        )
                      )}
                      <span>
                        {t("support.ipThreads24h", {
                          count: detail.ip_threads_24h,
                        })}
                      </span>
                      <span>
                        {t("support.deviceThreads24h", {
                          count: detail.device_threads_24h,
                        })}
                      </span>
                      {detail.device_fingerprint_short && isAdmin && (
                        <span>
                          {t("support.device")}:{" "}
                          <span className="font-mono text-zinc-300">
                            {detail.device_fingerprint_short}…
                          </span>
                        </span>
                      )}
                      {detail.visitor_user_agent && isAdmin && (
                        <span
                          className="truncate text-zinc-500"
                          title={detail.visitor_user_agent}
                        >
                          UA: {detail.visitor_user_agent.slice(0, 60)}
                          {detail.visitor_user_agent.length > 60 ? "…" : ""}
                        </span>
                      )}
                    </div>
                  </section>
                )
              )}

              <div className="flex-1 overflow-y-auto px-4 py-4">
                {messages.length === 0 ? (
                  <p className="text-center text-xs text-zinc-500">
                    {t("support.noMessages")}
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {messages.map((m) => {
                      const mine = m.sender_type === "staff";
                      return (
                        <li
                          key={m.id}
                          className={"flex " + (mine ? "justify-end" : "justify-start")}
                        >
                          <div
                            className={
                              "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-sm " +
                              (mine
                                ? "bg-emerald-900/40 text-emerald-50"
                                : "bg-zinc-900 text-zinc-100")
                            }
                          >
                            <div className="mb-0.5 flex items-center gap-2 text-[10px] uppercase tracking-wide opacity-70">
                              <span>
                                {mine
                                  ? m.sender_staff_name || t("support.you")
                                  : detail?.visitor_name || t("support.visitor")}
                              </span>
                              <span>·</span>
                              <span>{formatTime(m.created_at)}</span>
                            </div>
                            {m.body && (
                              <p className="whitespace-pre-wrap break-words">{m.body}</p>
                            )}
                            {m.attachment_url && (
                              <div className="mt-2">
                                {isImage(m.attachment_mime) ? (
                                  <a
                                    href={m.attachment_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block overflow-hidden rounded-lg border border-black/40"
                                  >
                                    <img
                                      src={m.attachment_url}
                                      alt={m.attachment_name || ""}
                                      className="max-h-60 w-auto"
                                    />
                                  </a>
                                ) : (
                                  <a
                                    href={m.attachment_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 rounded-lg border border-black/30 bg-black/20 px-2.5 py-1 text-[11px] text-zinc-100 hover:bg-black/30"
                                  >
                                    <span>📎</span>
                                    <span className="max-w-[200px] truncate">
                                      {m.attachment_name || t("support.attachment")}
                                    </span>
                                    <span className="text-zinc-400">
                                      {formatBytes(m.attachment_size_bytes)}
                                    </span>
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="border-t border-zinc-800 bg-zinc-950/70 p-3">
                {sendError && (
                  <p className="mb-2 text-xs text-red-300">{sendError}</p>
                )}
                {attachment && (
                  <div className="mb-2 flex items-center gap-2 rounded-lg border border-zinc-800 bg-black/40 px-2 py-1.5 text-[11px] text-zinc-300">
                    <span>📎</span>
                    <span className="max-w-[200px] truncate">{attachment.name}</span>
                    <span className="text-zinc-500">{formatBytes(attachment.size)}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setAttachment(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="ml-auto rounded text-zinc-500 hover:text-zinc-300"
                    >
                      ×
                    </button>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <label
                    className="shrink-0 cursor-pointer rounded-lg border border-zinc-800 bg-black/40 px-2.5 py-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                    title={t("support.attachFile")}
                  >
                    📎
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        setAttachment(f);
                      }}
                    />
                  </label>
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        void sendReply();
                      }
                    }}
                    placeholder={t("support.replyPlaceholder")}
                    rows={2}
                    className="flex-1 resize-none rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-emerald-600/60 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void sendReply()}
                    disabled={
                      sending ||
                      uploading ||
                      (!replyText.trim() && !attachment)
                    }
                    className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {sending || uploading
                      ? t("support.sending")
                      : t("support.send")}
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-zinc-600">{t("support.sendHint")}</p>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
