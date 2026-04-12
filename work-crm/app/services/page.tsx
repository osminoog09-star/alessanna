"use client";

import { useCallback, useEffect, useState } from "react";
import { CrmShell } from "@/components/CrmShell";
import { RequireAuth } from "@/components/RequireAuth";
import { RequireManager } from "@/components/RequireManager";
import { apiFetch } from "@/lib/api";

type ServiceRow = {
  id: number;
  slug: string | null;
  name_et: string;
  duration_min: number;
  buffer_after_min: number;
  price_cents: number;
  active: number;
};

export default function ServicesPage() {
  const [rows, setRows] = useState<ServiceRow[]>([]);

  const load = useCallback(async () => {
    const r = await apiFetch("/api/crm/services");
    if (!r.ok) return;
    setRows((await r.json()) as ServiceRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const r = await apiFetch("/api/crm/services", {
      method: "POST",
      body: JSON.stringify({
        slug: String(fd.get("slug") || "").trim() || null,
        name_et: String(fd.get("name_et") || "").trim(),
        duration_min: Number(fd.get("duration_min")),
        buffer_after_min: Number(fd.get("buffer_after_min")),
        price_cents: Number(fd.get("price_cents")),
      }),
    });
    if (r.ok) {
      e.currentTarget.reset();
      void load();
    } else window.alert("Could not save");
  }

  return (
    <RequireAuth>
      <CrmShell title="Services">
        <RequireManager>
          <p className="muted">Price in cents (€35.00 = 3500). Buffer = minutes after the visit.</p>
          <div className="table-wrap" style={{ marginBottom: "1rem" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Slug</th>
                  <th>Min</th>
                  <th>Buffer</th>
                  <th>Price (¢)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name_et}</td>
                    <td>{s.slug || "—"}</td>
                    <td>{s.duration_min}</td>
                    <td>{s.buffer_after_min}</td>
                    <td>{s.price_cents}</td>
                    <td>{s.active ? "" : "hidden"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form className="panel" onSubmit={onCreate}>
            <h2 className="panel__title">New service</h2>
            <div className="row">
              <label>
                <span>Slug</span>
                <input name="slug" placeholder="hair-cut" />
              </label>
              <label>
                <span>Name (ET)</span>
                <input name="name_et" required />
              </label>
            </div>
            <div className="row">
              <label>
                <span>Duration min</span>
                <input name="duration_min" type="number" defaultValue={60} />
              </label>
              <label>
                <span>Buffer min</span>
                <input name="buffer_after_min" type="number" defaultValue={10} />
              </label>
              <label>
                <span>Price (cents)</span>
                <input name="price_cents" type="number" defaultValue={3500} />
              </label>
            </div>
            <button type="submit" className="btn btn--primary" style={{ marginTop: "0.75rem" }}>
              Save service
            </button>
          </form>
        </RequireManager>
      </CrmShell>
    </RequireAuth>
  );
}
