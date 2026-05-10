import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

const SALON_PHONE_E164 = "+3724398384";
const SALON_PHONE_DISPLAY = "+372 439 8384";

/** Страницы `/book` и `/book/simple`, когда панель выключена в CRM. */
export function PublicBookingPanelDisabled() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-6 py-16 text-center text-zinc-200">
      <div className="max-w-md space-y-4 rounded-2xl border border-amber-500/25 bg-zinc-900/50 px-8 py-10 shadow-lg shadow-black/50">
        <h1 className="text-xl font-semibold tracking-tight text-white">
          {t("publicBook.panelDisabledTitle")}
        </h1>
        <p className="text-sm leading-relaxed text-zinc-300">{t("publicBook.panelDisabledP1")}</p>
        <p className="text-sm leading-relaxed text-zinc-300">{t("publicBook.panelDisabledP2")}</p>
        <p className="text-sm text-zinc-400">
          <a
            href={`tel:${SALON_PHONE_E164}`}
            className="font-medium text-amber-200 underline decoration-amber-500/40 underline-offset-2 hover:text-amber-100"
          >
            {SALON_PHONE_DISPLAY}
          </a>
        </p>
        <Link to="/" className="inline-block pt-2 text-sm text-sky-400 hover:text-sky-300">
          {t("publicBook.panelDisabledBackHome")}
        </Link>
      </div>
    </div>
  );
}
