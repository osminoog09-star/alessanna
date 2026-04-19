import { FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { hasStaffRole } from "../lib/roles";

type TrustedDevice = {
  id: string;
  label: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
  /* Поля из 047_salon_devices.sql. На «старом» бэке отсутствуют —
   * UI трактует undefined как «обычное устройство». */
  is_salon_device?: boolean;
  claimed_at?: string | null;
  /* Поле из 048_trusted_device_ip.sql. Возвращается как строка через host()
   * (для IPv4 → «1.2.3.4», для IPv6 без квадратных скобок). На старом
   * бэке поле отсутствует — UI просто не показывает. */
  ip_address?: string | null;
};

type AdminDevice = TrustedDevice & {
  staff_id: string;
  staff_name: string | null;
  claimed_by_admin_id: string | null;
  claimed_by_admin_name: string | null;
};

/** Запись о приглашении из staff_admin_list_invites. */
type InviteLink = {
  id: string;
  staff_id: string;
  staff_name: string | null;
  created_by_admin_id: string | null;
  created_by_admin_name: string | null;
  created_at: string;
  expires_at: string;
  max_uses: number;
  uses_count: number;
  last_used_at: string | null;
  last_used_ip: string | null;
  note: string | null;
  revoked_at: string | null;
  status: "active" | "used_up" | "expired" | "revoked";
};

/** Минимальный сотрудник для селекта «кому приглашение». */
type InviteStaffOption = { id: string; name: string };

/** Один из пресетов «срок жизни ссылки» в минутах. */
const INVITE_TTL_PRESETS: Array<{ label: string; minutes: number }> = [
  { label: "1 час", minutes: 60 },
  { label: "6 часов", minutes: 60 * 6 },
  { label: "24 часа", minutes: 60 * 24 },
  { label: "7 дней", minutes: 60 * 24 * 7 },
];

export function ProfileSecurityPage() {
  const { t } = useTranslation();
  const { staffMember, hasDeviceToken, forgetThisDevice } = useAuth();
  const staffId = staffMember?.id;
  const isAdmin = hasStaffRole(staffMember, "admin");

  const [adminDevices, setAdminDevices] = useState<AdminDevice[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminBusyId, setAdminBusyId] = useState<string | null>(null);

  /* Приглашения. Доступны только админам. */
  const [invites, setInvites] = useState<InviteLink[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [invitesError, setInvitesError] = useState<string | null>(null);
  const [inviteStaffOptions, setInviteStaffOptions] = useState<InviteStaffOption[]>([]);
  const [inviteStaffId, setInviteStaffId] = useState("");
  const [inviteTtlMinutes, setInviteTtlMinutes] = useState(60 * 24);
  const [inviteMaxUses, setInviteMaxUses] = useState(1);
  const [inviteNote, setInviteNote] = useState("");
  const [inviteCreating, setInviteCreating] = useState(false);
  /* Только что созданная ссылка показывается отдельной плашкой — plaintext
   * токена больше нигде не сохраняется, второй раз посмотреть нельзя. */
  const [justCreatedInvite, setJustCreatedInvite] = useState<{
    url: string;
    staffName: string;
    expiresAt: string;
  } | null>(null);
  const [inviteBusyId, setInviteBusyId] = useState<string | null>(null);
  const [inviteCopyOk, setInviteCopyOk] = useState(false);

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

  /* Админский список ВСЕХ устройств всех сотрудников — нужен только админу.
   * Подтягиваем отдельным RPC, который сам проверит роль вызывающего и
   * вернёт расширенный набор полей (staff_name, claimed_by_admin_name…). */
  const reloadAdminDevices = useCallback(async () => {
    if (!isAdmin || !staffId) return;
    setAdminLoading(true);
    setAdminError(null);
    const { data, error } = await supabase.rpc("staff_admin_list_all_devices", {
      actor_id: staffId,
    });
    setAdminLoading(false);
    if (error) {
      setAdminError(error.message);
      return;
    }
    setAdminDevices((data ?? []) as AdminDevice[]);
  }, [isAdmin, staffId]);

  useEffect(() => {
    void reloadAdminDevices();
  }, [reloadAdminDevices]);

  async function adminClaim(deviceId: string) {
    if (!staffId) return;
    setAdminBusyId(deviceId);
    const { error } = await supabase.rpc(
      "staff_admin_claim_device_for_salon",
      { device_id_input: deviceId, actor_id: staffId },
    );
    setAdminBusyId(null);
    if (error) {
      setAdminError(error.message);
      return;
    }
    await Promise.all([reloadAdminDevices(), reload()]);
  }
  async function adminRelease(deviceId: string) {
    if (!staffId) return;
    setAdminBusyId(deviceId);
    const { error } = await supabase.rpc(
      "staff_admin_release_device_to_owner",
      { device_id_input: deviceId, actor_id: staffId },
    );
    setAdminBusyId(null);
    if (error) {
      setAdminError(error.message);
      return;
    }
    await Promise.all([reloadAdminDevices(), reload()]);
  }
  async function adminRevoke(deviceId: string) {
    if (!staffId) return;
    if (
      !window.confirm(
        t("profileSecurity.revokeConfirm", {
          defaultValue: "Отозвать это устройство?",
        }),
      )
    ) {
      return;
    }
    setAdminBusyId(deviceId);
    const { error } = await supabase.rpc("staff_admin_revoke_device", {
      device_id_input: deviceId,
      actor_id: staffId,
    });
    setAdminBusyId(null);
    if (error) {
      setAdminError(error.message);
      return;
    }
    await Promise.all([reloadAdminDevices(), reload()]);
  }

  /* ---- Приглашения (admin) ----------------------------------------- */

  const reloadInvites = useCallback(async () => {
    if (!isAdmin || !staffId) return;
    setInvitesLoading(true);
    setInvitesError(null);
    const { data, error } = await supabase.rpc("staff_admin_list_invites", {
      actor_id: staffId,
    });
    setInvitesLoading(false);
    if (error) {
      setInvitesError(error.message);
      return;
    }
    setInvites((data ?? []) as InviteLink[]);
  }, [isAdmin, staffId]);

  /* Подтянем список активных сотрудников для селекта «кому приглашение».
   * Берём только active=true, но не фильтруем по роли — иногда админу нужно
   * пригласить даже временного админа/менеджера. */
  const reloadInviteStaffOptions = useCallback(async () => {
    if (!isAdmin) return;
    const { data, error } = await supabase
      .from("staff")
      .select("id,name")
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (error) {
      setInvitesError(error.message);
      return;
    }
    const opts = (data ?? []).map((s) => ({
      id: String(s.id),
      name: String(s.name ?? ""),
    }));
    setInviteStaffOptions(opts);
    setInviteStaffId((prev) => prev || opts[0]?.id || "");
  }, [isAdmin]);

  useEffect(() => {
    void reloadInvites();
    void reloadInviteStaffOptions();
  }, [reloadInvites, reloadInviteStaffOptions]);

  async function onCreateInvite(e: FormEvent) {
    e.preventDefault();
    if (!staffId || !inviteStaffId) return;
    setInviteCreating(true);
    setInvitesError(null);
    setJustCreatedInvite(null);
    setInviteCopyOk(false);
    const { data, error } = await supabase.rpc("staff_admin_create_invite", {
      actor_id: staffId,
      target_staff_id: inviteStaffId,
      expires_in_minutes: inviteTtlMinutes,
      max_uses_input: inviteMaxUses,
      note_input: inviteNote.trim() || null,
    });
    setInviteCreating(false);
    if (error) {
      setInvitesError(error.message);
      return;
    }
    const payload = (data ?? {}) as Record<string, unknown>;
    const status = String(payload.status ?? "");
    if (status !== "ok") {
      setInvitesError(
        status === "staff_not_found"
          ? "Сотрудник не найден"
          : status === "staff_inactive"
            ? "Сотрудник деактивирован"
            : `RPC вернул status=${status}`,
      );
      return;
    }
    const token = String(payload.token ?? "");
    const url = `${window.location.origin}/invite/${encodeURIComponent(token)}`;
    setJustCreatedInvite({
      url,
      staffName: String(payload.staff_name ?? ""),
      expiresAt: String(payload.expires_at ?? ""),
    });
    setInviteNote("");
    await reloadInvites();
  }

  async function copyJustCreatedInvite() {
    if (!justCreatedInvite) return;
    try {
      await navigator.clipboard.writeText(justCreatedInvite.url);
      setInviteCopyOk(true);
      window.setTimeout(() => setInviteCopyOk(false), 2000);
    } catch {
      /* свалится на mobile с http — не страшно, пользователь скопирует руками */
    }
  }

  async function onRevokeInvite(inviteId: string) {
    if (!staffId) return;
    if (
      !window.confirm(
        t("profileSecurity.inviteRevokeConfirm", {
          defaultValue: "Отозвать ссылку?",
        }),
      )
    ) {
      return;
    }
    setInviteBusyId(inviteId);
    const { error } = await supabase.rpc("staff_admin_revoke_invite", {
      invite_id_input: inviteId,
      actor_id: staffId,
    });
    setInviteBusyId(null);
    if (error) {
      setInvitesError(error.message);
      return;
    }
    await reloadInvites();
  }

  /* ------------------------------------------------------------------- */

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
                  <p className="flex items-center gap-2 truncate text-sm font-medium text-white">
                    <span className="truncate">{d.label || "—"}</span>
                    {/* Если админ забрал устройство под салон — показываем
                     * это пользователю явно: «не моё устройство, общее».
                     * Так юзер не удивится, что revoke ему недоступен. */}
                    {d.is_salon_device && (
                      <span
                        className="shrink-0 rounded-full border border-violet-700/60 bg-violet-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200"
                        title="Это устройство переведено в режим «общий салонный». Управляет админ."
                      >
                        Салон
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-zinc-500">{d.user_agent ?? ""}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-zinc-600">
                    <span>
                      {t("profileSecurity.lastSeen", { defaultValue: "Последний вход" })}:{" "}
                      {new Date(d.last_seen_at).toLocaleString()}
                    </span>
                    {d.ip_address && (
                      <span
                        className="rounded border border-zinc-800 bg-zinc-900/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
                        title={t("profileSecurity.ipHint", {
                          defaultValue: "IP, с которого был последний вход",
                        })}
                      >
                        IP {d.ip_address}
                      </span>
                    )}
                  </p>
                </div>
                {d.revoked_at ? (
                  <span className="rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-500">
                    {t("profileSecurity.revoked", { defaultValue: "Отозвано" })}
                  </span>
                ) : d.is_salon_device ? (
                  <span
                    className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-500"
                    title="Управляет админ — обратитесь к нему, чтобы отозвать."
                  >
                    {t("profileSecurity.salonOwned", {
                      defaultValue: "Под админом",
                    })}
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

      {isAdmin && (
        <section className="rounded-xl border border-sky-900/50 bg-zinc-950 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-white">
                {t("profileSecurity.invitesTitle", {
                  defaultValue: "Пригласительные ссылки",
                })}
                <span className="rounded-full border border-sky-700/60 bg-sky-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200">
                  admin
                </span>
              </h2>
              <p className="mt-1 max-w-2xl text-xs text-zinc-500">
                {t("profileSecurity.invitesHint", {
                  defaultValue:
                    "Создайте одноразовую ссылку для конкретного мастера или админа. Он откроет её → автоматически залогинится → его устройство сразу станет доверенным. PIN/телефон вводить не нужно.",
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void reloadInvites()}
              className="text-xs text-zinc-400 underline-offset-4 hover:text-white hover:underline"
            >
              {t("common.refresh", { defaultValue: "Обновить" })}
            </button>
          </div>

          <form
            onSubmit={onCreateInvite}
            className="mt-4 grid gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 sm:grid-cols-2"
          >
            <label className="block">
              <span className="block text-xs font-medium text-zinc-500">
                {t("profileSecurity.inviteFor", { defaultValue: "Кому" })}
              </span>
              <select
                value={inviteStaffId}
                onChange={(e) => setInviteStaffId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
              >
                {inviteStaffOptions.length === 0 && (
                  <option value="">—</option>
                )}
                {inviteStaffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-zinc-500">
                {t("profileSecurity.inviteTtl", {
                  defaultValue: "Срок действия",
                })}
              </span>
              <select
                value={inviteTtlMinutes}
                onChange={(e) => setInviteTtlMinutes(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
              >
                {INVITE_TTL_PRESETS.map((p) => (
                  <option key={p.minutes} value={p.minutes}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-zinc-500">
                {t("profileSecurity.inviteMaxUses", {
                  defaultValue: "Сколько раз можно использовать",
                })}
              </span>
              <input
                type="number"
                min={1}
                max={20}
                value={inviteMaxUses}
                onChange={(e) =>
                  setInviteMaxUses(
                    Math.max(1, Math.min(20, Number(e.target.value) || 1)),
                  )
                }
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
              />
              <span className="mt-1 block text-[11px] text-zinc-600">
                {t("profileSecurity.inviteMaxUsesHint", {
                  defaultValue:
                    "Обычно 1. Больше — если планшет один и хотите подключать несколько устройств подряд.",
                })}
              </span>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-zinc-500">
                {t("profileSecurity.inviteNote", {
                  defaultValue: "Заметка (необязательно)",
                })}
              </span>
              <input
                type="text"
                value={inviteNote}
                onChange={(e) => setInviteNote(e.target.value.slice(0, 200))}
                placeholder={t("profileSecurity.inviteNotePlaceholder", {
                  defaultValue: "Например: «iPad на ресепшене»",
                })}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={inviteCreating || !inviteStaffId}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {inviteCreating
                  ? t("common.saving", { defaultValue: "Сохраняем…" })
                  : t("profileSecurity.inviteCreate", {
                      defaultValue: "Создать ссылку",
                    })}
              </button>
            </div>
          </form>

          {justCreatedInvite && (
            <div className="mt-4 rounded-lg border border-emerald-800/60 bg-emerald-950/30 p-4">
              <p className="text-sm font-medium text-emerald-100">
                {t("profileSecurity.inviteCreatedFor", {
                  defaultValue: "Ссылка для {{name}} создана",
                  name: justCreatedInvite.staffName,
                })}
              </p>
              <p className="mt-1 text-[11px] text-emerald-300/80">
                {t("profileSecurity.inviteCreatedHint", {
                  defaultValue:
                    "Скопируйте и отправьте мастеру. Это единственный момент, когда вы её видите — потом восстановить нельзя, можно только создать новую.",
                })}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  readOnly
                  value={justCreatedInvite.url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-lg border border-emerald-800/60 bg-black px-3 py-2 font-mono text-xs text-emerald-100"
                />
                <button
                  type="button"
                  onClick={() => void copyJustCreatedInvite()}
                  className="rounded-lg border border-emerald-700 bg-emerald-900/40 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-900/60"
                >
                  {inviteCopyOk
                    ? t("profileSecurity.inviteCopied", {
                        defaultValue: "Скопировано",
                      })
                    : t("profileSecurity.inviteCopy", {
                        defaultValue: "Копировать",
                      })}
                </button>
                <button
                  type="button"
                  onClick={() => setJustCreatedInvite(null)}
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-900"
                >
                  {t("profileSecurity.inviteDismiss", {
                    defaultValue: "Скрыть",
                  })}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-zinc-400">
                {t("profileSecurity.inviteExpiresAt", {
                  defaultValue: "Действует до",
                })}
                : {new Date(justCreatedInvite.expiresAt).toLocaleString()}
              </p>
            </div>
          )}

          {invitesError && (
            <p className="mt-3 text-sm text-red-400">{invitesError}</p>
          )}
          {invitesLoading ? (
            <p className="mt-3 text-sm text-zinc-500">{t("common.loading")}</p>
          ) : invites.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              {t("profileSecurity.invitesEmpty", {
                defaultValue: "Пока нет созданных ссылок.",
              })}
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-zinc-800">
              {invites.map((inv) => {
                const busy = inviteBusyId === inv.id;
                const status = inv.status;
                const statusBadge =
                  status === "active"
                    ? "border-emerald-700/60 bg-emerald-950/40 text-emerald-200"
                    : status === "used_up"
                      ? "border-zinc-700 bg-zinc-900 text-zinc-300"
                      : status === "expired"
                        ? "border-amber-700/60 bg-amber-950/40 text-amber-200"
                        : "border-rose-700/60 bg-rose-950/40 text-rose-200";
                const statusLabel =
                  status === "active"
                    ? "активна"
                    : status === "used_up"
                      ? "использована"
                      : status === "expired"
                        ? "просрочена"
                        : "отозвана";
                return (
                  <li
                    key={inv.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-white">
                        <span className="truncate">{inv.staff_name || "—"}</span>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusBadge}`}
                        >
                          {statusLabel}
                        </span>
                        {inv.note && (
                          <span className="truncate text-xs text-zinc-500">
                            · {inv.note}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {t("profileSecurity.inviteExpiresAt", {
                          defaultValue: "Действует до",
                        })}
                        : {new Date(inv.expires_at).toLocaleString()}
                        {" · "}
                        {t("profileSecurity.inviteUsage", {
                          defaultValue: "использований",
                        })}
                        : {inv.uses_count}/{inv.max_uses}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-600">
                        {t("profileSecurity.inviteCreatedAt", {
                          defaultValue: "Создана",
                        })}
                        : {new Date(inv.created_at).toLocaleString()}
                        {inv.created_by_admin_name && (
                          <span> · {inv.created_by_admin_name}</span>
                        )}
                        {inv.last_used_at && (
                          <span>
                            {" · "}
                            {t("profileSecurity.inviteLastUsed", {
                              defaultValue: "последний раз использована",
                            })}{" "}
                            {new Date(inv.last_used_at).toLocaleString()}
                            {inv.last_used_ip && (
                              <span className="ml-1 font-mono text-[10px] text-zinc-500">
                                IP {inv.last_used_ip}
                              </span>
                            )}
                          </span>
                        )}
                      </p>
                    </div>
                    {status === "active" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onRevokeInvite(inv.id)}
                        className="rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/30 disabled:opacity-50"
                      >
                        {t("profileSecurity.inviteRevoke", {
                          defaultValue: "Отозвать",
                        })}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {isAdmin && (
        <section className="rounded-xl border border-violet-900/50 bg-zinc-950 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-white">
                {t("profileSecurity.adminAllDevices", {
                  defaultValue: "Все устройства салона",
                })}
                <span className="rounded-full border border-violet-700/60 bg-violet-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
                  admin
                </span>
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                {t("profileSecurity.adminAllDevicesHint", {
                  defaultValue:
                    "Сотрудники добавляют устройства автоматически при входе. Чтобы планшет на ресепшене или другой общий девайс пускал любого мастера без PIN — переведите его в «Устройство салона».",
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void reloadAdminDevices()}
              className="text-xs text-zinc-400 underline-offset-4 hover:text-white hover:underline"
            >
              {t("common.refresh", { defaultValue: "Обновить" })}
            </button>
          </div>

          {adminError && (
            <p className="mt-3 text-sm text-red-400">{adminError}</p>
          )}
          {adminLoading ? (
            <p className="mt-3 text-sm text-zinc-500">{t("common.loading")}</p>
          ) : adminDevices.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              {t("profileSecurity.adminNoDevices", {
                defaultValue: "Пока нет ни одного зарегистрированного устройства.",
              })}
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-zinc-800">
              {adminDevices.map((d) => {
                const busy = adminBusyId === d.id;
                return (
                  <li
                    key={d.id}
                    className={
                      "flex flex-wrap items-center justify-between gap-3 py-3 " +
                      (d.is_salon_device
                        ? "rounded-lg bg-violet-950/20 px-2"
                        : "")
                    }
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-white">
                        <span className="truncate">{d.label || "—"}</span>
                        {d.is_salon_device && (
                          <span className="shrink-0 rounded-full border border-violet-700/60 bg-violet-950/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
                            Салон
                          </span>
                        )}
                        {d.revoked_at && (
                          <span className="shrink-0 rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                            Отозвано
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-400">
                        {d.is_salon_device
                          ? t("profileSecurity.adminClaimedFrom", {
                              defaultValue:
                                "Общий девайс. Изначально добавил: {{name}}",
                              name: d.staff_name || "—",
                            })
                          : t("profileSecurity.adminOwnedBy", {
                              defaultValue: "Привязано к: {{name}}",
                              name: d.staff_name || "—",
                            })}
                        {d.is_salon_device && d.claimed_by_admin_name && (
                          <span className="text-zinc-500">
                            {" · "}
                            {t("profileSecurity.adminClaimedBy", {
                              defaultValue: "переведён админом {{name}}",
                              name: d.claimed_by_admin_name,
                            })}
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-zinc-600">
                        {d.user_agent ?? ""}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-zinc-600">
                        <span>
                          {t("profileSecurity.lastSeen", {
                            defaultValue: "Последний вход",
                          })}
                          : {new Date(d.last_seen_at).toLocaleString()}
                        </span>
                        {d.ip_address && (
                          <span
                            className="rounded border border-zinc-800 bg-zinc-900/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
                            title={t("profileSecurity.ipHint", {
                              defaultValue:
                                "IP, с которого был последний вход",
                            })}
                          >
                            IP {d.ip_address}
                          </span>
                        )}
                      </p>
                    </div>
                    {!d.revoked_at && (
                      <div className="flex shrink-0 items-center gap-2">
                        {d.is_salon_device ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void adminRelease(d.id)}
                            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                            title="Снять статус «общего», вернуть исходному владельцу"
                          >
                            {t("profileSecurity.adminRelease", {
                              defaultValue: "Вернуть владельцу",
                            })}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void adminClaim(d.id)}
                            className="rounded-lg border border-violet-700/60 bg-violet-950/40 px-3 py-1.5 text-xs font-medium text-violet-100 hover:bg-violet-900/50 disabled:opacity-50"
                            title="Сделать общим устройством салона: любой активный сотрудник сможет войти без PIN"
                          >
                            {t("profileSecurity.adminClaim", {
                              defaultValue: "Сделать устройством салона",
                            })}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void adminRevoke(d.id)}
                          className="rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/30 disabled:opacity-50"
                        >
                          {t("profileSecurity.revoke", {
                            defaultValue: "Отозвать",
                          })}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
