import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ru from "@locales/ru.json";
import et from "@locales/et.json";

const LANG_KEY = "lang";
const CRM_ALLOWED = ["ru", "et"] as const;
export type CrmLanguage = (typeof CRM_ALLOWED)[number];

function readStoredLang(): string | null {
  try {
    return localStorage.getItem(LANG_KEY);
  } catch {
    return null;
  }
}

/** First visit: match browser (et / ru). fi/en → Russian CRM UI. */
function browserPreferredCrmLang(): CrmLanguage {
  if (typeof navigator === "undefined") return "ru";
  const raw = (navigator.languages?.[0] || navigator.language || "ru").toLowerCase();
  if (raw.startsWith("et")) return "et";
  if (raw.startsWith("ru")) return "ru";
  return "ru";
}

function initialLng(): CrmLanguage {
  const saved = readStoredLang();
  if (saved === "ru" || saved === "et") return saved;
  return browserPreferredCrmLang();
}

let boot = true;

i18n.on("languageChanged", (lng) => {
  const base = lng.split("-")[0];
  if (base !== "ru" && base !== "et") return;
  if (boot) return;
  try {
    localStorage.setItem(LANG_KEY, base);
  } catch {
    /* ignore */
  }
});

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      ru: { translation: ru },
      et: { translation: et },
    },
    lng: initialLng(),
    fallbackLng: "ru",
    supportedLngs: [...CRM_ALLOWED],
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
  })
  .then(() => {
    const lang = readStoredLang();
    if (lang && !CRM_ALLOWED.includes(lang as CrmLanguage)) {
      void i18n.changeLanguage("ru");
    }
    const base = (i18n.language || "ru").split("-")[0];
    if (typeof document !== "undefined" && (base === "ru" || base === "et")) {
      document.documentElement.lang = base;
    }
    queueMicrotask(() => {
      boot = false;
    });
  });

export default i18n;
