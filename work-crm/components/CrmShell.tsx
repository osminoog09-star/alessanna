"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth, useIsManager } from "@/lib/auth";

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/calendar/", label: "Calendar" },
  { href: "/bookings/", label: "Bookings" },
  { href: "/employees/", label: "Employees" },
  { href: "/services/", label: "Services" },
  { href: "/analytics/", label: "Analytics", manager: true },
  { href: "/settings/", label: "Settings", manager: true },
  { href: "/help/", label: "Help" },
] as const;

function normalizePath(p: string) {
  const x = p.replace(/\/$/, "");
  return x === "" ? "/" : x;
}

export function CrmShell({ title, children }: { title: string; children: ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const isManager = useIsManager();
  const path = normalizePath(pathname || "/");

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__brand">AlesSanna · Work</div>
        <div className="sidebar__user">
          {user?.email}
          <br />
          <span className="muted">{user?.role}</span>
        </div>
        <nav className="sidebar__nav">
          {nav.map((item) => {
            if ("manager" in item && item.manager && !isManager) return null;
            const href = normalizePath(item.href);
            const active = href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
            return (
              <Link key={item.href} href={item.href} className={active ? "is-active" : undefined}>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar__foot">
          <button type="button" className="btn btn--ghost" onClick={() => void logout()} style={{ width: "100%" }}>
            Log out
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="main__header">
          <h1 className="main__title">{title}</h1>
        </header>
        {children}
      </div>
    </div>
  );
}
