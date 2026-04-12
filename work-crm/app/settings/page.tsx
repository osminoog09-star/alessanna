"use client";

import { useCallback, useEffect, useState } from "react";
import { CrmShell } from "@/components/CrmShell";
import { RequireAuth } from "@/components/RequireAuth";
import { RequireManager } from "@/components/RequireManager";
import { apiFetch } from "@/lib/api";
import { useIsManager } from "@/lib/auth";

type HourRow = { weekday: number; open_min: number; close_min: number };

export default function SettingsPage() {
  const isManager = useIsManager();
  const [json, setJson] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch("/api/crm/salon-hours");
    if (!r.ok) return;
    const rows = (await r.json()) as HourRow[];
    setJson(JSON.stringify(rows, null, 2));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setMsg(null);
    setSaving(true);
    try {
      const parsed = JSON.parse(json) as HourRow[];
      if (!Array.isArray(parsed)) throw new Error("Expected array");
      const r = await apiFetch("/api/crm/salon-hours", {
        method: "PUT",
        body: JSON.stringify(parsed),
      });
      if (!r.ok) {
        const j = (await r.json()) as { error?: string };
        throw new Error(j.error || "Save failed");
      }
      setMsg("Saved.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Invalid JSON");
    } finally {
      setSaving(false);
    }
  }

  return (
    <RequireAuth>
      <CrmShell title="Settings">
        <div className="panel">
          <h2 className="panel__title">Salon hours</h2>
          <p className="muted">
            Weekday 1 = Monday … 6 = Saturday. Times are minutes from midnight (10:00 = 600). Edit JSON below; managers
            can save.
          </p>
          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            rows={14}
            style={{
              width: "100%",
              marginTop: "0.75rem",
              fontFamily: "ui-monospace, monospace",
              fontSize: 12,
              padding: "10px",
              borderRadius: 8,
              border: "1px solid rgba(0,0,0,0.12)",
            }}
            readOnly={!isManager}
          />
          <RequireManager>
            <div style={{ marginTop: "0.75rem", display: "flex", gap: 8, alignItems: "center" }}>
              <button type="button" className="btn btn--primary" disabled={saving} onClick={() => void save()}>
                {saving ? "Saving…" : "Save hours"}
              </button>
              {msg && <span className="muted">{msg}</span>}
            </div>
          </RequireManager>
        </div>
        <p className="muted" style={{ marginTop: "1rem" }}>
          Integrations (Stripe, WhatsApp, Telegram) are configured via environment variables on the server.
        </p>
      </CrmShell>
    </RequireAuth>
  );
}
