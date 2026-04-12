"use client";

import { useEffect, useState } from "react";
import { CrmShell } from "@/components/CrmShell";
import { RequireAuth } from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";
import { useAuth, useIsManager } from "@/lib/auth";
import { formatEurFromCents } from "@/lib/format";

type Stats = {
  bookingsToday: number;
  upcoming: number;
  employees: number;
  services: number;
  revenueTodayCents: number;
  revenueMonthCents: number;
};

export default function DashboardPage() {
  const { user } = useAuth();
  const isManager = useIsManager();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    if (!isManager) return;
    let cancelled = false;
    (async () => {
      const r = await apiFetch("/api/crm/stats");
      if (!r.ok || cancelled) return;
      const s = (await r.json()) as Stats;
      if (!cancelled) setStats(s);
    })();
    return () => {
      cancelled = true;
    };
  }, [isManager]);

  return (
    <RequireAuth>
      <CrmShell title="Dashboard">
        {user?.role === "employee" ? (
          <p className="muted">Your schedule is under Calendar and Bookings.</p>
        ) : stats ? (
          <>
            <div className="grid-stats">
              <div className="stat">
                <div className="stat__label">Today · bookings</div>
                <div className="stat__value">{stats.bookingsToday}</div>
              </div>
              <div className="stat">
                <div className="stat__label">Upcoming</div>
                <div className="stat__value">{stats.upcoming}</div>
              </div>
              <div className="stat">
                <div className="stat__label">Today · revenue</div>
                <div className="stat__value">{formatEurFromCents(stats.revenueTodayCents)}</div>
              </div>
              <div className="stat">
                <div className="stat__label">Month · revenue</div>
                <div className="stat__value">{formatEurFromCents(stats.revenueMonthCents)}</div>
              </div>
              <div className="stat">
                <div className="stat__label">Staff</div>
                <div className="stat__value">{stats.employees}</div>
              </div>
              <div className="stat">
                <div className="stat__label">Services</div>
                <div className="stat__value">{stats.services}</div>
              </div>
            </div>
            <p className="muted">Quick overview — open Analytics for trends.</p>
          </>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </CrmShell>
    </RequireAuth>
  );
}
