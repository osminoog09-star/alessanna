import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";

/**
 * Личная техподдержка для сотрудника салона.
 *
 * Любой залогиненный staff может написать в техподдержку (админам). Здесь
 * нет раздела «обращения от других», только собственные треды + форма
 * нового сообщения. Админы отвечают через `/admin/support` (тема `staff`).
 */

type Status = "open" | "pending" | "closed";
type SenderType = "visitor" | "staff" | "system";

type ThreadSummary = {
  id: string;
  created_at: string;
  updated_at: string;
  status: Status;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_sender_type: SenderType | null;
  unread_for_visitor: boolean;
};

type ThreadDetail = {
  id: string;
  status: Status;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  unread_for_visitor: boolean;
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

const POLL_LIST_MS = 8000;
const POLL_THREAD_MS = 4000;
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

export function MyHelpPage() {
  const { t } = useTranslation();
  const { staffMember } = useAuth();

  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [composer, setComposer] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadList = useCallback(async () => {
    if (!staffMember) return;
    try {
      const { data, error } = await supabase.rpc("support_staff_self_list", {
        p_staff_id: staffMember.id,
      });
      if (error) throw error;
      const arr = Array.isArray(data) ? (data as ThreadSummary[]) : [];
      setThreads(arr);
      setListError(null);
      /* Если ничего не выбрано — выбираем первый открытый. */
      if (!selectedId && arr.length > 0) {
        setSelectedId(arr[0].id);
      }
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    }
  }, [staffMember, selectedId]);

  const loadThread = useCallback(
    async (threadId: string) => {
      if (!staffMember) return;
      try {
        const { data, error } = await supabase.rpc("support_staff_self_fetch", {
          p_staff_id: staffMember.id,
          p_thread_id: threadId,
        });
        if (error) throw error;
        const payload = data as { thread: ThreadDetail; messages: Message[] } | null;
        if (!payload?.thread) {
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
      }
    },
    [staffMember, t]
  );

  useEffect(() => {
    void loadList();
    const id = window.setInterval(() => void loadList(), POLL_LIST_MS);
    return () => window.clearInterval(id);
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setMessages([]);
      return;
    }
    void loadThread(selectedId);
    const id = window.setInterval(() => void loadThread(selectedId), POLL_THREAD_MS);
    return () => window.clearInterval(id);
  }, [selectedId, loadThread]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  /* Сбрасываем «непрочитанное» автору, когда открыли тред. */
  useEffect(() => {
    if (!staffMember || !selectedId || !detail?.unread_for_visitor) return;
    void supabase
      .rpc("support_staff_self_mark_read", {
        p_staff_id: staffMember.id,
        p_thread_id: selectedId,
      })
      .then(() => void loadList());
  }, [staffMember, selectedId, detail?.unread_for_visitor, loadList]);

  const uploadAttachment = async (): Promise<{
    url: string;
    name: string;
    mime: string;
    size: number;
  } | null> => {
    if (!attachment || !staffMember) return null;
    setUploading(true);
    try {
      if (attachment.size > MAX_ATTACHMENT_BYTES) {
        throw new Error(t("support.attachmentTooLarge"));
      }
      const safeExt =
        (attachment.name.split(".").pop() || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 10) ||
        "bin";
      const pathKey = `staff-help-${staffMember.id}/${Date.now()}-${Math.random()
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

  const send = async () => {
    if (!staffMember) return;
    const body = composer.trim();
    if (!body && !attachment) return;
    setSending(true);
    setComposerError(null);
    try {
      let att: Awaited<ReturnType<typeof uploadAttachment>> = null;
      if (attachment) {
        att = await uploadAttachment();
      }
      if (selectedId) {
        const { error } = await supabase.rpc("support_staff_self_post", {
          p_staff_id: staffMember.id,
          p_thread_id: selectedId,
          p_body: body,
          p_attachment_url: att?.url ?? null,
          p_attachment_name: att?.name ?? null,
          p_attachment_mime: att?.mime ?? null,
          p_attachment_size_bytes: att?.size ?? null,
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.rpc("support_staff_self_open", {
          p_staff_id: staffMember.id,
          p_body: body,
          p_attachment_url: att?.url ?? null,
          p_attachment_name: att?.name ?? null,
          p_attachment_mime: att?.mime ?? null,
          p_attachment_size_bytes: att?.size ?? null,
        });
        if (error) throw error;
        const payload = data as { thread_id: string } | null;
        if (payload?.thread_id) {
          setSelectedId(payload.thread_id);
        }
      }
      setComposer("");
      setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadList();
      if (selectedId) await loadThread(selectedId);
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const startNewThread = () => {
    setSelectedId(null);
    setDetail(null);
    setMessages([]);
    setComposer("");
    setComposerError(null);
  };

  const visibleThreads = useMemo(() => threads, [threads]);

  return (
    <div className="flex h-[calc(100vh-6rem)] max-w-[1200px] flex-col gap-3 text-zinc-200">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("myHelp.pageTitle")}</h1>
          <p className="mt-0.5 max-w-2xl text-xs text-zinc-500">{t("myHelp.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={startNewThread}
          className="rounded-lg border border-emerald-700/60 bg-emerald-900/30 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-900/60"
        >
          + {t("myHelp.newThread")}
        </button>
      </header>

      {listError && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/40 p-2 text-xs text-red-200">
          {listError}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[300px_1fr]">
        {/* ───── List of own threads ───── */}
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
          <div className="border-b border-zinc-800 px-3 py-2 text-[11px] uppercase tracking-wider text-zinc-500">
            {t("myHelp.threads")} · {visibleThreads.length}
          </div>
          <ul className="flex-1 overflow-y-auto">
            {visibleThreads.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-zinc-500">
                {t("myHelp.emptyThreads")}
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
                        (active ? "bg-zinc-900/80" : "hover:bg-zinc-900/50")
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-sm font-medium text-zinc-100">
                          {th.unread_for_visitor && (
                            <span
                              aria-hidden="true"
                              className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                            />
                          )}
                          <span className="truncate">
                            {t("myHelp.threadTitle", {
                              date: new Date(th.created_at).toLocaleDateString("ru-RU", {
                                day: "2-digit",
                                month: "2-digit",
                              }),
                            })}
                          </span>
                        </span>
                        <span className="shrink-0 text-[10px] text-zinc-500">
                          {formatTime(th.last_message_at || th.updated_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={
                            "rounded-full border px-1.5 py-[1px] text-[10px] " +
                            statusTone(th.status)
                          }
                        >
                          {statusLabel(t, th.status)}
                        </span>
                      </div>
                      {th.last_message_preview && (
                        <p className="line-clamp-2 text-xs text-zinc-500">
                          {th.last_sender_type === "staff" && (
                            <span className="mr-1 text-emerald-400/80">
                              {t("myHelp.fromSupport")}:
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

        {/* ───── Thread / new-thread composer ───── */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-black/30">
          {!selectedId ? (
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-6">
              <div className="rounded-2xl border border-emerald-900/40 bg-gradient-to-br from-emerald-950/40 to-zinc-950/40 p-5">
                <h2 className="text-base font-semibold text-emerald-100">
                  {t("myHelp.newThreadTitle")}
                </h2>
                <p className="mt-1 text-xs text-emerald-200/70">
                  {t("myHelp.newThreadHint")}
                </p>
                <ul className="mt-3 grid gap-1 text-[12px] text-zinc-400 sm:grid-cols-2">
                  <li>· {t("myHelp.exampleBug")}</li>
                  <li>· {t("myHelp.exampleAccess")}</li>
                  <li>· {t("myHelp.exampleQuestion")}</li>
                  <li>· {t("myHelp.exampleScreenshot")}</li>
                </ul>
              </div>
              {composerError && (
                <p className="text-xs text-red-300">{composerError}</p>
              )}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                {attachment && (
                  <div className="mb-2 flex items-center gap-2 rounded-lg border border-zinc-800 bg-black/40 px-2 py-1.5 text-[11px] text-zinc-300">
                    <span>📎</span>
                    <span className="max-w-[280px] truncate">{attachment.name}</span>
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
                <textarea
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  placeholder={t("myHelp.composerPlaceholder")}
                  rows={4}
                  className="w-full resize-none rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-emerald-600/60 focus:outline-none"
                />
                <div className="mt-2 flex items-center gap-2">
                  <label
                    className="cursor-pointer rounded-lg border border-zinc-800 bg-black/40 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                    title={t("support.attachFile")}
                  >
                    📎 {t("support.attachFile")}
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={sending || uploading || (!composer.trim() && !attachment)}
                    className="ml-auto rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {sending || uploading
                      ? t("support.sending")
                      : t("myHelp.sendNew")}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-950/70 px-4 py-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-zinc-100">
                    {t("myHelp.threadHeader")}
                  </h2>
                  {detail && (
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      {t("myHelp.opened")}: {formatTime(detail.created_at)} ·{" "}
                      <span
                        className={
                          "rounded-full border px-1.5 py-[1px] text-[10px] " +
                          statusTone(detail.status)
                        }
                      >
                        {statusLabel(t, detail.status)}
                      </span>
                    </p>
                  )}
                </div>
                {threadError && (
                  <p className="text-xs text-red-300">{threadError}</p>
                )}
              </header>

              <div className="flex-1 overflow-y-auto px-4 py-4">
                {messages.length === 0 ? (
                  <p className="text-center text-xs text-zinc-500">
                    {t("support.noMessages")}
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {messages.map((m) => {
                      const fromSupport = m.sender_type === "staff";
                      return (
                        <li
                          key={m.id}
                          className={
                            "flex " + (fromSupport ? "justify-start" : "justify-end")
                          }
                        >
                          <div
                            className={
                              "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-sm " +
                              (fromSupport
                                ? "bg-zinc-900 text-zinc-100"
                                : "bg-emerald-900/40 text-emerald-50")
                            }
                          >
                            <div className="mb-0.5 flex items-center gap-2 text-[10px] uppercase tracking-wide opacity-70">
                              <span>
                                {fromSupport
                                  ? m.sender_staff_name || t("myHelp.support")
                                  : t("support.you")}
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
                {detail?.status === "closed" ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-xs text-zinc-400">
                    <span>{t("myHelp.closedHint")}</span>
                    <button
                      type="button"
                      onClick={startNewThread}
                      className="rounded-md border border-emerald-700/60 bg-emerald-900/30 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-900/60"
                    >
                      + {t("myHelp.newThread")}
                    </button>
                  </div>
                ) : (
                  <>
                    {composerError && (
                      <p className="mb-2 text-xs text-red-300">{composerError}</p>
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
                          onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
                        />
                      </label>
                      <textarea
                        value={composer}
                        onChange={(e) => setComposer(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault();
                            void send();
                          }
                        }}
                        placeholder={t("myHelp.replyPlaceholder")}
                        rows={2}
                        className="flex-1 resize-none rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-emerald-600/60 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void send()}
                        disabled={
                          sending || uploading || (!composer.trim() && !attachment)
                        }
                        className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {sending || uploading ? t("support.sending") : t("support.send")}
                      </button>
                    </div>
                    <p className="mt-1 text-[10px] text-zinc-600">{t("support.sendHint")}</p>
                  </>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
