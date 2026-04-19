import { useState, type ReactNode } from "react";

/**
 * PrivateValue — маска для приватных данных (телефон, e-mail и т.п.).
 *
 * По умолчанию вместо значения показываем зашифрованный «хвост» (последние
 * 2–4 знака) и кнопку-глазик. По клику открываем настоящее значение для
 * этой строки. Ничего не трогаем глобально: контроль приватности — на
 * уровне отдельной ячейки таблицы (управляющий компонент держит state).
 *
 * В CRM применяется в `AdminStaffPage.tsx` для phone/calendar_email,
 * чтобы при открытой странице не светить контакты на чужие глаза.
 */

type Props = {
  /** Реальное значение. Пустое/null → отрисовываем плейсхолдер `—`. */
  value: string | null | undefined;
  /** Раскрыто ли. Управляется снаружи (per-row state). */
  revealed: boolean;
  /** Toggle обработчик. */
  onToggle: () => void;
  /** Кастомный плейсхолдер для пустого значения. По умолчанию `—`. */
  emptyPlaceholder?: ReactNode;
  /** Тип данных — влияет на маску: phone оставляем последние 4 цифры,
   *  email — `••••@d.tld`. По умолчанию `phone`. */
  kind?: "phone" | "email";
  /** Подсказка-tooltip на кнопке-глазике. */
  showTitle?: string;
  hideTitle?: string;
  /** Класс на root span. */
  className?: string;
};

function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 4) return "•".repeat(Math.max(2, digits.length));
  const tail = digits.slice(-4);
  return "••• " + tail;
}

function maskEmail(raw: string): string {
  const at = raw.indexOf("@");
  if (at <= 0) return "•".repeat(Math.min(6, raw.length || 4));
  const domain = raw.slice(at);
  return "••••" + domain;
}

export function PrivateValue({
  value,
  revealed,
  onToggle,
  emptyPlaceholder = "—",
  kind = "phone",
  showTitle = "Показать",
  hideTitle = "Скрыть",
  className = "",
}: Props) {
  const v = (value ?? "").trim();
  if (!v) {
    return <span className={className}>{emptyPlaceholder}</span>;
  }
  const masked = kind === "email" ? maskEmail(v) : maskPhone(v);
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="font-mono">{revealed ? v : masked}</span>
      <button
        type="button"
        onClick={onToggle}
        aria-label={revealed ? hideTitle : showTitle}
        title={revealed ? hideTitle : showTitle}
        className="inline-flex h-5 w-5 items-center justify-center rounded text-muted transition hover:bg-surface hover:text-gold"
      >
        {revealed ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </span>
  );
}

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a19.5 19.5 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a19.46 19.46 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24M1 1l22 22" />
    </svg>
  );
}

/** Хук-помощник для управления раскрытыми строками в таблицах. */
export function useRevealSet() {
  const [set, setSet] = useState<Set<string>>(() => new Set());
  return {
    has: (id: string) => set.has(id),
    toggle: (id: string) => {
      setSet((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    clear: () => setSet(new Set()),
  };
}
