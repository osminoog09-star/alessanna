import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { normalizeRoles } from "../lib/roles";
import { LanguageSwitcher } from "./LanguageSwitcher";

type NavKey = "dashboard" | "calendar" | "bookings" | "employees" | "services" | "analytics" | "adminStaff";

type NavItem = {
  to: string;
  key: NavKey;
  end?: boolean;
  /** Only admins (staff roster + Admin Staff). */
  adminOnly?: boolean;
  /** Admins and managers — not plain `staff`. */
  managerUp?: boolean;
};

const navAll: NavItem[] = [
  { to: "/", key: "dashboard", end: true },
  { to: "/calendar", key: "calendar" },
  { to: "/bookings", key: "bookings" },
  { to: "/employees", key: "employees", adminOnly: true },
  { to: "/services", key: "services", managerUp: true },
  { to: "/analytics", key: "analytics", managerUp: true },
  { to: "/admin/staff", key: "adminStaff", adminOnly: true },
];

export function Layout() {
  const { t, i18n } = useTranslation();
  const { employee, logout, canManage, isStaffOnly, isAdmin } = useAuth();

  const nav = navAll.filter((item) => {
    if (item.adminOnly && !isAdmin) return false;
    if (item.managerUp && !canManage) return false;
    return true;
  });

  useEffect(() => {
    const base = (i18n.language || "ru").split("-")[0];
    if (base === "ru" || base === "et") document.documentElement.lang = base;
  }, [i18n.language]);

  return (
    <div className="flex min-h-screen bg-black">
      <aside className="flex w-56 flex-col border-r border-zinc-800 bg-zinc-950">
        <div className="border-b border-zinc-800 p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{t("brand")}</p>
            <LanguageSwitcher className="justify-end" />
          </div>
          <p className="mt-1 text-sm font-medium text-zinc-100">{employee?.name}</p>
          <p className="text-xs text-zinc-500">
            {employee?.roles?.length
              ? normalizeRoles(employee.roles)
                  .map((r) => t(`role.${r}`))
                  .join(" · ")
              : ""}
          </p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={Boolean(item.end)}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                }`
              }
            >
              {t(`nav.${item.key}`)}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-zinc-800 p-2">
          <button
            type="button"
            onClick={logout}
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
          >
            {t("nav.logout")}
          </button>
        </div>
        {isStaffOnly && (
          <p className="border-t border-zinc-800 p-3 text-xs text-zinc-600">{t("nav.staffHint")}</p>
        )}
      </aside>
      <main className="min-w-0 flex-1 overflow-auto p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}
