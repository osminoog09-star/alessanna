"use client";

import { useCallback, useEffect, useState } from "react";
import { CrmShell } from "@/components/CrmShell";
import { RequireAuth } from "@/components/RequireAuth";
import { RequireManager } from "@/components/RequireManager";
import { apiFetch } from "@/lib/api";

type EmployeeRow = {
  id: number;
  name: string;
  phone: string | null;
  active: number;
};

export default function EmployeesPage() {
  const [rows, setRows] = useState<EmployeeRow[]>([]);

  const load = useCallback(async () => {
    const r = await apiFetch("/api/crm/employees");
    if (!r.ok) return;
    setRows((await r.json()) as EmployeeRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const r = await apiFetch("/api/crm/employees", {
      method: "POST",
      body: JSON.stringify({
        name: String(fd.get("name") || "").trim(),
        slug: String(fd.get("slug") || "").trim() || null,
        phone: String(fd.get("phone") || "").trim() || null,
        email: String(fd.get("email") || "").trim() || null,
      }),
    });
    if (r.ok) {
      e.currentTarget.reset();
      void load();
    } else window.alert("Could not add staff");
  }

  return (
    <RequireAuth>
      <CrmShell title="Employees">
        <RequireManager>
          <form className="panel" onSubmit={onCreate}>
            <h2 className="panel__title">New staff member</h2>
            <div className="row">
              <label>
                <span>Name</span>
                <input name="name" required />
              </label>
              <label>
                <span>Slug</span>
                <input name="slug" placeholder="optional" />
              </label>
            </div>
            <div className="row">
              <label>
                <span>Phone</span>
                <input name="phone" type="tel" />
              </label>
              <label>
                <span>Email</span>
                <input name="email" type="email" />
              </label>
            </div>
            <button type="submit" className="btn btn--primary" style={{ marginTop: "0.75rem" }}>
              Add
            </button>
          </form>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td>{e.id}</td>
                    <td>{e.name}</td>
                    <td>{e.phone || "—"}</td>
                    <td>{e.active ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </RequireManager>
      </CrmShell>
    </RequireAuth>
  );
}
