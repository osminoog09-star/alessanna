import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { isSupabaseConfigured } from "../lib/supabase";
import { filterStaffLoginPhoneInput, isValidStaffLoginPhoneDigits } from "../lib/staffLoginPhone";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called after successful login (same tick as state update). */
  onLoggedIn?: () => void;
};

export function StaffLoginModal({ open, onClose, onLoggedIn }: Props) {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (!open) return null;

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
      if (r.displayError) setError(r.displayError);
      else if (r.errorKey) {
        setError(
          r.message != null && r.message !== ""
            ? t(r.errorKey, { message: r.message })
            : t(r.errorKey)
        );
      } else setError(t("auth.error.accessDenied"));
      return;
    }
    setPhone("");
    onLoggedIn?.();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-login-title"
      >
        <h2 id="staff-login-title" className="text-lg font-semibold text-white">
          {t("reception.loginTitle")}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">{t("login.subtitle")}</p>

        {!isSupabaseConfigured() && (
          <p className="mt-4 rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-sm text-amber-200/90">
            {t("login.configLine")}
          </p>
        )}

        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="staff-login-phone" className="block text-xs font-medium text-zinc-500">
              {t("login.phone")}
            </label>
            <input
              id="staff-login-phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(filterStaffLoginPhoneInput(e.target.value))}
              maxLength={10}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              placeholder={t("login.placeholder")}
              aria-describedby="staff-login-hint staff-login-digits"
              required
            />
            <p id="staff-login-hint" className="mt-1 text-xs text-zinc-600">
              {t("login.hint")}
            </p>
            <p id="staff-login-digits" className="mt-0.5 text-xs text-zinc-600">
              {t("login.digitLengthHint")}
            </p>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setError("");
                onClose();
              }}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {pending ? t("login.signingIn") : t("login.button")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
