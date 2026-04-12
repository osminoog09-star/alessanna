"use client";

import { useEffect, useState } from "react";
import { CrmShell } from "@/components/CrmShell";
import { RequireAuth } from "@/components/RequireAuth";
import { RequireManager } from "@/components/RequireManager";
import { apiFetch } from "@/lib/api";
import { formatEurFromCents } from "@/lib/format";

type Analytics = {
  periodDays: number;
  since: string;
  byEmployee: { employee_name: string; booking_count: number; revenue_cents: number }[];
  byService: { service_id: number; name: string; booking_count: number; revenue_cents: number }[];
  byDay: { day: string; c: number }[];
};

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await apiFetch("/api/crm/analytics?days=30");
      if (!r.ok) return;
      setData((await r.json()) as Analytics);
    })();
  }, []);

  return (
    <RequireAuth>
      <CrmShell title="Analytics">
        <RequireManager>
          {!data ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              <p className="muted" style={{ marginBottom: "1rem" }}>
                Last {data.periodDays} days · since {data.since}
              </p>
              <div className="two-col">
                <div className="panel">
                  <h2 className="panel__title">By employee</h2>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Bookings</th>
                          <th>Revenue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.byEmployee.map((r) => (
                          <tr key={r.employee_name}>
                            <td>{r.employee_name}</td>
                            <td>{r.booking_count}</td>
                            <td>{formatEurFromCents(r.revenue_cents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="panel">
                  <h2 className="panel__title">By service</h2>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Service</th>
                          <th>Bookings</th>
                          <th>Revenue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.byService.map((r) => (
                          <tr key={r.service_id}>
                            <td>{r.name}</td>
                            <td>{r.booking_count}</td>
                            <td>{formatEurFromCents(r.revenue_cents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <div className="panel">
                <h2 className="panel__title">Bookings per day</h2>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Day</th>
                        <th>Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byDay.map((d) => (
                        <tr key={d.day}>
                          <td>{d.day}</td>
                          <td>{d.c}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </RequireManager>
      </CrmShell>
    </RequireAuth>
  );
}
