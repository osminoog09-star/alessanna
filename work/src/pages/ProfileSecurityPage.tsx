import { FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";

type TrustedDevice = {
  id: string;
  label: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
};

export function ProfileSecurityPage() {
  const { t } = useTranslation();
  const { staffMember, hasDeviceToken, forgetThisDevice } = useAuth();
  const staffId = staffMember?.id;

  const [devices, setDevices] = useState<TrustedDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [devicesError, setDevicesError] = useState<string | null>(null);

  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinPending, setPinPending] = useState(false);
  const [pinMessage, setPinMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const reload = useCallback(async () => {
    if (!staffId) return;
    setDevicesLoading(true);
    setDevicesError(null);
    const { data, error } = await supabase.rpc("staff_list_trusted_devices", {
      staff_id_input: staffId,
    });
    setDevicesLoading(false);
    if (error) {
      setDevicesError(error.message);
      return;
    }
    setDevices((data ?? []) as TrustedDevice[]);
  }, [staffId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onSetPin(e: FormEvent) {
    e.preventDefault();
    setPinMessage(null);
    if (!staffId) return;
    if (newPin.length < 4 || newPin.length > 12 || !/^[0-9]+$/.test(newPin)) {
      setPinMessage({
        kind: "err",
        text: t("profileSecurity.pinFormatError", {
          defaultValue: "PIN: 4–12 цифр",
        }),
      });
      return;
    }
    if (newPin !== confirmPin) {
      setPinMessage({
        kind: "err",
        text: t("profileSecurity.pinMismatch", {
          defaultValue: "PIN не совпадает с подтверждением",
        }),
      });
      return;
    }
    setPinPending(true);
    const { data, error } = await supabase.rpc("staff_set_pin", {
      staff_id_input: staffId,
      current_pin: currentPin || null,
      new_pin: newPin,
    });
    setPinPending(false);
    if (error) {
      setPinMessage({ kind: "err", text: error.message });
      return;
    }
    const status = (data && typeof data === "object" && "status" in data ? (data as { status: string }).status : "") || "";
    if (status === "ok") {
      setPinMessage({
        kind: "ok",
        text: t("profileSecurity.pinUpdated", {
          defaultValue: "PIN сохранён. Все доверенные устройства отозваны.",
        }),
      });
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      await reload();
      return;
    }
    if (status === "current_pin_required") {
      setPinMessage({
        kind: "err",
        text: t("profileSecurity.currentPinRequired", {
          defaultValue: "Введите текущий PIN, чтобы изменить",
        }),
      });
      return;
    }
    if (status === "invalid_current_pin") {
      setPinMessage({
        kind: "err",
        text: t("profileSecurity.invalidCurrentPin", {
          defaultValue: "Текущий PIN неверный",
        }),
      });
      return;
    }
    if (status === "invalid_pin_format") {
      setPinMessage({
        kind: "err",
        text: t("profileSecurity.pinFormatError", {
          defaultValue: "PIN: 4–12 цифр",
        }),
      });
      return;
    }
    setPinMessage({ kind: "err", text: status });
  }

  async function onRevokeDevice(deviceId: string) {
    if (!staffId) return;
    if (!window.confirm(t("profileSecurity.revokeConfirm", { defaultValue: "Отозвать это устройство?" }))) return;
    const { error } = await supabase.rpc("staff_revoke_trusted_device", {
      staff_id_input: staffId,
      device_id_input: deviceId,
    });
    if (error) {
      setDevicesError(error.message);
      return;
    }
    await reload();
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold text-white">
          {t("profileSecurity.title", { defaultValue: "Безопасность входа" })}
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          {t("profileSecurity.subtitle", {
            defaultValue:
              "PIN защищает вход в CRM. Доверенные устройства запоминаются — на них вход без PIN.",
          })}
        </p>
      </header>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
        <h2 className="text-base font-semibold text-white">
          {devices && devices.length > 0
            ? t("profileSecurity.changePin", { defaultValue: "Сменить PIN" })
            : t("profileSecurity.setPin", { defaultValue: "Установить PIN" })}
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          {t("profileSecurity.pinHelp", {
            defaultValue: "4–12 цифр. После установки этот PIN будет требоваться при входе с новых устройств.",
          })}
        </p>
        <form onSubmit={onSetPin} className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-500">
              {t("profileSecurity.currentPin", { defaultValue: "Текущий PIN (если был установлен)" })}
            </label>
            <input
              type="password"
              inputMode="numeric"
              value={currentPin}
              onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 12))}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
              placeholder={t("profileSecurity.currentPinPlaceholder", { defaultValue: "Оставить пустым, если ещё не задан" })}
              maxLength={12}
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500">
              {t("profileSecurity.newPin", { defaultValue: "Новый PIN" })}
            </label>
            <input
              type="password"
              inputMode="numeric"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 12))}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
              minLength={4}
              maxLength={12}
              autoComplete="new-password"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500">
              {t("profileSecurity.confirmPin", { defaultValue: "Подтвердите новый PIN" })}
            </label>
            <input
              type="password"
              inputMode="numeric"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 12))}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
              minLength={4}
              maxLength={12}
              autoComplete="new-password"
              required
            />
          </div>
          {pinMessage && (
            <p className={`text-sm ${pinMessage.kind === "ok" ? "text-emerald-400" : "text-red-400"}`}>
              {pinMessage.text}
            </p>
          )}
          <button
            type="submit"
            disabled={pinPending || newPin.length < 4}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {pinPending
              ? t("common.saving", { defaultValue: "Сохраняем…" })
              : t("profileSecurity.savePin", { defaultValue: "Сохранить PIN" })}
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">
            {t("profileSecurity.devices", { defaultValue: "Доверенные устройства" })}
          </h2>
          <button
            type="button"
            onClick={() => void reload()}
            className="text-xs text-zinc-400 underline-offset-4 hover:text-white hover:underline"
          >
            {t("common.refresh", { defaultValue: "Обновить" })}
          </button>
        </div>

        {hasDeviceToken && (
          <div className="mt-3 flex items-center justify-between rounded-lg border border-emerald-900/50 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-200">
            <span>
              {t("profileSecurity.thisDeviceTrusted", {
                defaultValue: "Это устройство — доверенное.",
              })}
            </span>
            <button
              type="button"
              onClick={forgetThisDevice}
              className="rounded border border-emerald-800 px-2 py-1 text-emerald-200 hover:bg-emerald-900/40"
            >
              {t("profileSecurity.forgetThisDevice", { defaultValue: "Забыть на этом устройстве" })}
            </button>
          </div>
        )}

        {devicesError && <p className="mt-3 text-sm text-red-400">{devicesError}</p>}
        {devicesLoading ? (
          <p className="mt-3 text-sm text-zinc-500">{t("common.loading")}</p>
        ) : devices.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            {t("profileSecurity.noDevices", { defaultValue: "Доверенных устройств нет." })}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-800">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{d.label || "—"}</p>
                  <p className="truncate text-xs text-zinc-500">{d.user_agent ?? ""}</p>
                  <p className="mt-0.5 text-xs text-zinc-600">
                    {t("profileSecurity.lastSeen", { defaultValue: "Последний вход" })}:{" "}
                    {new Date(d.last_seen_at).toLocaleString()}
                  </p>
                </div>
                {d.revoked_at ? (
                  <span className="rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-500">
                    {t("profileSecurity.revoked", { defaultValue: "Отозвано" })}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void onRevokeDevice(d.id)}
                    className="rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/30"
                  >
                    {t("profileSecurity.revoke", { defaultValue: "Отозвать" })}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
