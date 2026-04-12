import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { useEffectiveRole } from "../context/EffectiveRoleContext";
import type { CalendarStaffBarState } from "../types/appOutlet";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { StaffLoginModal } from "./StaffLoginModal";

type Props = {
  /** Optional: calendar page registers multi-staff quick pick (reception + managers). */
  calendarStaffQuick?: CalendarStaffBarState | null;
};

/** Top bar: session role, login/switch, logout to reception, optional staff quick-pick. */
export function AppTopBar({ calendarStaffQuick }: Props) {
  const { t } = useTranslation();
  const { isReceptionMode, logout } = useAuth();
  const { effectiveRole, previewRole } = useEffectiveRole();
  const [loginOpen, setLoginOpen] = useState(false);

  const roleLabel = useMemo(() => {
    if (isReceptionMode) return t("role.reception");
    if (previewRole) return `${t(`role.${previewRole}`)} · ${t("preview.label")}`;
    if (effectiveRole) return t(`role.${effectiveRole}`);
    return t("role.worker");
  }, [isReceptionMode, previewRole, effectiveRole, t]);

  const showStaffQuick = Boolean(calendarStaffQuick && calendarStaffQuick.options.length > 1);

  return (
    <>
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-3 border-b border-zinc-800 bg-zinc-950/95 px-4 py-2 backdrop-blur-sm">
        <div className="min-w-0 flex-1 basis-[140px]">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            {t("reception.sessionRole")}
          </p>
          <p className="truncate text-sm font-medium text-zinc-100">{roleLabel}</p>
        </div>

        {showStaffQuick && calendarStaffQuick && (
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <span className="whitespace-nowrap">{t("reception.quickStaff")}</span>
            <select
              value={calendarStaffQuick.value}
              onChange={(e) => calendarStaffQuick.onChange(e.target.value)}
              className="max-w-[11rem] rounded-md border border-zinc-700 bg-black px-2 py-1.5 text-xs text-white"
            >
              {calendarStaffQuick.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <LanguageSwitcher className="shrink-0" variant="compact" />

        <button
          type="button"
          onClick={() => setLoginOpen(true)}
          className="shrink-0 rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800"
        >
          {isReceptionMode ? t("reception.loginSwitch") : t("reception.switchUser")}
        </button>

        {!isReceptionMode && (
          <button
            type="button"
            onClick={() => logout()}
            className="shrink-0 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
          >
            {t("reception.logoutToReception")}
          </button>
        )}
      </header>

      <StaffLoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </>
  );
}
