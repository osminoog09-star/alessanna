import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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
  /* Поля из 050_manage_list_devices.sql — нужны менеджеру/админу, чтобы
   * группировать устройства по сотрудникам (показывать роль/активность).
   * На admin-RPC их пока нет — отсюда optional. */
  staff_role?: string | null;
  staff_roles?: string[] | null;
  staff_is_active?: boolean | null;
};

/** Ключ collapsable-группы во вкладке «Все устройства». */
type GroupKey = string;

export function ProfileSecurityPage() {
  const { t } = useTranslation();
  const { staffMember, hasDeviceToken, forgetThisDevice } = useAuth();
  const staffId = staffMember?.id;
  const isAdmin = hasStaffRole(staffMember, "admin");
  const isManager = hasStaffRole(staffMember, "manager");
  /* «Может видеть весь парк устройств». Мастер (worker) — не может. */
  const canViewAllDevices = isAdmin || isManager;

  const [adminDevices, setAdminDevices] = useState<AdminDevice[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminBusyId, setAdminBusyId] = useState<string | null>(null);
  /* Развёрнутые группы во вкладке «Все устройства». По умолчанию ВСЁ
   * свёрнуто — пользователь сам раскрывает то, что нужно. Только так
   * экран не превращается в простыню при 30+ устройствах. */
  const [expandedGroups, setExpandedGroups] = useState<Set<GroupKey>>(
    () => new Set<GroupKey>(),
  );
  const toggleGroup = useCallback((key: GroupKey) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

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

  /* Список ВСЕХ устройств — показываем менеджеру и админу.
   * - admin → staff_admin_list_all_devices (полный набор + право управлять)
   * - manager → staff_manage_list_all_devices (read-only, без claim/revoke)
   * - worker → ничего, fall through.
   *
   * RPC выбирается строго по роли: менеджер не должен ловить 42501 от
   * admin-RPC при каждом открытии страницы. */
  const reloadAdminDevices = useCallback(async () => {
    if (!canViewAllDevices || !staffId) return;
    setAdminLoading(true);
    setAdminError(null);
    const rpcName = isAdmin
      ? "staff_admin_list_all_devices"
      : "staff_manage_list_all_devices";
    const { data, error } = await supabase.rpc(rpcName, { actor_id: staffId });
    setAdminLoading(false);
    if (error) {
      setAdminError(error.message);
      return;
    }
    setAdminDevices((data ?? []) as AdminDevice[]);
  }, [canViewAllDevices, isAdmin, staffId]);

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

      {canViewAllDevices && (
        <AllDevicesSection
          devices={adminDevices}
          loading={adminLoading}
          error={adminError}
          isAdmin={isAdmin}
          currentStaffId={staffId ?? null}
          expanded={expandedGroups}
          onToggle={toggleGroup}
          busyId={adminBusyId}
          onClaim={adminClaim}
          onRelease={adminRelease}
          onRevoke={adminRevoke}
          onReload={reloadAdminDevices}
          t={t}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Секция «Все устройства» — для админа и менеджера.
 *
 * UX-правила:
 *   • Каждый сотрудник по умолчанию видит ТОЛЬКО свои устройства (это в
 *     отдельной секции выше). Здесь — обзор всего парка.
 *   • Устройства сгруппированы и СВЁРНУТЫ по умолчанию. Это сознательно:
 *     админу/менеджеру при 30+ девайсах не нужна простыня.
 *   • Админ видит кнопки claim/release/revoke. Менеджер — только смотрит.
 *   • Свои устройства из группировок исключаем (они уже выше).
 * ──────────────────────────────────────────────────────────────────────── */

type AllDevicesSectionProps = {
  devices: AdminDevice[];
  loading: boolean;
  error: string | null;
  isAdmin: boolean;
  currentStaffId: string | null;
  expanded: Set<GroupKey>;
  onToggle: (key: GroupKey) => void;
  busyId: string | null;
  onClaim: (id: string) => Promise<void> | void;
  onRelease: (id: string) => Promise<void> | void;
  onRevoke: (id: string) => Promise<void> | void;
  onReload: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
};

function AllDevicesSection(props: AllDevicesSectionProps) {
  const {
    devices,
    loading,
    error,
    isAdmin,
    currentStaffId,
    expanded,
    onToggle,
    busyId,
    onClaim,
    onRelease,
    onRevoke,
    onReload,
    t,
  } = props;

  /* Раскладываем устройства по группам:
   *   salon  — активные общие устройства (не привязаны к одному сотруднику)
   *   staff:<id> — активные устройства конкретного сотрудника (кроме меня)
   *   revoked — всё отозванное (история) */
  const groups = useMemo(() => {
    const salon: AdminDevice[] = [];
    const revoked: AdminDevice[] = [];
    /* Map<staff_id, { name, items[] }>. Используем Map чтобы сохранить
     * порядок «как пришло» и стабильно показывать. */
    const byStaff = new Map<string, { name: string; items: AdminDevice[] }>();

    for (const d of devices) {
      if (d.revoked_at) {
        revoked.push(d);
        continue;
      }
      if (d.is_salon_device) {
        salon.push(d);
        continue;
      }
      // Свои собственные активные — НЕ показываем здесь (они выше в
      // «Доверенные устройства»). Иначе двойной список и риск нажать revoke
      // не там, где ожидал.
      if (currentStaffId && d.staff_id === currentStaffId) continue;

      const key = d.staff_id;
      const existing = byStaff.get(key);
      if (existing) {
        existing.items.push(d);
      } else {
        byStaff.set(key, {
          name: d.staff_name || t("profileSecurity.unknownStaff", { defaultValue: "Неизвестный сотрудник" }),
          items: [d],
        });
      }
    }
    return { salon, revoked, byStaff };
  }, [devices, currentStaffId, t]);

  const totalShown =
    groups.salon.length +
    groups.revoked.length +
    Array.from(groups.byStaff.values()).reduce((acc, g) => acc + g.items.length, 0);

  return (
    <section className="rounded-xl border border-violet-900/50 bg-zinc-950 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            {t("profileSecurity.allDevicesTitle", {
              defaultValue: "Все устройства",
            })}
            <span
              className={
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                (isAdmin
                  ? "border-rose-700/60 bg-rose-950/40 text-rose-200"
                  : "border-emerald-700/60 bg-emerald-950/40 text-emerald-200")
              }
            >
              {isAdmin
                ? t("profileSecurity.roleAdmin", { defaultValue: "admin" })
                : t("profileSecurity.roleManager", { defaultValue: "manager" })}
            </span>
            <span className="rounded-full border border-zinc-700 bg-zinc-900/60 px-2 py-0.5 text-[10px] text-zinc-400">
              {totalShown}
            </span>
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            {isAdmin
              ? t("profileSecurity.adminAllDevicesHint", {
                  defaultValue:
                    "Сотрудники добавляют устройства автоматически при входе. Чтобы планшет на ресепшене или другой общий девайс пускал любого мастера без PIN — переведите его в «Устройство салона».",
                })
              : t("profileSecurity.managerAllDevicesHint", {
                  defaultValue:
                    "Только просмотр. Управлять (сделать «общим», отозвать) может админ.",
                })}
          </p>
        </div>
        <button
          type="button"
          onClick={onReload}
          className="text-xs text-zinc-400 underline-offset-4 hover:text-white hover:underline"
        >
          {t("common.refresh", { defaultValue: "Обновить" })}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {loading ? (
        <p className="mt-3 text-sm text-zinc-500">{t("common.loading")}</p>
      ) : totalShown === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">
          {t("profileSecurity.adminNoDevices", {
            defaultValue: "Пока нет ни одного зарегистрированного устройства.",
          })}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {groups.salon.length > 0 && (
            <CollapsibleGroup
              groupKey="salon"
              expanded={expanded.has("salon")}
              onToggle={onToggle}
              icon="🏢"
              title={t("profileSecurity.groupSalon", {
                defaultValue: "Устройства салона",
              })}
              count={groups.salon.length}
              accent="violet"
              hint={t("profileSecurity.groupSalonHint", {
                defaultValue: "Общие планшеты/ноутбуки. Пускают любого активного сотрудника без PIN.",
              })}
            >
              <DeviceList
                items={groups.salon}
                isAdmin={isAdmin}
                busyId={busyId}
                onClaim={onClaim}
                onRelease={onRelease}
                onRevoke={onRevoke}
                t={t}
              />
            </CollapsibleGroup>
          )}

          {Array.from(groups.byStaff.entries()).map(([sid, g]) => (
            <CollapsibleGroup
              key={sid}
              groupKey={`staff:${sid}`}
              expanded={expanded.has(`staff:${sid}`)}
              onToggle={onToggle}
              icon="👤"
              title={g.name}
              count={g.items.length}
              accent="zinc"
            >
              <DeviceList
                items={g.items}
                isAdmin={isAdmin}
                busyId={busyId}
                onClaim={onClaim}
                onRelease={onRelease}
                onRevoke={onRevoke}
                t={t}
              />
            </CollapsibleGroup>
          ))}

          {groups.revoked.length > 0 && (
            <CollapsibleGroup
              groupKey="revoked"
              expanded={expanded.has("revoked")}
              onToggle={onToggle}
              icon="🗑"
              title={t("profileSecurity.groupRevoked", {
                defaultValue: "Отозванные",
              })}
              count={groups.revoked.length}
              accent="zinc"
              hint={t("profileSecurity.groupRevokedHint", {
                defaultValue: "История. Этими токенами уже нельзя войти.",
              })}
            >
              <DeviceList
                items={groups.revoked}
                isAdmin={isAdmin}
                busyId={busyId}
                onClaim={onClaim}
                onRelease={onRelease}
                onRevoke={onRevoke}
                t={t}
              />
            </CollapsibleGroup>
          )}
        </div>
      )}
    </section>
  );
}

function CollapsibleGroup(props: {
  groupKey: GroupKey;
  expanded: boolean;
  onToggle: (key: GroupKey) => void;
  icon: string;
  title: string;
  count: number;
  accent: "violet" | "zinc";
  hint?: string;
  children: React.ReactNode;
}) {
  const accent =
    props.accent === "violet"
      ? "border-violet-900/40 bg-violet-950/10"
      : "border-zinc-800 bg-zinc-900/30";
  return (
    <div className={`rounded-lg border ${accent}`}>
      <button
        type="button"
        onClick={() => props.onToggle(props.groupKey)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-zinc-100 hover:bg-white/5"
        aria-expanded={props.expanded}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true">{props.icon}</span>
          <span className="truncate font-medium">{props.title}</span>
          <span className="shrink-0 rounded-full border border-zinc-700 bg-zinc-900/70 px-1.5 py-0.5 text-[10px] text-zinc-400">
            {props.count}
          </span>
        </span>
        <span
          className={`shrink-0 text-zinc-500 transition-transform ${props.expanded ? "rotate-90" : ""}`}
          aria-hidden="true"
        >
          ▶
        </span>
      </button>
      {props.expanded && (
        <div className="border-t border-zinc-800/80 px-3 py-2">
          {props.hint && (
            <p className="mb-2 text-[11px] text-zinc-500">{props.hint}</p>
          )}
          {props.children}
        </div>
      )}
    </div>
  );
}

function DeviceList(props: {
  items: AdminDevice[];
  isAdmin: boolean;
  busyId: string | null;
  onClaim: (id: string) => Promise<void> | void;
  onRelease: (id: string) => Promise<void> | void;
  onRevoke: (id: string) => Promise<void> | void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  const { items, isAdmin, busyId, onClaim, onRelease, onRevoke, t } = props;
  return (
    <ul className="divide-y divide-zinc-800/80">
      {items.map((d) => {
        const busy = busyId === d.id;
        return (
          <li
            key={d.id}
            className={
              "flex flex-wrap items-center justify-between gap-3 py-2.5 " +
              (d.is_salon_device ? "rounded-lg bg-violet-950/10 px-2" : "")
            }
          >
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-white">
                <span className="truncate">{d.label || "—"}</span>
                {d.is_salon_device && (
                  <span className="shrink-0 rounded-full border border-violet-700/60 bg-violet-950/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
                    {t("profileSecurity.badgeSalon", { defaultValue: "Салон" })}
                  </span>
                )}
                {d.revoked_at && (
                  <span className="shrink-0 rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                    {t("profileSecurity.revoked", { defaultValue: "Отозвано" })}
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
                  {t("profileSecurity.lastSeen", { defaultValue: "Последний вход" })}
                  : {new Date(d.last_seen_at).toLocaleString()}
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
            {/* Управляющие кнопки только для админа и только для активных устройств. */}
            {isAdmin && !d.revoked_at && (
              <div className="flex shrink-0 items-center gap-2">
                {d.is_salon_device ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onRelease(d.id)}
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
                    onClick={() => void onClaim(d.id)}
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
                  onClick={() => void onRevoke(d.id)}
                  className="rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/30 disabled:opacity-50"
                >
                  {t("profileSecurity.revoke", { defaultValue: "Отозвать" })}
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
