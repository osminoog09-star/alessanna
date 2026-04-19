import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { useEffectiveRole } from "../context/EffectiveRoleContext";
import { useTheme, THEMES, type ThemeId } from "../context/ThemeContext";
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
  | "adminInventory"
  | "adminCommunications"
  | "adminInvites"
  | "profileSecurity"
  | "myHelp";

type NavItem = {
  to: string;
  key: NavKey;
  end?: boolean;
  /** Виден admin + manager. */
  manageOnly?: boolean;
  /** Виден ТОЛЬКО admin. Менеджер не должен лазить в технические интеграции. */
  adminOnly?: boolean;
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
/* «Какие группы свёрнуты» — отдельный ключ. Группа автоматически
 * раскрывается, если в ней есть активная страница, поэтому хранить
 * нужно только явные действия пользователя. */
const GROUPS_COLLAPSED_KEY = "alessanna.crm.sidebar.groups.collapsed.v1";

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
  profileSecurity: () => <NavIcon path="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />,
  adminInventory: () => <NavIcon path="M3 7l9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4" />,
  adminCommunications: () => <NavIcon path="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z M2 6l10 7 10-7" />,
  adminInvites: () => <NavIcon path="M16 11V7a4 4 0 0 0-8 0v4M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z" />,
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
      { to: "/admin/invites", key: "adminInvites", adminOnly: true, icon: ICONS.adminInvites },
      { to: "/admin/inventory", key: "adminInventory", manageOnly: true, icon: ICONS.adminInventory },
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
      { to: "/admin/communications", key: "adminCommunications", manageOnly: true, icon: ICONS.adminCommunications },
      { to: "/help", key: "myHelp", badge: "myHelpUnread", icon: ICONS.myHelp },
    ],
  },
  {
    key: "settings",
    items: [
      { to: "/profile/security", key: "profileSecurity", icon: ICONS.profileSecurity },
      { to: "/admin/integrations", key: "adminIntegrations", adminOnly: true, icon: ICONS.adminIntegrations },
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
  const { canManage, isAdminEffective, previewRole, setPreviewRole, isWorkerOnlyEffective } = useEffectiveRole();

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
    items: g.items.filter((i) => {
      if (i.adminOnly && !isAdminEffective) return false;
      if (i.manageOnly && !canManage) return false;
      return true;
    }),
  })).filter((g) => g.items.length > 0);

  const sidebarWidth = collapsed ? "w-[68px]" : "w-60";

  /* ── theme + group-collapse state ──────────────────────────── */
  const { theme, setTheme } = useTheme();
  const location = useLocation();

  /* «Группа явно свёрнута пользователем». Группа без явной записи
   * считается раскрытой только если в ней есть активная страница —
   * иначе свёрнута по умолчанию (это то, что просил пользователь:
   * «не всё нараспашку»). Hero-группа (key=null) всегда видна. */
  const [groupsCollapsed, setGroupsCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const raw = window.localStorage.getItem(GROUPS_COLLAPSED_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, boolean>;
      }
    } catch {
      /* ignore */
    }
    return {};
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(GROUPS_COLLAPSED_KEY, JSON.stringify(groupsCollapsed));
    } catch {
      /* ignore */
    }
  }, [groupsCollapsed]);

  /* Группы с активной страницей: всегда раскрыты (даже если когда-то
   * пользователь их свернул — текущая страница важнее). */
  const activeGroupKeys = useMemo<Set<NavGroupKey>>(() => {
    const set = new Set<NavGroupKey>();
    for (const g of visibleGroups) {
      if (!g.key) continue;
      const matched = g.items.some((it) =>
        it.end ? location.pathname === it.to : location.pathname.startsWith(it.to),
      );
      if (matched) set.add(g.key);
    }
    return set;
  }, [visibleGroups, location.pathname]);

  /* Группа открыта если:
   *   • это hero-группа (key=null) — всегда видна;
   *   • в ней есть активная страница — открываем принудительно;
   *   • пользователь явно её раскрыл (groupsCollapsed[key] === false).
   * По дефолту все остальные группы свёрнуты — это лекарство от
   * «всё нараспашку, глаза разбегаются». */
  function isGroupOpenV2(g: NavGroup): boolean {
    if (g.key === null) return true;
    if (activeGroupKeys.has(g.key)) return true;
    return groupsCollapsed[g.key] === false;
  }

  function toggleGroup(key: NavGroupKey) {
    setGroupsCollapsed((prev) => {
      const wasOpen = activeGroupKeys.has(key) || prev[key] === false;
      const nextOpen = !wasOpen;
      return { ...prev, [key]: nextOpen ? false : true };
    });
  }

  return (
    <div className="flex min-h-screen bg-canvas text-fg">
      <aside
        className={`sticky top-0 flex h-screen flex-col border-r border-line/10 bg-panel transition-[width] duration-200 ease-out ${sidebarWidth}`}
        aria-label="CRM navigation"
      >
        {/* ───── Brand / language ───── */}
        <div className="flex items-center justify-between gap-2 border-b border-line/10 px-3 py-3.5">
          {!collapsed ? (
            <>
              <p className="font-display text-lg italic tracking-[0.18em] text-gold">
                {t("brand")}
              </p>
              <LanguageSwitcher className="justify-end" />
            </>
          ) : (
            <span
              aria-hidden="true"
              title={t("brand")}
              className="mx-auto inline-flex h-8 w-8 items-center justify-center rounded-md border border-gold/40 bg-canvas font-display text-sm italic text-gold"
            >
              A
            </span>
          )}
        </div>

        {/* ───── User card ───── */}
        {!collapsed ? (
          <div className="border-b border-line/10 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-surface text-sm font-semibold text-gold"
              >
                {staffInitial}
              </span>
              <div className="min-w-0 leading-tight">
                <p className="truncate text-sm font-semibold text-fg">{staffMember?.name}</p>
                {primaryRoleLabel && (
                  <p className="mt-0.5 truncate text-[11px] uppercase tracking-wide text-muted">
                    {normalizedRoles.map((r) => t(`role.${r}`)).join(" · ")}
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex justify-center border-b border-line/10 py-3" title={staffMember?.name ?? ""}>
            <span
              aria-hidden="true"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gold/40 bg-surface text-sm font-semibold text-gold"
            >
              {staffInitial}
            </span>
          </div>
        )}

        {/* ───── Search trigger ───── */}
        <div className="border-b border-line/10 p-2">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            title={t("command.placeholder") + "  (⌘K)"}
            className={`group flex w-full items-center gap-2 rounded-lg border border-line/10 bg-canvas/60 py-1.5 text-sm text-muted transition hover:border-gold/40 hover:bg-surface hover:text-fg ${
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
                <kbd className="rounded border border-line/15 bg-surface px-1.5 py-0.5 text-[10.5px] font-semibold text-muted transition group-hover:border-gold/50 group-hover:text-gold">
                  ⌘K
                </kbd>
              </>
            )}
          </button>
        </div>

        {/* ───── Main nav ───── */}
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
          {visibleGroups.map((group, gi) => {
            const heading = group.key ? t(`nav.group.${group.key}`) : null;
            const open = isGroupOpenV2(group);
            const showItems = collapsed || open;
            return (
              <div key={group.key ?? `g${gi}`} className="space-y-0.5">
                {!collapsed && heading && group.key && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key as NavGroupKey)}
                    aria-expanded={open}
                    className="group flex w-full items-center gap-2 rounded-md px-3 pb-1 pt-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted transition hover:text-gold"
                  >
                    <span className="flex-1 truncate">{heading}</span>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`h-3 w-3 shrink-0 transition-transform ${
                        open ? "rotate-90" : ""
                      }`}
                      aria-hidden="true"
                    >
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </button>
                )}
                {collapsed && gi > 0 && (
                  <div className="mx-3 my-1 h-px bg-line/10" aria-hidden="true" />
                )}
                {showItems && group.items.map((item) => {
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
                            ? "bg-surface text-fg shadow-inner shadow-black/20"
                            : "text-muted hover:bg-surface/60 hover:text-fg"
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
                                  ? "bg-gold"
                                  : "bg-transparent group-hover:bg-gold/40"
                              }`}
                            />
                          )}
                          <span
                            className={`shrink-0 ${
                              isActive ? "text-gold" : "text-muted group-hover:text-fg"
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
                              className={`flex items-center justify-center rounded-full bg-gold text-[10px] font-bold text-canvas shadow-gold ${
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

        {/* ───── Theme switcher ───── */}
        {!collapsed && (
          <div className="border-t border-line/10 px-3 py-2.5">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              {t("nav.themeLabel", { defaultValue: "Тема" })}
            </p>
            <div className="grid grid-cols-3 gap-1">
              {THEMES.map((opt) => {
                const active = theme === opt.id;
                const sw = themeSwatch(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setTheme(opt.id)}
                    aria-pressed={active}
                    title={t(`nav.${opt.labelKey}`, { defaultValue: opt.id })}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-1.5 py-1.5 text-[10px] font-medium uppercase tracking-wide transition ${
                      active
                        ? "border-gold/60 bg-surface text-gold shadow-gold"
                        : "border-line/10 bg-canvas/40 text-muted hover:border-gold/30 hover:text-fg"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-3 w-7 overflow-hidden rounded-full border border-line/10"
                    >
                      <span style={{ background: sw[0] }} className="flex-1" />
                      <span style={{ background: sw[1] }} className="flex-1" />
                      <span style={{ background: sw[2] }} className="flex-1" />
                    </span>
                    <span className="truncate">
                      {t(`nav.${opt.labelKey}`, { defaultValue: opt.id })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {collapsed && (
          <div className="flex justify-center border-t border-line/10 py-2">
            <button
              type="button"
              onClick={() => {
                const idx = THEMES.findIndex((x) => x.id === theme);
                setTheme(THEMES[(idx + 1) % THEMES.length].id);
              }}
              aria-label={t("nav.themeLabel", { defaultValue: "Тема" })}
              title={t(`nav.theme.${theme}`, { defaultValue: theme })}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line/10 bg-canvas/40 text-gold transition hover:border-gold/40"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
              </svg>
            </button>
          </div>
        )}

        {/* ───── Preview role select ───── */}
        {isAdmin && !collapsed && (
          <div className="border-t border-line/10 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              {t("preview.label")}
            </p>
            <select
              value={previewRole ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setPreviewRole(v === "" ? null : (v as Role));
              }}
              className="mt-1 w-full rounded-md border border-line/15 bg-canvas/60 px-2 py-1.5 text-xs text-fg transition focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40"
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
          <p className="border-t border-line/10 px-4 py-3 text-[11px] leading-snug text-muted">
            {t("nav.workerHint")}
          </p>
        )}

        {/* ───── Open public site as admin ───── */}
        {canManage && (
          <div className="border-t border-line/10 p-2">
            <a
              href={publicSiteUrl()}
              target="_blank"
              rel="noopener noreferrer"
              title={t("nav.publicSiteTitle")}
              className={`flex items-center gap-2 rounded-lg py-2 text-sm text-muted transition-colors hover:bg-surface hover:text-gold ${
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
        <div className="flex items-center justify-between gap-1 border-t border-line/10 p-2">
          <button
            type="button"
            onClick={logout}
            title={t("nav.logout")}
            className={`flex items-center gap-2 rounded-lg py-2 text-sm text-muted transition-colors hover:bg-surface hover:text-red-300 ${
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
            className={`inline-flex h-8 items-center justify-center rounded-lg border border-line/10 bg-canvas/40 text-muted transition hover:border-gold/40 hover:text-gold ${
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

      <main className="relative min-w-0 flex-1 overflow-auto bg-canvas">
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

/* Хардкод-семплы цветов для маленьких swatch-индикаторов в переключателе тем.
 * Не тянем из CSS-переменных, потому что у активной темы все три значения
 * совпадают с реальной темой страницы — а нам нужно показать «как выглядит
 * каждая из трёх», вне зависимости от текущей. */
function themeSwatch(id: ThemeId): [string, string, string] {
  switch (id) {
    case "champagne":
      return ["#fbfaf6", "#f4f1eb", "#a3855e"];
    case "stone":
      return ["#25221e", "#38332d", "#d4b896"];
    case "onyx":
    default:
      return ["#0a0a0a", "#1a1a1a", "#c4a574"];
  }
}
