import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * ThemeContext — глобальная палитра CRM в стиле бренда Alessanna
 * (см. styles.css публичного сайта: deep black + warm gold).
 *
 * Темы:
 *   • onyx       — глубокая ночь (по умолчанию). Совпадает с публичным сайтом.
 *   • champagne  — светлая, тёплая. Для дневной работы у окна / ресепшен-планшета.
 *   • stone      — тёплая полутень. Меньше контраст, легче глазам в долгую смену.
 *
 * Хранение: localStorage["alessanna.crm.theme"]. Если значения нет — берём
 * системное предпочтение (prefers-color-scheme: light → champagne, иначе onyx).
 *
 * Применение: data-theme="<id>" на <html>, реальные цвета — в src/index.css
 * через CSS-переменные (--c-canvas, --c-fg, --c-gold и т.д.). Tailwind берёт
 * их через утилиты `bg-canvas`, `text-fg`, `text-gold` (см. tailwind.config.js).
 */

export type ThemeId = "onyx" | "champagne" | "stone";

const STORAGE_KEY = "alessanna.crm.theme";

/** Источник правды для UI-переключателя; порядок = порядок в списке. */
export const THEMES: readonly { id: ThemeId; labelKey: string }[] = [
  { id: "onyx", labelKey: "theme.onyx" },
  { id: "champagne", labelKey: "theme.champagne" },
  { id: "stone", labelKey: "theme.stone" },
] as const;

function readStored(): ThemeId | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "onyx" || v === "champagne" || v === "stone") return v;
  } catch {
    /* ignore */
  }
  return null;
}

function detectInitial(): ThemeId {
  const stored = readStored();
  if (stored) return stored;
  if (typeof window !== "undefined" && window.matchMedia) {
    if (window.matchMedia("(prefers-color-scheme: light)").matches) return "champagne";
  }
  return "onyx";
}

type ThemeCtx = {
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
  cycleTheme: () => void;
};

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => detectInitial());

  /* Применяем data-theme на <html> сразу при инициализации,
   * чтобы избежать flash of wrong theme при первом рендере. */
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const setTheme = useCallback((t: ThemeId) => {
    setThemeState(t);
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeState((prev) => {
      const idx = THEMES.findIndex((x) => x.id === prev);
      const next = THEMES[(idx + 1) % THEMES.length];
      return next.id;
    });
  }, []);

  const value = useMemo<ThemeCtx>(
    () => ({ theme, setTheme, cycleTheme }),
    [theme, setTheme, cycleTheme],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) {
    /* Безопасный fallback: вне провайдера всё ещё возвращаем onyx,
     * чтобы тестовые рендеры компонентов не падали. setTheme — no-op. */
    return {
      theme: "onyx",
      setTheme: () => undefined,
      cycleTheme: () => undefined,
    };
  }
  return v;
}
