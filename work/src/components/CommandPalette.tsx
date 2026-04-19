import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Command } from "cmdk";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEffectiveRole } from "../context/EffectiveRoleContext";
import { useAuth } from "../context/AuthContext";

/* ============================================================
 * CommandPalette — ⌘K / Ctrl+K глобальный поиск-и-навигация.
 *
 * Архитектура: один <Command.Dialog> на всё приложение, который
 * хранит open в React state Layout'а и слушает клавиатуру через
 * window keydown.
 *
 * Содержимое:
 *  - Quick actions (статичные команды, которые быстрее набрать,
 *    чем найти в меню).
 *  - Navigate to … (все доступные текущему пользователю страницы;
 *    отфильтровано по роли).
 *  - Recent (последние 5 уникальных навигаций — хранится в LS).
 *
 * НЕ делаем поиск по клиентам/услугам пока — нужно отдельные
 * RPC + дебаунс. Заведём в этап 2 (после первого UX-feedback'а),
 * чтобы не раздувать сразу.
 * ============================================================ */

type CommandItem = {
  id: string;
  label: string;
  hint?: string;
  shortcut?: string[];
  /** В каком контексте элемент доступен; null = всегда. */
  manageOnly?: boolean;
  group: "quick" | "go" | "recent";
  icon?: ReactNode;
  perform: (ctx: PaletteCtx) => void;
};

type PaletteCtx = {
  navigate: (to: string) => void;
  setPreviewRole: (r: null) => void;
  close: () => void;
  publicSiteUrl: string;
};

const RECENT_KEY = "alessanna.crm.cmdk.recent.v1";
const RECENT_MAX = 5;

function loadRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed.filter((x) => typeof x === "string") as string[]) : [];
  } catch {
    return [];
  }
}
function pushRecent(id: string) {
  try {
    const cur = loadRecent().filter((x) => x !== id);
    cur.unshift(id);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, RECENT_MAX)));
  } catch {
    /* ignore */
  }
}

/* Простые иконки — переиспользуем стиль из Layout (16x16 stroke). */
function IconStroke({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0 opacity-80"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

const ICON = {
  dashboard: <IconStroke d="M3 12 12 3l9 9M5 10v10h4v-6h6v6h4V10" />,
  calendar: <IconStroke d="M3 8h18M7 3v4m10-4v4M4 8h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />,
  bookings: <IconStroke d="M8 4h10a2 2 0 0 1 2 2v14l-4-3-4 3-4-3-4 3V6a2 2 0 0 1 2-2Z" />,
  staff: <IconStroke d="M16 21v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-1a4 4 0 0 0-3-3.87M17 3.13a4 4 0 0 1 0 7.74" />,
  services: <IconStroke d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />,
  schedule: <IconStroke d="M12 8v5l3 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" />,
  timeOff: <IconStroke d="M5 7h14M5 12h14M5 17h14M8 4v3M16 4v3" />,
  analytics: <IconStroke d="M3 3v18h18M7 15l4-4 4 4 5-6" />,
  support: <IconStroke d="M21 12a8 8 0 1 0-16 0v3a2 2 0 0 0 2 2h1v-5H5a6 6 0 1 1 12 0h-3v5h1a2 2 0 0 0 2-2Z" />,
  integrations: <IconStroke d="M10 13a5 5 0 0 0 7.07 0l3.54-3.54a5 5 0 0 0-7.07-7.07L11.83 4.1M14 11a5 5 0 0 0-7.07 0l-3.54 3.54a5 5 0 0 0 7.07 7.07L12.17 19.9" />,
  help: <IconStroke d="M12 17v.01M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  bolt: <IconStroke d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />,
  external: <IconStroke d="M14 5h5v5M19 5l-9 9M5 11v8h8" />,
  history: <IconStroke d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />,
};

export function CommandPalette({
  open,
  onOpenChange,
  publicSiteUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  publicSiteUrl: string;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { canManage, setPreviewRole, previewRole } = useEffectiveRole();
  const { isAdmin } = useAuth();

  const [recent, setRecent] = useState<string[]>(() => loadRecent());

  /* ⌘K / Ctrl+K — глобальное открытие. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  /* Перечисляем ВСЕ возможные действия. Видимость отдельно
   * фильтруется ниже по canManage / isAdmin. */
  const allItems: CommandItem[] = useMemo(
    () => [
      // ---- Quick Actions ----
      {
        id: "qa.newBooking",
        label: t("command.newBooking"),
        hint: t("command.newBookingHint"),
        group: "quick",
        icon: ICON.bolt,
        perform: ({ navigate, close }) => {
          navigate("/calendar");
          close();
        },
      },
      {
        id: "qa.openCalendarToday",
        label: t("command.calendarToday"),
        group: "quick",
        icon: ICON.calendar,
        perform: ({ navigate, close }) => {
          navigate("/calendar");
          close();
        },
      },
      {
        id: "qa.openPublicSite",
        label: t("command.openPublicSite"),
        hint: t("command.openPublicSiteHint"),
        group: "quick",
        manageOnly: true,
        icon: ICON.external,
        perform: ({ publicSiteUrl, close }) => {
          window.open(publicSiteUrl, "_blank", "noopener,noreferrer");
          close();
        },
      },
      ...(isAdmin && previewRole !== null
        ? [
            {
              id: "qa.resetPreview",
              label: t("command.resetPreview"),
              group: "quick" as const,
              icon: ICON.history,
              perform: ({ setPreviewRole, close }: PaletteCtx) => {
                setPreviewRole(null);
                close();
              },
            },
          ]
        : []),

      // ---- Navigate ----
      {
        id: "go./",
        label: t("nav.dashboard"),
        group: "go",
        icon: ICON.dashboard,
        perform: ({ navigate, close }) => {
          navigate("/");
          close();
        },
      },
      {
        id: "go./calendar",
        label: t("nav.calendar"),
        group: "go",
        icon: ICON.calendar,
        perform: ({ navigate, close }) => {
          navigate("/calendar");
          close();
        },
      },
      {
        id: "go./bookings",
        label: t("nav.bookings"),
        group: "go",
        icon: ICON.bookings,
        perform: ({ navigate, close }) => {
          navigate("/bookings");
          close();
        },
      },
      {
        id: "go./admin/services",
        label: t("nav.adminServices"),
        group: "go",
        manageOnly: true,
        icon: ICON.services,
        perform: ({ navigate, close }) => {
          navigate("/admin/services");
          close();
        },
      },
      {
        id: "go./admin/staff",
        label: t("nav.adminStaff"),
        group: "go",
        manageOnly: true,
        icon: ICON.staff,
        perform: ({ navigate, close }) => {
          navigate("/admin/staff");
          close();
        },
      },
      {
        id: "go./admin/schedule",
        label: t("nav.adminSchedule"),
        group: "go",
        manageOnly: true,
        icon: ICON.schedule,
        perform: ({ navigate, close }) => {
          navigate("/admin/schedule");
          close();
        },
      },
      {
        id: "go./admin/time-off",
        label: t("nav.adminTimeOff"),
        group: "go",
        manageOnly: true,
        icon: ICON.timeOff,
        perform: ({ navigate, close }) => {
          navigate("/admin/time-off");
          close();
        },
      },
      {
        id: "go./analytics",
        label: t("nav.analytics"),
        group: "go",
        manageOnly: true,
        icon: ICON.analytics,
        perform: ({ navigate, close }) => {
          navigate("/analytics");
          close();
        },
      },
      {
        id: "go./admin/support",
        label: t("nav.adminSupport"),
        group: "go",
        manageOnly: true,
        icon: ICON.support,
        perform: ({ navigate, close }) => {
          navigate("/admin/support");
          close();
        },
      },
      {
        id: "go./admin/integrations",
        label: t("nav.adminIntegrations"),
        group: "go",
        manageOnly: true,
        icon: ICON.integrations,
        perform: ({ navigate, close }) => {
          navigate("/admin/integrations");
          close();
        },
      },
      {
        id: "go./help",
        label: t("nav.myHelp"),
        group: "go",
        icon: ICON.help,
        perform: ({ navigate, close }) => {
          navigate("/help");
          close();
        },
      },
    ],
    [t, isAdmin, previewRole]
  );

  const visibleItems = useMemo(
    () => allItems.filter((i) => !i.manageOnly || canManage),
    [allItems, canManage]
  );

  const ctx: PaletteCtx = useMemo(
    () => ({
      navigate,
      setPreviewRole,
      close: () => onOpenChange(false),
      publicSiteUrl,
    }),
    [navigate, setPreviewRole, onOpenChange, publicSiteUrl]
  );

  const recentItems = useMemo(() => {
    if (!recent.length) return [];
    const map = new Map(visibleItems.map((i) => [i.id, i] as const));
    return recent.map((id) => map.get(id)).filter((x): x is CommandItem => Boolean(x));
  }, [recent, visibleItems]);

  function runItem(item: CommandItem) {
    /* В «Недавнее» пишем только переходы (go-команды). Quick actions
     * быстрее набрать руками — дублировать их в recent — лишний шум
     * (и из-за того, что некоторые quick actions по факту ведут в
     * те же роуты, recent заполнялся одинаковыми пунктами). */
    if (item.group === "go") {
      pushRecent(item.id);
      setRecent(loadRecent());
    }
    item.perform(ctx);
  }

  /* NB: cmdk пробрасывает только `label` в Radix Dialog как aria-label.
   *     Современные Radix DialogContent предупреждают о требовании
   *     <Dialog.Title>/Description, но cmdk не даёт вставить их как
   *     siblings — children идут ВНУТРЬ Command, а не Dialog.Content.
   *     Принимаем dev-only warning; пользователь его не видит, screen
   *     reader всё равно читает aria-label. */
  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={t("command.placeholder")}
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 p-4 pt-[10vh] backdrop-blur-sm"
      filter={(value, search) => {
        if (!search) return 1;
        return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
      }}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            className="h-4 w-4 shrink-0 text-zinc-500"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" strokeLinecap="round" />
          </svg>
          <Command.Input
            autoFocus
            placeholder={t("command.placeholder")}
            className="h-12 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />
          <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
            Esc
          </kbd>
        </div>
        <Command.List className="max-h-[60vh] overflow-y-auto p-2 [&_[cmdk-list-sizer]]:space-y-1">
          <Command.Empty className="px-3 py-6 text-center text-sm text-zinc-500">
            {t("command.empty")}
          </Command.Empty>

          {recentItems.length > 0 && (
            <Command.Group
              heading={t("command.groupRecent")}
              className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
            >
              {recentItems.map((item) => (
                <PaletteRow key={`r-${item.id}`} item={item} onRun={runItem} />
              ))}
            </Command.Group>
          )}

          <Command.Group
            heading={t("command.groupQuick")}
            className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
          >
            {visibleItems
              .filter((i) => i.group === "quick")
              .map((item) => (
                <PaletteRow key={item.id} item={item} onRun={runItem} />
              ))}
          </Command.Group>

          <Command.Group
            heading={t("command.groupGo")}
            className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
          >
            {visibleItems
              .filter((i) => i.group === "go")
              .map((item) => (
                <PaletteRow key={item.id} item={item} onRun={runItem} />
              ))}
          </Command.Group>
        </Command.List>
        <div className="flex items-center justify-between gap-3 border-t border-zinc-800 bg-zinc-950 px-3 py-2 text-[10px] text-zinc-500">
          <span className="flex items-center gap-2">
            <kbd className="rounded border border-zinc-800 bg-black px-1.5 py-0.5 font-mono">↵</kbd>
            {t("command.hintEnter")}
            <span className="mx-1 opacity-30">·</span>
            <kbd className="rounded border border-zinc-800 bg-black px-1.5 py-0.5 font-mono">↑↓</kbd>
            {t("command.hintNav")}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-zinc-800 bg-black px-1.5 py-0.5 font-mono">⌘K</kbd>
            {t("command.hintToggle")}
          </span>
        </div>
      </div>
    </Command.Dialog>
  );
}

function PaletteRow({ item, onRun }: { item: CommandItem; onRun: (i: CommandItem) => void }) {
  return (
    <Command.Item
      value={`${item.label} ${item.hint ?? ""}`}
      onSelect={() => onRun(item)}
      className="group flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-zinc-300 aria-selected:bg-zinc-800 aria-selected:text-zinc-50"
    >
      <span className="text-zinc-500 group-aria-selected:text-emerald-300">{item.icon}</span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.hint && <span className="truncate text-[11px] text-zinc-500">{item.hint}</span>}
      {item.shortcut && (
        <span className="ml-2 hidden gap-1 sm:flex">
          {item.shortcut.map((k) => (
            <kbd
              key={k}
              className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-mono text-zinc-500"
            >
              {k}
            </kbd>
          ))}
        </span>
      )}
    </Command.Item>
  );
}
