import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ReceptionLayoutEditor } from "../components/ReceptionLayoutEditor";
import { useAuth } from "../context/AuthContext";
import {
  DEFAULT_RECEPTION_MASTERS_PANEL,
  DEFAULT_RECEPTION_ROWS,
  DEFAULT_RECEPTION_UPCOMING_PANEL,
  type ReceptionMastersPanelConfig,
  type ReceptionRows,
  type ReceptionUpcomingPanelConfig,
  parseReceptionLayoutFile,
} from "../lib/receptionLayout";
import { saveReceptionLayoutToServer } from "../lib/receptionLayoutRemote";
import { supabase } from "../lib/supabase";
import {
  parseSalonBoolSetting,
  SALON_SETTING_PUBLIC_BOOKING_PANEL_ENABLED,
} from "../lib/salonSettingsParse";

export function AdminSiteSettingsPage() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siteBookingCartEnabled, setSiteBookingCartEnabled] = useState(true);
  const [publicBookingPanelEnabled, setPublicBookingPanelEnabled] = useState(true);

  const [receptionRows, setReceptionRows] = useState<ReceptionRows>(() =>
    DEFAULT_RECEPTION_ROWS.map((r) => [...r]),
  );
  const [receptionMasters, setReceptionMasters] = useState<ReceptionMastersPanelConfig>(() => ({
    ...DEFAULT_RECEPTION_MASTERS_PANEL,
  }));
  const [receptionUpcoming, setReceptionUpcoming] = useState<ReceptionUpcomingPanelConfig>(() => ({
    ...DEFAULT_RECEPTION_UPCOMING_PANEL,
  }));
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
      .in("key", [
        "site_booking_cart_enabled",
        SALON_SETTING_PUBLIC_BOOKING_PANEL_ENABLED,
        "reception_section_order",
      ]);
    setLoading(false);
    if (loadError) {
      setError(loadError.message);
      return;
    }
    const rows = (data ?? []) as { key: string; value: string | null }[];
    const cartRow = rows.find((r) => r.key === "site_booking_cart_enabled");
    const panelRow = rows.find((r) => r.key === SALON_SETTING_PUBLIC_BOOKING_PANEL_ENABLED);
    const recvRow = rows.find((r) => r.key === "reception_section_order");
    setSiteBookingCartEnabled(parseSalonBoolSetting(cartRow?.value, true));
    setPublicBookingPanelEnabled(parseSalonBoolSetting(panelRow?.value, true));
    if (recvRow?.value) {
      try {
        const parsed = parseReceptionLayoutFile(JSON.parse(recvRow.value) as unknown);
        setReceptionRows(parsed.rows);
        setReceptionMasters(parsed.masters);
        setReceptionUpcoming(parsed.upcoming);
      } catch {
        setReceptionRows(DEFAULT_RECEPTION_ROWS.map((r) => [...r]));
        setReceptionMasters({ ...DEFAULT_RECEPTION_MASTERS_PANEL });
        setReceptionUpcoming({ ...DEFAULT_RECEPTION_UPCOMING_PANEL });
      }
    } else {
      setReceptionRows(DEFAULT_RECEPTION_ROWS.map((r) => [...r]));
      setReceptionMasters({ ...DEFAULT_RECEPTION_MASTERS_PANEL });
      setReceptionUpcoming({ ...DEFAULT_RECEPTION_UPCOMING_PANEL });
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

  async function savePublicBookingPanelEnabled(nextEnabled: boolean) {
    const next = nextEnabled ? "true" : "false";
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase
      .from("salon_settings")
      .upsert({ key: SALON_SETTING_PUBLIC_BOOKING_PANEL_ENABLED, value: next }, { onConflict: "key" });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setPublicBookingPanelEnabled(nextEnabled);
  }

  async function saveReceptionLayout() {
    setReceptionSaving(true);
    setReceptionFeedback(null);
    setError(null);
    const { error: saveErr } = await saveReceptionLayoutToServer({
      rows: receptionRows,
      masters: receptionMasters,
      upcoming: receptionUpcoming,
    });
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
    setReceptionRows(DEFAULT_RECEPTION_ROWS.map((r) => [...r]));
    setReceptionMasters({ ...DEFAULT_RECEPTION_MASTERS_PANEL });
    setReceptionUpcoming({ ...DEFAULT_RECEPTION_UPCOMING_PANEL });
    setReceptionDirty(true);
    setReceptionFeedback(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-fg">Настройки сайта</h1>
        <p className="mt-1 text-sm text-muted">
          Управление поведением публичного сайта без правок кода.
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-rose-700/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}

      <section className="rounded-xl border border-line/15 bg-panel/60 p-5">
        <div className="rounded-lg border border-line/15 bg-canvas/40 p-3">
          <label className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-fg">Корзина “Ваш выбор” на сайте</p>
              <p className="mt-1 text-xs text-muted">
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
        <div className="mt-3 rounded-lg border border-line/15 bg-canvas/40 p-3">
          <label className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-fg">Панель онлайн-записи</p>
              <p className="mt-1 text-xs text-muted">
                Страница <code className="text-muted">/book</code>, короткая{" "}
                <code className="text-muted">/book/simple</code> и блок записи на главной сайта
                (календарь + форма). Выключите, чтобы временно закрыть запись без деплоя.
              </p>
            </div>
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-emerald-500"
              checked={publicBookingPanelEnabled}
              disabled={loading || saving}
              onChange={(e) => void savePublicBookingPanelEnabled(e.target.checked)}
            />
          </label>
        </div>
        {(loading || saving) && (
          <p className="mt-3 text-xs text-muted">
            {saving ? "Сохраняем…" : "Загружаем настройки…"}
          </p>
        )}
      </section>

      {isAdmin && (
        <section className="rounded-xl border border-line/15 bg-panel/60 p-5">
          <h2 className="text-lg font-medium text-fg">{t("siteSettings.receptionLayoutTitle")}</h2>
          <p className="mt-1 text-sm text-muted">{t("siteSettings.receptionLayoutSubtitle")}</p>

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

          <p className="mt-3 text-xs text-muted">{t("siteSettings.receptionMastersHint")}</p>

          <div className="mt-4">
            <ReceptionLayoutEditor
              variant="full"
              rows={receptionRows}
              disabled={loading || receptionSaving}
              onChange={(next) => {
                setReceptionRows(next);
                setReceptionDirty(true);
                setReceptionFeedback(null);
              }}
            />
          </div>

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
              className="rounded-lg border border-line/25 px-3 py-1.5 text-sm text-fg hover:bg-surface"
            >
              {t("reception.layout.reset")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
