import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { isSupabaseConfigured } from "../lib/supabase";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { filterStaffLoginPhoneInput, isValidStaffLoginPhoneDigits } from "../lib/staffLoginPhone";

export function LoginPage() {
  const { t } = useTranslation();
  const { staffMember, login } = useAuth();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (staffMember) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const digits = filterStaffLoginPhoneInput(phone);
    if (!isValidStaffLoginPhoneDigits(digits)) {
      setError(t("login.phoneInvalidLength"));
      return;
    }
    setPending(true);
    const r = await login(phone);
    setPending(false);
    if (!r.ok) {
      if (r.displayError) {
        setError(r.displayError);
      } else if (r.errorKey) {
        setError(
          r.message != null && r.message !== ""
            ? t(r.errorKey, { message: r.message })
            : t(r.errorKey)
        );
      } else {
        setError("Доступ запрещён");
      }
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black px-4">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{t("brand")}</p>
        <h1 className="mt-2 text-xl font-semibold text-white">{t("login.title")}</h1>
        <p className="mt-1 text-sm text-zinc-500">{t("login.subtitle")}</p>

        {!isSupabaseConfigured() && (
          <p className="mt-4 rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-sm text-amber-200/90">
            {t("login.configLine")}
          </p>
        )}

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
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
              onChange={(e) => setPhone(filterStaffLoginPhoneInput(e.target.value))}
              maxLength={10}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              placeholder={t("login.placeholder")}
              aria-describedby="phone-hint phone-digit-rule"
              required
            />
            <p id="phone-hint" className="mt-1 text-xs text-zinc-600">
              {t("login.hint")}
            </p>
            <p id="phone-digit-rule" className="mt-0.5 text-xs text-zinc-600">
              {t("login.digitLengthHint")}
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
      </div>
    </div>
  );
}
