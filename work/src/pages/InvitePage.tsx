import { useEffect, useRef, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";

/**
 * Маршрут /invite/:token (или /invite?token=…) — открывается мастером по
 * пригласительной ссылке. Никаких форм: один RPC, и юзер залогинен +
 * устройство автоматически добавлено в доверенные. Дальше React-Router
 * редиректит на главную, как после обычного логина.
 *
 * Защита от двойного запуска: React 18 в dev-режиме монтирует компонент
 * дважды (StrictMode). Сам RPC атомарен (FOR UPDATE), но второй вызов
 * получит status: 'used_up' для max_uses=1 — что выглядит как ошибка.
 * Поэтому фиксируем «уже запустили» через useRef.
 */
export function InvitePage() {
  const { t } = useTranslation();
  const params = useParams<{ token?: string }>();
  const [search] = useSearchParams();
  const token = params.token || search.get("token") || "";
  const { staffMember, consumeInvite } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (!token) {
      setError(
        t("invite.error.missing", {
          defaultValue: "Ссылка некорректна — нет токена.",
        }),
      );
      setPending(false);
      return;
    }

    void consumeInvite(token).then((r) => {
      setPending(false);
      if (r.ok) return;
      if ("status" in r) {
        switch (r.status) {
          case "expired":
            setError(
              t("invite.error.expired", {
                defaultValue: "Ссылка просрочена. Попросите админа создать новую.",
              }),
            );
            return;
          case "used_up":
            setError(
              t("invite.error.usedUp", {
                defaultValue: "Ссылка уже использована. Попросите админа создать новую.",
              }),
            );
            return;
          case "revoked":
            setError(
              t("invite.error.revoked", {
                defaultValue: "Ссылку отозвал админ. Запросите новую.",
              }),
            );
            return;
          case "staff_inactive":
            setError(
              t("invite.error.staffInactive", {
                defaultValue: "Аккаунт сотрудника выключен. Свяжитесь с админом.",
              }),
            );
            return;
          case "invalid_token":
            setError(
              t("invite.error.invalid", {
                defaultValue: "Ссылка некорректна.",
              }),
            );
            return;
        }
      }
      const msg =
        ("displayError" in r && r.displayError) ||
        ("message" in r && r.message) ||
        t("auth.error.accessDenied", { defaultValue: "Доступ запрещён" });
      setError(String(msg));
    });
  }, [token, consumeInvite, t]);

  if (staffMember && !error) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          {t("brand")}
        </p>
        <h1 className="mt-2 text-xl font-semibold text-white">
          {t("invite.title", { defaultValue: "Вход по приглашению" })}
        </h1>
        {pending && (
          <p className="mt-4 text-sm text-zinc-400">
            {t("invite.processing", {
              defaultValue: "Активируем приглашение…",
            })}
          </p>
        )}
        {error && (
          <>
            <p className="mt-4 rounded-lg border border-rose-900/60 bg-rose-950/30 p-3 text-sm text-rose-200">
              {error}
            </p>
            <a
              href="/login"
              className="mt-4 inline-block text-sm text-sky-400 underline-offset-4 hover:underline"
            >
              {t("invite.goToLogin", {
                defaultValue: "Войти обычным способом",
              })}
            </a>
          </>
        )}
      </div>
    </div>
  );
}
