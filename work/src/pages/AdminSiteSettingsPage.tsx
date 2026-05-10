import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import {
  DEFAULT_RECEPTION_SECTION_ORDER,
  type ReceptionSectionId,
  normalizeReceptionSectionOrder,
} from "../lib/receptionLayout";
import { saveReceptionSectionOrderToServer } from "../lib/receptionLayoutRemote";
import { supabase } from "../lib/supabase";

function parseBoolSetting(v: string | null | undefined, fallback = true): boolean {
  const raw = String(v ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true" || raw === "1" || raw === "yes" || raw === "on") return true;
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") return false;
  return fallback;
}

export function AdminSiteSettingsPage() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siteBookingCartEnabled, setSiteBookingCartEnabled] = useState(true);

  const [receptionOrder, setReceptionOrder] = useState<ReceptionSectionId[]>([
    ...DEFAULT_RECEPTION_SECTION_ORDER,
  ]);
  const [receptionDirty, setReceptionDirty] = useState(false);
  const [receptionSaving, setReceptionSaving] = useState(false);
  const [receptionFeedback, setReceptionFeedback] = useState<{
    kind: "ok" | "err";
    msg: string;
  } | null>(null);

  const loadSettings = useCallback(async () => {
    setError(null);
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from("salon_settings")
      .select("key,value")
      .in("key", ["site_booking_cart_enabled", "reception_section_order"]);
    setLoading(false);
    if (loadError) {
      setError(loadError.message);
      return;
    }
    const rows = (data ?? []) as { key: string; value: string | null }[];
    const cartRow = rows.find((r) => r.key === "site_booking_cart_enabled");
    const recvRow = rows.find((r) => r.key === "reception_section_order");
    setSiteBookingCartEnabled(parseBoolSetting(cartRow?.value, true));
    if (recvRow?.value) {
      try {
        setReceptionOrder(normalizeReceptionSectionOrder(JSON.parse(recvRow.value)));
      } catch {
        setReceptionOrder([...DEFAULT_RECEPTION_SECTION_ORDER]);
      }
    } else {
      setReceptionOrder([...DEFAULT_RECEPTION_SECTION_ORDER]);
    }
    setReceptionDirty(false);
    setReceptionFeedback(null);
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function saveSiteBookingCartEnabled(nextEnabled: boolean) {
    const next = nextEnabled ? "true" : "false";
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase
      .from("salon_settings")
      .upsert({ key: "site_booking_cart_enabled", value: next }, { onConflict: "key" });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setSiteBookingCartEnabled(nextEnabled);
  }

  function moveReceptionBlock(index: number, delta: number) {
    setReceptionOrder((prev) => {
      const j = index + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const a = next[index]!;
      const b = next[j]!;
      next[index] = b;
      next[j] = a;
      return next;
    });
    setReceptionDirty(true);
    setReceptionFeedback(null);
  }

  async function saveReceptionLayout() {
    setReceptionSaving(true);
    setReceptionFeedback(null);
    setError(null);
    const { error: saveErr } = await saveReceptionSectionOrderToServer(receptionOrder);
    setReceptionSaving(false);
    if (saveErr) {
      setReceptionFeedback({
        kind: "err",
        msg: t("siteSettings.receptionLayoutSaveError", { message: saveErr }),
      });
      return;
    }
    setReceptionDirty(false);
    setReceptionFeedback({ kind: "ok", msg: t("siteSettings.receptionLayoutSaved") });
  }

  function resetReceptionLayoutLocal() {
    setReceptionOrder([...DEFAULT_RECEPTION_SECTION_ORDER]);
    setReceptionDirty(true);
    setReceptionFeedback(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Настройки сайта</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Управление поведением публичного сайта без правок кода.
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-rose-700/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5">
        <div className="rounded-lg border border-zinc-800 bg-black/40 p-3">
          <label className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-100">Корзина “Ваш выбор” на сайте</p>
              <p className="mt-1 text-xs text-zinc-500">
                Если выключить, блок “Ваш выбор” на публичном сайте скрывается.
              </p>
            </div>
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-emerald-500"
              checked={siteBookingCartEnabled}
              disabled={loading || saving}
              onChange={(e) => void saveSiteBookingCartEnabled(e.target.checked)}
            />
          </label>
        </div>
        {(loading || saving) && (
          <p className="mt-3 text-xs text-zinc-500">
            {saving ? "Сохраняем…" : "Загружаем настройки…"}
          </p>
        )}
      </section>

      {isAdmin && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5">
          <h2 className="text-lg font-medium text-white">{t("siteSettings.receptionLayoutTitle")}</h2>
          <p className="mt-1 text-sm text-zinc-500">{t("siteSettings.receptionLayoutSubtitle")}</p>

          {receptionFeedback && (
            <p
              className={
                receptionFeedback.kind === "err"
                  ? "mt-3 text-sm text-rose-300"
                  : "mt-3 text-sm text-emerald-300/90"
              }
            >
              {receptionFeedback.msg}
            </p>
          )}

          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-zinc-300">
            {receptionOrder.map((sid, idx) => (
              <li key={sid} className="marker:text-zinc-500">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{t(`reception.layout.block.${sid}`)}</span>
                  <button
                    type="button"
                    disabled={idx === 0 || loading}
                    onClick={() => moveReceptionBlock(idx, -1)}
                    className="rounded border border-zinc-600 px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
                    aria-label={t("reception.layout.moveUp")}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={idx === receptionOrder.length - 1 || loading}
                    onClick={() => moveReceptionBlock(idx, 1)}
                    className="rounded border border-zinc-600 px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
                    aria-label={t("reception.layout.moveDown")}
                  >
                    ↓
                  </button>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={loading || receptionSaving || !receptionDirty}
              onClick={() => void saveReceptionLayout()}
              className="rounded-lg border border-sky-600/50 bg-sky-950/40 px-3 py-1.5 text-sm text-sky-100 hover:bg-sky-950/60 disabled:opacity-40"
            >
              {receptionSaving ? t("common.loading") : t("siteSettings.saveReceptionLayout")}
            </button>
            <button
              type="button"
              disabled={loading || receptionSaving}
              onClick={resetReceptionLayoutLocal}
              className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              {t("reception.layout.reset")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
