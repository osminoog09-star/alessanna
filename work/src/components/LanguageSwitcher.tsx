import { useTranslation } from "react-i18next";
import type { CrmLanguage } from "../i18n";

const LANGS: CrmLanguage[] = ["ru", "et"];

type Props = {
  className?: string;
  variant?: "default" | "compact";
};

export function LanguageSwitcher({ className = "", variant = "default" }: Props) {
  const { i18n, t } = useTranslation();
  const current = (i18n.language.split("-")[0] as CrmLanguage) || "ru";

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`} role="group" aria-label={t("common.language")}>
      {LANGS.map((code, i) => (
        <span key={code} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-zinc-600 select-none">|</span>}
          <button
            type="button"
            onClick={() => void i18n.changeLanguage(code)}
            className={`rounded-md font-medium transition-colors touch-manipulation ${
              variant === "compact"
                ? `px-2 py-1 text-xs ${
                    current === code
                      ? "bg-zinc-700 text-white"
                      : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
                  }`
                : `px-2.5 py-1.5 text-xs ${
                    current === code
                      ? "bg-amber-500/20 text-amber-100 ring-1 ring-amber-500/40"
                      : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
                  }`
            }`}
          >
            {t(`lang.${code}`)}
          </button>
        </span>
      ))}
    </div>
  );
}
