import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { useEffectiveRole } from "../context/EffectiveRoleContext";
import { normalizeRoles } from "../lib/roles";
import type { Role } from "../types/database";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { supabase } from "../lib/supabase";
import { CommandPalette } from "./CommandPalette";

/* ================================================================
 * Layout — два состояния sidebar:
 *   1) expanded (240px)    — лейблы + группы + бейджи + preview-select.
 *   2) collapsed (64px)    — только иконки + всплывающие title-tooltip.
 *
 * Хоткеи:
 *   ⌘K / Ctrl+K — открыть Command Palette.
 *   ⌘\ / Ctrl+\ — свернуть/развернуть sidebar.
 *
 * IA групп (по результатам исследования + текущего инвентаря страниц):
 *   • Hero (без заголовка):  Главная, Календарь, Записи
 *   • Каталог:               Услуги, Персонал
 *   • Расписание:            График, Выходные
 *   • Отчёты:                Аналитика
 *   • Поддержка:             Входящие (manage), Моя помощь
 *   • Настройки (внизу):     Интеграции
 * ================================================================ */

type NavKey =
  | "dashboard"
  | "calendar"
  | "bookings"
  | "adminStaff"
  | "adminServices"
  | "adminSchedule"
  | "adminTimeOff"
  | "analytics"
  | "adminSupport"
  | "adminIntegrations"
  | "myHelp";

type NavItem = {
  to: string;
  key: NavKey;
  end?: boolean;
  manageOnly?: boolean;
  badge?: "supportUnread" | "myHelpUnread";
  icon: () => JSX.Element;
};

type NavGroupKey = "catalog" | "schedule" | "reports" | "support" | "settings";

type NavGroup = {
  /** null для hero-секции (без заголовка). */
  key: NavGroupKey | null;
  items: NavItem[];
};

const COLLAPSED_KEY = "alessanna.crm.sidebar.collapsed.v1";

function NavIcon({ path }: { path: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px] shrink-0 opacity-80"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

const ICONS: Record<NavKey, () => JSX.Element> = {
  dashboard: () => <NavIcon path="M3 12 12 3l9 9M5 10v10h4v-6h6v6h4V10" />,
  calendar: () => <NavIcon path="M3 8h18M7 3v4m10-4v4M4 8h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />,
  bookings: () => <NavIcon path="M8 4h10a2 2 0 0 1 2 2v14l-4-3-4 3-4-3-4 3V6a2 2 0 0 1 2-2Z" />,
  adminStaff: () => <NavIcon path="M16 21v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-1a4 4 0 0 0-3-3.87M17 3.13a4 4 0 0 1 0 7.74" />,
  adminServices: () => <NavIcon path="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z M3.3 7 12 12m0 0 8.7-5M12 12v10" />,
  adminSchedule: () => <NavIcon path="M12 8v5l3 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" />,
  adminTimeOff: () => <NavIcon path="M5 7h14M5 12h14M5 17h14M8 4v3M16 4v3" />,
  analytics: () => <NavIcon path="M3 3v18h18M7 15l4-4 4 4 5-6" />,
  adminSupport: () => <NavIcon path="M21 12a8 8 0 1 0-16 0v3a2 2 0 0 0 2 2h1v-5H5a6 6 0 1 1 12 0h-3v5h1a2 2 0 0 0 2-2Zm-4 7a2 2 0 0 1-2 2h-2v-2h4Z" />,
  adminIntegrations: () => <NavIcon path="M10 13a5 5 0 0 0 7.07 0l3.54-3.54a5 5 0 0 0-7.07-7.07L11.83 4.1M14 11a5 5 0 0 0-7.07 0l-3.54 3.54a5 5 0 0 0 7.07 7.07L12.17 19.9" />,
  myHelp: () => <NavIcon path="M12 17v.01M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
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

const NAV_GROUPS: NavGroup[] = [
  {
    key: null,
    items: [
      { to: "/", key: "dashboard", end: true, icon: ICONS.dashboard },
      { to: "/calendar", key: "calendar", icon: ICONS.calendar },
      { to: "/bookings", key: "bookings", icon: ICONS.bookings },
    ],
  },
  {
    key: "catalog",
    items: [
      { to: "/admin/services", key: "adminServices", manageOnly: true, icon: ICONS.adminServices },
      { to: "/admin/staff", key: "adminStaff", manageOnly: true, icon: ICONS.adminStaff },
    ],
  },
  {
    key: "schedule",
    items: [
      { to: "/admin/schedule", key: "adminSchedule", manageOnly: true, icon: ICONS.adminSchedule },
      { to: "/admin/time-off", key: "adminTimeOff", manageOnly: true, icon: ICONS.adminTimeOff },
    ],
  },
  {
    key: "reports",
    items: [
      { to: "/analytics", key: "analytics", manageOnly: true, icon: ICONS.analytics },
    ],
  },
  {
    key: "support",
    items: [
      { to: "/admin/support", key: "adminSupport", manageOnly: true, badge: "supportUnread", icon: ICONS.adminSupport },
      { to: "/help", key: "myHelp", badge: "myHelpUnread", icon: ICONS.myHelp },
    ],
  },
  {
    key: "settings",
    items: [
      { to: "/admin/integrations", key: "adminIntegrations", manageOnly: true, icon: ICONS.adminIntegrations },
    ],
  },
];

function publicSiteUrl(): string {
  const fromEnv = (import.meta as unknown as { env?: { VITE_PUBLIC_SITE_URL?: string } }).env?.VITE_PUBLIC_SITE_URL;
  return ((fromEnv || "https://alessannailu.com").replace(/\/+$/, "")) + "/?admin=1";
}

export function Layout() {
  const { t, i18n } = useTranslation();
  const { staffMember, logout, isAdmin } = useAuth();
  const { canManage, previewRole, setPreviewRole, isWorkerOnlyEffective } = useEffectiveRole();

  /* ── sidebar state ─────────────────────────────────────────── */
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  /* ⌘\ / Ctrl+\ — toggle collapse */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ── command palette ───────────────────────────────────────── */
  const [paletteOpen, setPaletteOpen] = useState(false);

  /* ── language → html lang ──────────────────────────────────── */
  useEffect(() => {
    const base = (i18n.language || "ru").split("-")[0];
    if (base === "ru" || base === "et") document.documentElement.lang = base;
  }, [i18n.language]);

  /* ── unread badges ─────────────────────────────────────────── */
  const [supportUnread, setSupportUnread] = useState(0);
  const [myHelpUnread, setMyHelpUnread] = useState(0);
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
        if (cancelled || error) return;
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

  useEffect(() => {
    if (!staffMember) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const { data, error } = await supabase.rpc("support_staff_self_unread_count", {
          p_staff_id: staffMember.id,
        });
        if (cancelled || error) return;
        setMyHelpUnread(typeof data === "number" ? data : Number(data) || 0);
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = window.setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [staffMember]);

  /* ── derive ────────────────────────────────────────────────── */
  const previewOptions: Role[] = ["admin", "manager", "worker"];
  const staffInitial = (staffMember?.name || "?").trim().slice(0, 1).toUpperCase();
  const normalizedRoles = staffMember?.roles?.length ? normalizeRoles(staffMember.roles) : [];
  const primaryRoleLabel = normalizedRoles[0] ? t(`role.${normalizedRoles[0]}`) : "";

  const visibleGroups: NavGroup[] = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.manageOnly || canManage),
  })).filter((g) => g.items.length > 0);

  const sidebarWidth = collapsed ? "w-[68px]" : "w-60";

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-zinc-950 via-black to-zinc-950 text-zinc-200">
      <aside
        className={`sticky top-0 flex h-screen flex-col border-r border-zinc-800/80 bg-zinc-950/95 backdrop-blur-sm transition-[width] duration-200 ease-out ${sidebarWidth}`}
        aria-label="CRM navigation"
      >
        {/* ───── Brand / collapse toggle ───── */}
        <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 p-3">
          {!collapsed ? (
            <>
              <p className="bg-gradient-to-r from-emerald-300 via-sky-300 to-fuchsia-300 bg-clip-text text-sm font-semibold uppercase tracking-[0.22em] text-transparent">
                {t("brand")}
              </p>
              <LanguageSwitcher className="justify-end" />
            </>
          ) : (
            <span
              aria-hidden="true"
              title={t("brand")}
              className="mx-auto inline-flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-emerald-300 via-sky-300 to-fuchsia-300 text-xs font-bold text-black"
            >
              A
            </span>
          )}
        </div>

        {/* ───── User card ───── */}
        {!collapsed ? (
          <div className="border-b border-zinc-800/80 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500/80 to-sky-500/80 text-sm font-semibold text-black shadow-inner shadow-black/30"
              >
                {staffInitial}
              </span>
              <div className="min-w-0 leading-tight">
                <p className="truncate text-sm font-semibold text-zinc-100">{staffMember?.name}</p>
                {primaryRoleLabel && (
                  <p className="mt-0.5 truncate text-[11px] uppercase tracking-wide text-zinc-500">
                    {normalizedRoles.map((r) => t(`role.${r}`)).join(" · ")}
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex justify-center border-b border-zinc-800/80 py-3" title={staffMember?.name ?? ""}>
            <span
              aria-hidden="true"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500/80 to-sky-500/80 text-sm font-semibold text-black"
            >
              {staffInitial}
            </span>
          </div>
        )}

        {/* ───── Search trigger ───── */}
        <div className="border-b border-zinc-800/80 p-2">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            title={t("command.placeholder") + "  (⌘K)"}
            className={`group flex w-full items-center gap-2 rounded-lg border border-zinc-800 bg-black/40 py-1.5 text-sm text-zinc-400 transition hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100 ${
              collapsed ? "justify-center px-2" : "px-2.5"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4 shrink-0"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1 truncate text-left">{t("command.placeholder")}</span>
                <kbd className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10.5px] font-semibold text-zinc-300 transition group-hover:border-emerald-400/50 group-hover:text-emerald-200">
                  ⌘K
                </kbd>
              </>
            )}
          </button>
        </div>

        {/* ───── Main nav ───── */}
        <nav className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
          {visibleGroups.map((group, gi) => {
            const heading = group.key ? t(`nav.group.${group.key}`) : null;
            return (
              <div key={group.key ?? `g${gi}`} className="space-y-0.5">
                {!collapsed && heading && (
                  <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                    {heading}
                  </p>
                )}
                {collapsed && gi > 0 && (
                  <div className="mx-3 my-1 h-px bg-zinc-800/60" aria-hidden="true" />
                )}
                {group.items.map((item) => {
                  const badgeCount =
                    item.badge === "supportUnread"
                      ? supportUnread
                      : item.badge === "myHelpUnread"
                        ? myHelpUnread
                        : 0;
                  const label = t(`nav.${item.key}`);
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={Boolean(item.end)}
                      title={collapsed ? label : undefined}
                      className={({ isActive }) =>
                        `group relative flex items-center gap-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                          collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2"
                        } ${
                          isActive
                            ? "bg-zinc-800/90 text-white shadow-inner shadow-black/30"
                            : "text-zinc-400 hover:bg-zinc-900/70 hover:text-zinc-100"
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {!collapsed && (
                            <span
                              aria-hidden="true"
                              className={`absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full transition-all ${
                                isActive
                                  ? "bg-gradient-to-b from-emerald-400 to-sky-400"
                                  : "bg-transparent group-hover:bg-zinc-700"
                              }`}
                            />
                          )}
                          <span
                            className={`shrink-0 ${
                              isActive ? "text-emerald-300" : "text-zinc-500 group-hover:text-zinc-300"
                            }`}
                          >
                            {item.icon()}
                          </span>
                          {!collapsed && (
                            <span className="min-w-0 flex-1 truncate">{label}</span>
                          )}
                          {badgeCount > 0 && (
                            <span
                              aria-label={t("nav.unreadBadgeAria", { count: badgeCount })}
                              className={`flex items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-black shadow-sm shadow-emerald-500/30 ${
                                collapsed
                                  ? "absolute right-1 top-1 h-2 w-2 p-0"
                                  : "min-w-[1.25rem] px-1.5 py-[1px]"
                              }`}
                            >
                              {!collapsed && (badgeCount > 99 ? "99+" : badgeCount)}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* ───── Preview role select ───── */}
        {isAdmin && !collapsed && (
          <div className="border-t border-zinc-800/80 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
              {t("preview.label")}
            </p>
            <select
              value={previewRole ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setPreviewRole(v === "" ? null : (v as Role));
              }}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-black/60 px-2 py-1.5 text-xs text-zinc-200 transition focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
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
        {isWorkerOnlyEffective && !collapsed && (
          <p className="border-t border-zinc-800/80 px-4 py-3 text-[11px] leading-snug text-zinc-600">
            {t("nav.workerHint")}
          </p>
        )}

        {/* ───── Open public site as admin ───── */}
        {canManage && (
          <div className="border-t border-zinc-800/80 p-2">
            <a
              href={publicSiteUrl()}
              target="_blank"
              rel="noopener noreferrer"
              title={t("nav.publicSiteTitle")}
              className={`flex items-center gap-2 rounded-lg py-2 text-sm text-zinc-400 transition-colors hover:bg-amber-950/30 hover:text-amber-200 ${
                collapsed ? "justify-center px-2" : "w-full px-3 text-left"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4 shrink-0"
                aria-hidden="true"
              >
                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1 truncate">{t("nav.publicSite")}</span>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.75}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3 w-3 shrink-0 opacity-60"
                    aria-hidden="true"
                  >
                    <path d="M7 17 17 7M7 7h10v10" />
                  </svg>
                </>
              )}
            </a>
          </div>
        )}

        {/* ───── Footer: collapse toggle + logout ───── */}
        <div className="flex items-center justify-between gap-1 border-t border-zinc-800/80 p-2">
          <button
            type="button"
            onClick={logout}
            title={t("nav.logout") + (collapsed ? "" : "")}
            className={`flex items-center gap-2 rounded-lg py-2 text-sm text-zinc-500 transition-colors hover:bg-red-950/30 hover:text-red-300 ${
              collapsed ? "w-full justify-center px-2" : "flex-1 px-3 text-left"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4 shrink-0"
              aria-hidden="true"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
            {!collapsed && <span>{t("nav.logout")}</span>}
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            title={(collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")) + "  (⌘\\)"}
            aria-label={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
            className={`inline-flex h-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/70 text-zinc-500 transition hover:border-zinc-700 hover:text-zinc-200 ${
              collapsed ? "mt-2 w-full" : "w-8"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`}
              aria-hidden="true"
            >
              <path d="m15 6-6 6 6 6" />
            </svg>
          </button>
        </div>
      </aside>

      <main className="relative min-w-0 flex-1 overflow-auto">
        {/* sticky-баннер предпросмотра: при скролле страницы остаётся
         * видимым, чтобы админ не забыл, что находится в режиме
         * другой роли. Растягиваем во всю ширину main за счёт -mx-... */}
        {previewRole && isAdmin && (
          <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-amber-600/40 bg-amber-950/95 px-6 py-2 text-sm text-amber-100 shadow-md shadow-amber-500/10 backdrop-blur-sm lg:px-8">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4 shrink-0"
              aria-hidden="true"
            >
              <path d="M2.5 17.5 12 3l9.5 14.5H2.5ZM12 10v4M12 17h.01" />
            </svg>
            <span className="flex-1">
              {t("preview.banner", { role: t(`role.${previewRole}`) })}
            </span>
            <button
              type="button"
              onClick={() => setPreviewRole(null)}
              className="rounded-md border border-amber-500/30 px-2 py-0.5 text-xs font-medium text-amber-100 transition hover:border-amber-300 hover:bg-amber-900/40 hover:text-white"
            >
              {t("preview.exit")}
            </button>
          </div>
        )}
        <div className="p-6 lg:p-8">
          <Outlet />
        </div>
      </main>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        publicSiteUrl={publicSiteUrl()}
      />
    </div>
  );
}
