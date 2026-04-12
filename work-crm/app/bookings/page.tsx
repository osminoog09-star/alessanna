"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CrmShell } from "@/components/CrmShell";
import { RequireAuth } from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";
import { useAuth, useIsManager } from "@/lib/auth";

type BookingRow = {
  id: number;
  start_at: string;
  client_name: string;
  service_name: string;
  employee_name: string;
  source: string;
  status: string;
};

type Emp = { id: number; name: string; active: number };
type Svc = { id: number; name_et: string; active: number };

function todayISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function BookingsPage() {
  const { user } = useAuth();
  const isManager = useIsManager();
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [employees, setEmployees] = useState<Emp[]>([]);
  const [services, setServices] = useState<Svc[]>([]);
  const dlgRef = useRef<HTMLDialogElement>(null);

  const load = useCallback(async () => {
    const r = await apiFetch("/api/crm/bookings");
    if (!r.ok) return;
    const data = (await r.json()) as BookingRow[];
    setRows(data);
  }, []);

  const loadSelects = useCallback(async () => {
    const [er, sr] = await Promise.all([apiFetch("/api/crm/employees"), apiFetch("/api/crm/services")]);
    if (er.ok) {
      const list = (await er.json()) as Emp[];
      setEmployees(list.filter((e) => e.active !== 0));
    }
    if (sr.ok) {
      const list = (await sr.json()) as Svc[];
      setServices(list.filter((s) => s.active !== 0));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openNew() {
    void loadSelects();
    dlgRef.current?.showModal();
  }

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      employeeId: Number(fd.get("employeeId")),
      serviceId: Number(fd.get("serviceId")),
      date: String(fd.get("date")),
      time: String(fd.get("time")),
      clientName: String(fd.get("clientName") || "").trim(),
      clientPhone: String(fd.get("clientPhone") || "").trim(),
      notes: String(fd.get("notes") || "").trim(),
    };
    const r = await apiFetch("/api/crm/bookings", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const j = (await r.json()) as { error?: string };
    if (r.ok) {
      dlgRef.current?.close();
      e.currentTarget.reset();
      void load();
    } else {
      window.alert(j.error || "Could not create booking");
    }
  }

  async function cancelBooking(id: number) {
    if (!window.confirm("Cancel this booking?")) return;
    await apiFetch(`/api/crm/bookings/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "cancelled" }),
    });
    void load();
  }

  async function payBooking(id: number) {
    const r = await apiFetch("/api/payments/create-checkout-session", {
      method: "POST",
      body: JSON.stringify({ bookingId: id }),
    });
    const j = (await r.json()) as { url?: string; error?: string };
    if (j.url) window.location.href = j.url;
    else window.alert(j.error || "Checkout unavailable");
  }

  const defaultEmployeeId =
    user?.role === "employee" && user.employeeId != null ? String(user.employeeId) : "";

  const employeeOptions =
    user?.role === "employee" && user.employeeId != null
      ? employees.filter((e) => e.id === user.employeeId)
      : employees;

  return (
    <RequireAuth>
      <CrmShell title="Bookings">
        <div style={{ marginBottom: "1rem" }}>
          <button type="button" className="btn btn--primary" onClick={openNew}>
            New booking
          </button>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Client</th>
                <th>Service</th>
                <th>Staff</th>
                <th>Source</th>
                {isManager && <th>Pay</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td>{b.start_at}</td>
                  <td>{b.client_name}</td>
                  <td>{b.service_name}</td>
                  <td>{b.employee_name}</td>
                  <td>{b.source}</td>
                  {isManager && (
                    <td>
                      {b.status !== "cancelled" ? (
                        <button type="button" className="linklike" onClick={() => void payBooking(b.id)}>
                          Stripe
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  )}
                  <td>
                    {b.status !== "cancelled" ? (
                      <button type="button" className="linklike" onClick={() => void cancelBooking(b.id)}>
                        Cancel
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dialog ref={dlgRef} className="dialog-surface">
          <form className="dialog-inner" onSubmit={onCreate}>
            <h2 className="panel__title">New booking</h2>
            <div className="row">
              <label>
                <span>Staff</span>
                <select name="employeeId" required defaultValue={defaultEmployeeId}>
                  {employeeOptions.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Service</span>
                <select name="serviceId" required>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name_et}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="row">
              <label>
                <span>Date</span>
                <input name="date" type="date" required defaultValue={todayISODate()} />
              </label>
              <label>
                <span>Time</span>
                <input name="time" type="time" required />
              </label>
            </div>
            <div className="row">
              <label>
                <span>Client name</span>
                <input name="clientName" required />
              </label>
              <label>
                <span>Phone</span>
                <input name="clientPhone" type="tel" />
              </label>
            </div>
            <label className="muted" style={{ display: "flex", flexDirection: "column", gap: "0.25rem", marginTop: "0.5rem" }}>
              Notes
              <textarea name="notes" rows={2} style={{ font: "inherit", padding: "0.45rem", borderRadius: 6, border: "1px solid var(--border)" }} />
            </label>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => dlgRef.current?.close()}>
                Close
              </button>
              <button type="submit" className="btn btn--primary">
                Save
              </button>
            </div>
            {!isManager && (
              <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.75rem" }}>
                You can only create bookings for yourself.
              </p>
            )}
          </form>
        </dialog>
      </CrmShell>
    </RequireAuth>
  );
}
