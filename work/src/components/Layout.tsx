import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { useEffectiveRole } from "../context/EffectiveRoleContext";
import { normalizeRoles } from "../lib/roles";
import type { Role } from "../types/database";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { supabase } from "../lib/supabase";

type NavKey =
  | "dashboard"
  | "calendar"
  | "bookings"
  | "adminStaff"
  | "adminServices"
  | "adminSchedule"
  | "adminTimeOff"
  | "analytics"
  | "adminSupport";

type NavItem = {
  to: string;
  key: NavKey;
  end?: boolean;
  manageOnly?: boolean;
  badge?: "supportUnread";
};

let _chimeCtx: AudioContext | null = null;
function playChime(): void {
  if (typeof window === "undefined") return;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  if (!_chimeCtx) {
    try {
      _chimeCtx = new Ctx();
    } catch {
      return;
    }
  }
  const ctx = _chimeCtx;
  if (!ctx) return;
  const now = ctx.currentTime;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
  g.connect(ctx.destination);
  [880, 1320].forEach((freq, i) => {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(freq, now + i * 0.08);
    o.connect(g);
    o.start(now + i * 0.08);
    o.stop(now + 0.35 + i * 0.08);
  });
}

const navAll: NavItem[] = [
  { to: "/", key: "dashboard", end: true },
  { to: "/calendar", key: "calendar" },
  { to: "/bookings", key: "bookings" },
  { to: "/admin/staff", key: "adminStaff", manageOnly: true },
  { to: "/admin/services", key: "adminServices", manageOnly: true },
  { to: "/admin/schedule", key: "adminSchedule", manageOnly: true },
  { to: "/admin/time-off", key: "adminTimeOff", manageOnly: true },
  { to: "/admin/support", key: "adminSupport", manageOnly: true, badge: "supportUnread" },
  { to: "/analytics", key: "analytics", manageOnly: true },
];

export function Layout() {
  const { t, i18n } = useTranslation();
  const { staffMember, logout, isAdmin } = useAuth();
  const { canManage, previewRole, setPreviewRole, isWorkerOnlyEffective } = useEffectiveRole();

  const nav = navAll.filter((item) => {
    if (item.manageOnly && !canManage) return false;
    return true;
  });

  useEffect(() => {
    const base = (i18n.language || "ru").split("-")[0];
    if (base === "ru" || base === "et") document.documentElement.lang = base;
  }, [i18n.language]);

  const [supportUnread, setSupportUnread] = useState(0);
  const lastChimeAtRef = useRef(0);
  const lastCountRef = useRef(0);

  useEffect(() => {
    if (!staffMember || !canManage) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const { data, error } = await supabase.rpc("support_staff_unread_count", {
          p_staff_id: staffMember.id,
        });
        if (cancelled) return;
        if (error) return;
        const next = typeof data === "number" ? data : Number(data) || 0;
        if (next > lastCountRef.current && Date.now() - lastChimeAtRef.current > 3000) {
          try {
            playChime();
            lastChimeAtRef.current = Date.now();
          } catch {
            /* ignore */
          }
        }
        lastCountRef.current = next;
        setSupportUnread(next);
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = window.setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [staffMember, canManage]);

  const previewOptions: Role[] = ["admin", "manager", "worker"];

  return (
    <div className="flex min-h-screen bg-black">
      <aside className="flex w-56 flex-col border-r border-zinc-800 bg-zinc-950">
        <div className="border-b border-zinc-800 p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{t("brand")}</p>
            <LanguageSwitcher className="justify-end" />
          </div>
          <p className="mt-1 text-sm font-medium text-zinc-100">{staffMember?.name}</p>
          <p className="text-xs text-zinc-500">
            {staffMember?.roles?.length
              ? normalizeRoles(staffMember.roles)
                  .map((r) => t(`role.${r}`))
                  .join(" · ")
              : ""}
          </p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          {nav.map((item) => {
            const badgeCount =
              item.badge === "supportUnread" ? supportUnread : 0;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={Boolean(item.end)}
                className={({ isActive }) =>
                  `flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-zinc-800 text-white"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  }`
                }
              >
                <span className="truncate">{t(`nav.${item.key}`)}</span>
                {badgeCount > 0 && (
                  <span
                    aria-label={t("nav.unreadBadgeAria", { count: badgeCount })}
                    className="flex min-w-[1.25rem] items-center justify-center rounded-full bg-emerald-500 px-1.5 py-[1px] text-[10px] font-bold text-black"
                  >
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>
        <div className="border-t border-zinc-800 p-2">
          <button
            type="button"
            onClick={logout}
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
          >
            {t("nav.logout")}
          </button>
        </div>
        {isAdmin && (
          <div className="border-t border-zinc-800 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
              {t("preview.label")}
            </p>
            <select
              value={previewRole ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setPreviewRole(v === "" ? null : (v as Role));
              }}
              className="mt-1 w-full rounded border border-zinc-700 bg-black px-2 py-1.5 text-xs text-zinc-200"
            >
              <option value="">{t("preview.real")}</option>
              {previewOptions.map((r) => (
                <option key={r} value={r}>
                  {t(`role.${r}`)}
                </option>
              ))}
            </select>
          </div>
        )}
        {isWorkerOnlyEffective && (
          <p className="border-t border-zinc-800 p-3 text-xs text-zinc-600">{t("nav.workerHint")}</p>
        )}
      </aside>
      <main className="relative min-w-0 flex-1 overflow-auto p-6 lg:p-8">
        {previewRole && isAdmin && (
          <div className="mb-4 rounded-lg border border-amber-600/40 bg-amber-950/50 px-4 py-2 text-sm text-amber-100">
            {t("preview.banner", { role: t(`role.${previewRole}`) })}
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
