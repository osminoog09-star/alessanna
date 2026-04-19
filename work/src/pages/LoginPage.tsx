import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth, type LoginResult } from "../context/AuthContext";
import { isSupabaseConfigured } from "../lib/supabase";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

type Step = "phone" | "pin";

export function LoginPage() {
  const { t } = useTranslation();
  const { staffMember, login, hasDeviceToken } = useAuth();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [step, setStep] = useState<Step>("phone");
  const [staffName, setStaffName] = useState<string>("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (staffMember) return <Navigate to="/" replace />;

  function applyResult(r: LoginResult) {
    if (r.ok) return;
    if ("status" in r) {
      if (r.status === "requires_pin") {
        setStaffName(r.staffName ?? "");
        setStep("pin");
        setError("");
        return;
      }
      if (r.status === "invalid_pin") {
        setError(t("auth.error.invalidPin", { defaultValue: "Неверный PIN" }));
        return;
      }
      if (r.status === "pin_locked") {
        setError(
          t("auth.error.pinLocked", {
            defaultValue: "Слишком много неудач. Попробуйте через 15 минут.",
          })
        );
        return;
      }
      if (r.status === "access_denied") {
        setError(t("auth.error.accessDenied", { defaultValue: "Доступ запрещён" }));
        return;
      }
    }
    if ("displayError" in r && r.displayError) {
      setError(r.displayError);
      return;
    }
    if ("errorKey" in r && r.errorKey) {
      setError(
        "message" in r && r.message
          ? t(r.errorKey, { message: r.message })
          : t(r.errorKey)
      );
      return;
    }
    setError(t("auth.error.accessDenied", { defaultValue: "Доступ запрещён" }));
  }

  async function onSubmitPhone(e: FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    const r = await login({ phone });
    setPending(false);
    applyResult(r);
  }

  async function onSubmitPin(e: FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    /* Каждый успешный логин по PIN = новое доверенное устройство.
     * Это убирает занудный шаг «поставь галочку, если хочешь без PIN»:
     * админ может в любой момент отозвать в /profile/security или вообще
     * перевести устройство в статус «салонного». См. 047_salon_devices.sql. */
    const deviceLabel =
      typeof navigator !== "undefined"
        ? navigator.userAgent.split(" ").slice(-2).join(" ").slice(0, 60)
        : "Браузер CRM";
    const r = await login({
      phone,
      pin,
      trustThisDevice: true,
      deviceLabel,
    });
    setPending(false);
    applyResult(r);
  }

  function backToPhone() {
    setStep("phone");
    setPin("");
    setError("");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black px-4">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{t("brand")}</p>
        <h1 className="mt-2 text-xl font-semibold text-white">{t("login.title")}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {step === "phone"
            ? t("login.subtitle")
            : t("login.pinSubtitle", {
                defaultValue: "Введите PIN для доступа",
                name: staffName,
              })}
        </p>

        {!isSupabaseConfigured() && (
          <p className="mt-4 rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-sm text-amber-200/90">
            {t("login.configLine")}
          </p>
        )}

        {step === "phone" && hasDeviceToken && (
          <p className="mt-4 rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-2.5 text-xs text-emerald-200/80">
            {t("login.trustedDeviceHint", {
              defaultValue: "Это устройство добавлено в доверенные — войдёте без PIN",
            })}
          </p>
        )}

        {step === "phone" ? (
          <form onSubmit={onSubmitPhone} className="mt-6 space-y-4">
            <div>
              <label htmlFor="phone" className="block text-xs font-medium text-zinc-500">
                {t("login.phone")}
              </label>
              <input
                id="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                placeholder={t("login.placeholder")}
                aria-describedby="phone-hint"
                required
              />
              <p id="phone-hint" className="mt-1 text-xs text-zinc-600">
                {t("login.hint")}
              </p>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-lg bg-sky-600 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {pending ? t("login.signingIn") : t("login.button")}
            </button>
          </form>
        ) : (
          <form onSubmit={onSubmitPin} className="mt-6 space-y-4">
            <div>
              <label htmlFor="pin" className="block text-xs font-medium text-zinc-500">
                {t("login.pin", { defaultValue: "PIN" })}
                {staffName && <span className="ml-2 text-zinc-600">· {staffName}</span>}
              </label>
              <input
                id="pin"
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 12))}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-center text-lg tracking-[0.5em] text-white focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                placeholder="••••"
                minLength={4}
                maxLength={12}
                autoFocus
                required
              />
            </div>

            {/* Раньше тут был чекбокс «Доверять устройству». Убрал: каждый
              * успешный логин теперь автоматически добавляет устройство в
              * доверенные (см. 047_salon_devices.sql и onSubmitPin). Меньше
              * кликов и меньше путаницы — а отозвать всё равно можно в
              * /profile/security. Заодно админ из той же страницы может
              * перевести устройство в статус «общего салонного». */}
            <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-400">
              {t("login.deviceWillBeRemembered", {
                defaultValue:
                  "Это устройство автоматически запомнится — в следующий раз войдёте без PIN. Отозвать можно в Профиле → Безопасность.",
              })}
            </p>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={backToPhone}
                className="flex-1 rounded-lg border border-zinc-700 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-900"
              >
                {t("common.back", { defaultValue: "Назад" })}
              </button>
              <button
                type="submit"
                disabled={pending || pin.length < 4}
                className="flex-[2] rounded-lg bg-sky-600 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {pending ? t("login.signingIn") : t("login.button")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
