import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

/**
 * Универсальный просмотр activity_log.
 *
 * Используется в двух местах:
 *   1. ProfileSecurityPage  — `mode="self"` — staff смотрит свою историю
 *      через RPC `staff_my_activity(actor_id)`.
 *   2. AdminStaffPage       — `mode="admin"` — admin/manager смотрит лог
 *      другого сотрудника через RPC `staff_admin_activity(actor_id, target_actor_id)`.
 *
 * UX-правила:
 *   • Секция СВЁРНУТА по умолчанию (контролируется родителем через
 *     `defaultOpen={false}`). При раскрытии лениво грузит первые 100 строк.
 *   • Кнопка «Обновить» и «Загрузить ещё» (cursor-based по occurred_at).
 *   • Action отображается с человекочитаемой подписью + иконкой/badge.
 *   • IP и user-agent — справа, мелким шрифтом.
 */

type ActivityRow = {
  id: number;
  occurred_at: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  meta: Record<string, unknown> | null;
  /* в admin-режиме могут прийти доп. поля */
  actor_kind?: string;
  actor_id?: string | null;
  client_cookie_id?: string | null;
};

type ActivityLogProps = {
  /** Кто запрашивает (staff.id текущего пользователя). */
  actorId: string;
  /** "self" — свои логи; "admin" — чужие (требует actor admin/manager). */
  mode: "self" | "admin";
  /** Только для admin-режима: чей лог. */
  targetActorId?: string;
  /** Заголовок секции. */
  title?: string;
};

const ACTION_LABELS: Record<string, { label: string; tone: "ok" | "warn" | "err" | "info" }> = {
  "staff.login.ok": { label: "Вход выполнен", tone: "ok" },
  "staff.login.invalid_pin": { label: "Неверный PIN", tone: "warn" },
  "staff.login.pin_locked": { label: "PIN заблокирован", tone: "err" },
  "staff.login.requires_pin": { label: "Запрошен PIN", tone: "info" },
  "staff.login.access_denied": { label: "Отказ во входе", tone: "err" },
  "consent.granted": { label: "Согласие на cookies", tone: "info" },
  "site.visit": { label: "Заход на сайт", tone: "info" },
};

function actionMeta(action: string): { label: string; tone: "ok" | "warn" | "err" | "info" } {
  const known = ACTION_LABELS[action];
  if (known) return known;
  /* Fallback: разбираем по точкам, грубо угадываем тон. */
  if (action.indexOf(".ok") >= 0) return { label: action, tone: "ok" };
  if (action.indexOf(".invalid") >= 0 || action.indexOf(".fail") >= 0)
    return { label: action, tone: "warn" };
  if (action.indexOf(".denied") >= 0 || action.indexOf(".locked") >= 0)
    return { label: action, tone: "err" };
  return { label: action, tone: "info" };
}

function toneClasses(tone: "ok" | "warn" | "err" | "info"): string {
  switch (tone) {
    case "ok":
      return "border-emerald-700/60 bg-emerald-950/30 text-emerald-200";
    case "warn":
      return "border-amber-700/60 bg-amber-950/30 text-amber-200";
    case "err":
      return "border-red-700/60 bg-red-950/30 text-red-200";
    case "info":
    default:
      return "border-zinc-700/60 bg-zinc-900/50 text-zinc-300";
  }
}

function shortUA(ua: string | null): string {
  if (!ua) return "";
  /* Грубо: "Mozilla/5.0 ... Mobile Safari/537.36" → "Mobile Safari" */
  const match = ua.match(/(Edg|Chrome|Firefox|Safari|OPR)\/[\d.]+/);
  const isMobile = /Mobile|Android|iPhone|iPad/.test(ua);
  const tail = match ? match[0].replace(/\/[\d.]+/, "") : ua.slice(0, 30);
  return (isMobile ? "Mobile " : "") + tail;
}

export function ActivityLogSection(props: ActivityLogProps) {
  const { actorId, mode, targetActorId } = props;
  const title = props.title ?? "История активности";
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(
    async (beforeAt?: string) => {
      setLoading(true);
      setError(null);
      const limit = 100;
      let resp;
      if (mode === "self") {
        resp = await supabase.rpc("staff_my_activity", {
          p_actor_id: actorId,
          p_limit: limit,
          p_before_at: beforeAt ?? null,
        });
      } else {
        if (!targetActorId) {
          setLoading(false);
          setError("Не указан сотрудник для просмотра логов.");
          return;
        }
        resp = await supabase.rpc("staff_admin_activity", {
          p_actor_id: actorId,
          p_target_actor_id: targetActorId,
          p_target_cookie_id: null,
          p_limit: limit,
          p_before_at: beforeAt ?? null,
        });
      }
      setLoading(false);
      if (resp.error) {
        setError(resp.error.message);
        return;
      }
      const data = (resp.data ?? []) as ActivityRow[];
      setItems((prev) => (beforeAt ? prev.concat(data) : data));
      setHasMore(data.length >= limit);
    },
    [mode, actorId, targetActorId],
  );

  /* При первом раскрытии — авто-загрузка. */
  useEffect(() => {
    if (open && items.length === 0 && !loading && !error) {
      void load();
    }
  }, [open, items.length, loading, error, load]);

  const oldest = useMemo(() => {
    if (items.length === 0) return null;
    return items[items.length - 1].occurred_at;
  }, [items]);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span aria-hidden="true">📋</span>
          <span className="text-base font-semibold text-white">{title}</span>
          {items.length > 0 && (
            <span className="rounded-full border border-zinc-700 bg-zinc-900/60 px-2 py-0.5 text-[10px] text-zinc-400">
              {items.length}
            </span>
          )}
        </span>
        <span
          className={`text-zinc-500 transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden="true"
        >
          ▶
        </span>
      </button>

      {open && (
        <div className="border-t border-zinc-800/80 px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs text-zinc-500">
              {mode === "self"
                ? "Ваши действия в системе: входы, ошибки PIN, IP, устройство."
                : "Действия выбранного сотрудника. Для безопасности и аудита."}
            </p>
            <button
              type="button"
              onClick={() => {
                setItems([]);
                setHasMore(true);
                void load();
              }}
              className="text-xs text-zinc-400 underline-offset-4 hover:text-white hover:underline"
            >
              Обновить
            </button>
          </div>

          {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

          {loading && items.length === 0 ? (
            <p className="text-sm text-zinc-500">Загружаем…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-zinc-500">Записей пока нет.</p>
          ) : (
            <ul className="divide-y divide-zinc-800/80">
              {items.map((row) => {
                const meta = actionMeta(row.action);
                return (
                  <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span
                          className={
                            "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                            toneClasses(meta.tone)
                          }
                        >
                          {meta.label}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {new Date(row.occurred_at).toLocaleString()}
                        </span>
                      </p>
                      {row.meta && Object.keys(row.meta).length > 0 && (
                        <p className="mt-1 truncate text-xs text-zinc-500">
                          {(() => {
                            const m = row.meta as Record<string, unknown>;
                            if (typeof m.mode === "string") return "Режим: " + m.mode;
                            if (typeof m.failed_attempts === "number")
                              return "Попыток подряд: " + m.failed_attempts;
                            if (typeof m.device_label === "string")
                              return "Устройство: " + m.device_label;
                            return JSON.stringify(m).slice(0, 120);
                          })()}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5 text-right text-xs text-zinc-500">
                      {row.ip_address && (
                        <span className="font-mono text-[11px] text-zinc-400">
                          IP {row.ip_address}
                        </span>
                      )}
                      {row.user_agent && (
                        <span className="text-[11px] text-zinc-600" title={row.user_agent}>
                          {shortUA(row.user_agent)}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {hasMore && items.length > 0 && (
            <div className="mt-3 text-center">
              <button
                type="button"
                disabled={loading}
                onClick={() => oldest && void load(oldest)}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
              >
                {loading ? "Загружаем…" : "Загрузить ещё"}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
