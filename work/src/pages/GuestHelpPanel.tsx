import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";

const SESSION_STORAGE_KEY = "alessanna.support_guest_session_v1";
const POLL_MS = 4000;

type GuestThread = {
  id: string;
  topic: string;
  status: string;
  visitor_name: string | null;
  visitor_email: string | null;
  last_message_at: string | null;
  unread_for_visitor: boolean;
};

type GuestMessage = {
  id: string;
  created_at: string;
  sender_type: string;
  body: string | null;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size_bytes: number | null;
};

function getOrCreateSessionToken(): string {
  try {
    let t = localStorage.getItem(SESSION_STORAGE_KEY);
    if (t && t.length >= 16) return t;
    t =
      (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/-/g, "") +
      (globalThis.crypto?.randomUUID?.() ?? `${Math.random()}`).replace(/-/g, "").slice(0, 12);
    localStorage.setItem(SESSION_STORAGE_KEY, t);
    return t;
  } catch {
    return `fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`.slice(0, 48);
  }
}

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
      return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleString(undefined, {
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

/**
 * Техподдержка без входа в CRM (тот же канал, что и у гостей сайта):
 * RPC support_visitor_* + session token в localStorage.
 */
export function GuestHelpPanel() {
  const { t } = useTranslation();
  const sessionToken = useMemo(() => getOrCreateSessionToken(), []);

  const [thread, setThread] = useState<GuestThread | null>(null);
  const [messages, setMessages] = useState<GuestMessage[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [visitorName, setVisitorName] = useState("");
  const [visitorEmail, setVisitorEmail] = useState("");
  const [firstBody, setFirstBody] = useState("");
  const [composer, setComposer] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const fetchThread = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("support_visitor_fetch", {
        p_session_token: sessionToken,
        p_since_iso: null,
      });
      if (error) throw error;
      const payload = data as {
        thread: GuestThread | null;
        messages: GuestMessage[];
      } | null;
      const th = payload?.thread ?? null;
      const msgs = Array.isArray(payload?.messages) ? payload!.messages : [];
      setThread(th);
      setMessages(msgs);
      setLoadError(null);
      if (th?.unread_for_visitor) {
        void supabase.rpc("support_visitor_mark_read", { p_session_token: sessionToken });
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [sessionToken]);

  useEffect(() => {
    void fetchThread();
    const id = window.setInterval(() => void fetchThread(), POLL_MS);
    return () => window.clearInterval(id);
  }, [fetchThread]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  const sendFirst = async () => {
    const name = visitorName.trim();
    const body = firstBody.trim();
    if (!name || !body) {
      setComposerError(t("guestHelp.fillNameAndMessage"));
      return;
    }
    setSending(true);
    setComposerError(null);
    try {
      const { error } = await supabase.rpc("support_visitor_start_thread", {
        p_session_token: sessionToken,
        p_topic: "salon",
        p_name: name,
        p_email: visitorEmail.trim() || null,
        p_message: body,
        p_user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        p_origin_url: typeof window !== "undefined" ? window.location.href : null,
        p_attachment_url: null,
        p_attachment_name: null,
        p_attachment_mime: null,
        p_attachment_size_bytes: null,
      });
      if (error) throw error;
      setFirstBody("");
      await fetchThread();
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const sendReply = async () => {
    const body = composer.trim();
    if (!body) return;
    setSending(true);
    setComposerError(null);
    try {
      const { error } = await supabase.rpc("support_visitor_post_message", {
        p_session_token: sessionToken,
        p_body: body,
        p_attachment_url: null,
        p_attachment_name: null,
        p_attachment_mime: null,
        p_attachment_size_bytes: null,
      });
      if (error) throw error;
      setComposer("");
      await fetchThread();
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const hasThread = thread != null;

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-8 text-zinc-200">
      <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-[900px] flex-col">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-zinc-800/80 pb-4">
          <div>
            <h1 className="text-xl font-semibold text-white">{t("guestHelp.pageTitle")}</h1>
            <p className="mt-1 max-w-xl text-sm text-zinc-500">{t("guestHelp.subtitle")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/reception"
              className="inline-flex min-h-[44px] items-center rounded-xl border border-zinc-700 bg-zinc-900/60 px-4 text-sm font-medium text-zinc-200 hover:border-zinc-500"
            >
              {t("guestHelp.backReception")}
            </Link>
            <Link
              to="/login?next=/help"
              className="inline-flex min-h-[44px] items-center rounded-xl border border-violet-500/45 bg-violet-950/40 px-4 text-sm font-semibold text-violet-100 hover:border-violet-400/55"
            >
              {t("guestHelp.loginCta")}
            </Link>
          </div>
        </header>

        {loadError && (
          <div className="mb-3 rounded-lg border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-200">
            {loadError}
          </div>
        )}

        {!hasThread ? (
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto rounded-xl border border-zinc-800 bg-black/30 p-5">
            <div className="rounded-2xl border border-emerald-900/40 bg-gradient-to-br from-emerald-950/35 to-zinc-950/40 p-5">
              <h2 className="text-base font-semibold text-emerald-100">{t("guestHelp.firstTitle")}</h2>
              <p className="mt-1 text-sm text-emerald-200/70">{t("guestHelp.firstHint")}</p>
            </div>
            {composerError && <p className="text-sm text-red-300">{composerError}</p>}
            <label className="block">
              <span className="text-xs text-zinc-500">{t("guestHelp.nameLabel")}</span>
              <input
                value={visitorName}
                onChange={(e) => setVisitorName(e.target.value)}
                autoComplete="name"
                className="mt-1 h-12 w-full rounded-xl border border-zinc-800 bg-black px-3 text-white"
                placeholder={t("guestHelp.namePlaceholder")}
              />
            </label>
            <label className="block">
              <span className="text-xs text-zinc-500">{t("guestHelp.emailLabel")}</span>
              <input
                value={visitorEmail}
                onChange={(e) => setVisitorEmail(e.target.value)}
                autoComplete="email"
                inputMode="email"
                className="mt-1 h-12 w-full rounded-xl border border-zinc-800 bg-black px-3 text-white"
                placeholder={t("guestHelp.emailPlaceholder")}
              />
            </label>
            <label className="block">
              <span className="text-xs text-zinc-500">{t("guestHelp.messageLabel")}</span>
              <textarea
                value={firstBody}
                onChange={(e) => setFirstBody(e.target.value)}
                rows={5}
                className="mt-1 w-full resize-none rounded-xl border border-zinc-800 bg-black px-3 py-2 text-white placeholder:text-zinc-600"
                placeholder={t("guestHelp.messagePlaceholder")}
              />
            </label>
            <button
              type="button"
              disabled={sending}
              onClick={() => void sendFirst()}
              className="min-h-[52px] rounded-xl bg-emerald-600 px-4 text-base font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {sending ? t("support.sending") : t("guestHelp.sendFirst")}
            </button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-black/30">
            <div className="border-b border-zinc-800 px-4 py-3">
              <p className="text-sm font-medium text-zinc-100">{t("guestHelp.threadActive")}</p>
              <p className="text-xs text-zinc-500">
                {thread.visitor_name}
                {thread.visitor_email ? ` · ${thread.visitor_email}` : ""}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <ul className="space-y-3">
                {messages.map((m) => {
                  const fromSupport = m.sender_type === "staff";
                  return (
                    <li key={m.id} className={"flex " + (fromSupport ? "justify-start" : "justify-end")}>
                      <div
                        className={
                          "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm " +
                          (fromSupport
                            ? "bg-zinc-900 text-zinc-100"
                            : "bg-emerald-900/40 text-emerald-50")
                        }
                      >
                        <div className="mb-0.5 flex items-center gap-2 text-[10px] uppercase tracking-wide opacity-70">
                          <span>{fromSupport ? t("myHelp.support") : t("support.you")}</span>
                          <span>·</span>
                          <span>{formatTime(m.created_at)}</span>
                        </div>
                        {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
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
                                className="inline-flex items-center gap-2 rounded-lg border border-black/30 bg-black/20 px-2.5 py-1 text-[11px] text-zinc-100"
                              >
                                <span>📎</span>
                                <span className="max-w-[200px] truncate">
                                  {m.attachment_name || t("support.attachment")}
                                </span>
                                <span className="text-zinc-400">{formatBytes(m.attachment_size_bytes)}</span>
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div ref={messagesEndRef} />
            </div>
            {thread.status === "closed" ? (
              <div className="border-t border-zinc-800 p-4 text-sm text-zinc-500">{t("guestHelp.closedHint")}</div>
            ) : (
              <div className="border-t border-zinc-800 bg-zinc-950/70 p-3">
                {composerError && <p className="mb-2 text-xs text-red-300">{composerError}</p>}
                <div className="flex items-end gap-2">
                  <textarea
                    value={composer}
                    onChange={(e) => setComposer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        void sendReply();
                      }
                    }}
                    placeholder={t("guestHelp.replyPlaceholder")}
                    rows={2}
                    className="flex-1 resize-none rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder:text-zinc-600"
                  />
                  <button
                    type="button"
                    disabled={sending || !composer.trim()}
                    onClick={() => void sendReply()}
                    className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {sending ? t("support.sending") : t("support.send")}
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-zinc-600">{t("support.sendHint")}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
