import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

function parseBoolSetting(v: string | null | undefined, fallback = true): boolean {
  const raw = String(v ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true" || raw === "1" || raw === "yes" || raw === "on") return true;
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") return false;
  return fallback;
}

export function AdminSiteSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siteBookingCartEnabled, setSiteBookingCartEnabled] = useState(true);

  const loadSettings = useCallback(async () => {
    setError(null);
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from("salon_settings")
      .select("key,value")
      .eq("key", "site_booking_cart_enabled")
      .limit(1);
    setLoading(false);
    if (loadError) {
      setError(loadError.message);
      return;
    }
    const value = (data && data[0] && (data[0] as { value?: string | null }).value) ?? null;
    setSiteBookingCartEnabled(parseBoolSetting(value, true));
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
    </div>
  );
}
