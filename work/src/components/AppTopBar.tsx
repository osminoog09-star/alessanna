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
  receptionNavCompact?: boolean;
  onToggleReceptionNav?: () => void;
  showReceptionNavToggle?: boolean;
};

/** Top bar: session role, login/switch, logout to reception, optional staff quick-pick. */
export function AppTopBar({
  calendarStaffQuick,
  receptionNavCompact = false,
  onToggleReceptionNav,
  showReceptionNavToggle = false,
}: Props) {
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
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-3 border-b border-line/15 bg-panel/95 px-4 py-2 backdrop-blur-sm">
        <div className="min-w-0 flex-1 basis-[140px]">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted">
            {t("reception.sessionRole")}
          </p>
          <p className="truncate text-sm font-medium text-fg">{roleLabel}</p>
        </div>

        {showStaffQuick && calendarStaffQuick && (
          <label className="flex items-center gap-2 text-xs text-muted">
            <span className="whitespace-nowrap">{t("reception.quickStaff")}</span>
            <select
              value={calendarStaffQuick.value}
              onChange={(e) => calendarStaffQuick.onChange(e.target.value)}
              className="max-w-[11rem] rounded-md border border-line/20 bg-black px-2 py-1.5 text-xs text-fg"
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

        {showReceptionNavToggle && onToggleReceptionNav && (
          <button
            type="button"
            onClick={onToggleReceptionNav}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium ${
              receptionNavCompact
                ? "border-amber-600/60 bg-amber-950/50 text-amber-100"
                : "border-line/20 text-muted hover:bg-surface"
            }`}
          >
            {receptionNavCompact ? t("reception.switchToCrmMode") : t("reception.switchToReceptionMode")}
          </button>
        )}

        <button
          type="button"
          onClick={() => setLoginOpen(true)}
          className="shrink-0 rounded-lg border border-line/25 bg-surface px-3 py-1.5 text-xs font-medium text-fg hover:border-line/30 hover:bg-surface"
        >
          {isReceptionMode ? t("reception.loginSwitch") : t("reception.switchUser")}
        </button>

        {!isReceptionMode && (
          <button
            type="button"
            onClick={() => logout()}
            className="shrink-0 rounded-lg border border-line/15 px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface hover:text-fg"
          >
            {t("reception.logoutToReception")}
          </button>
        )}
      </header>

      <StaffLoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </>
  );
}
