"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CrmShell } from "@/components/CrmShell";
import { RequireAuth } from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";

type BookingRow = {
  id: number;
  start_at: string;
  client_name: string;
  service_name: string;
  employee_name: string;
  status: string;
};

function addDays(isoDate: string, delta: number) {
  const d = new Date(isoDate + "T12:00:00");
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

export default function CalendarPage() {
  const [rows, setRows] = useState<BookingRow[]>([]);
  const start = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const end = useMemo(() => addDays(start, 14), [start]);

  const load = useCallback(async () => {
    const r = await apiFetch(`/api/crm/bookings?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end + "T23:59:59")}`);
    if (!r.ok) return;
    setRows((await r.json()) as BookingRow[]);
  }, [start, end]);

  useEffect(() => {
    void load();
  }, [load]);

  const byDay = useMemo(() => {
    const active = rows.filter((b) => b.status !== "cancelled");
    const m = new Map<string, BookingRow[]>();
    for (const b of active) {
      const day = b.start_at.slice(0, 10);
      if (!m.has(day)) m.set(day, []);
      m.get(day)!.push(b);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  return (
    <RequireAuth>
      <CrmShell title="Calendar">
        <p className="muted" style={{ marginBottom: "1rem" }}>
          Next two weeks (confirmed & pending, excluding cancelled in list below).
        </p>
        {byDay.length === 0 ? (
          <p className="muted">No bookings in this range.</p>
        ) : (
          byDay.map(([day, list]) => (
            <section key={day} className="cal-day">
              <div className="cal-day__label">{day}</div>
              <div className="panel" style={{ padding: 0 }}>
                {list
                  .sort((a, b) => a.start_at.localeCompare(b.start_at))
                  .map((b) => (
                    <div key={b.id} className="cal-slot">
                      <strong>{b.start_at.slice(11, 16)}</strong> · {b.client_name} · {b.service_name}
                      <span className="muted"> · {b.employee_name}</span>
                    </div>
                  ))}
              </div>
            </section>
          ))
        )}
      </CrmShell>
    </RequireAuth>
  );
}
