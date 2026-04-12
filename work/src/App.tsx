import { Navigate, Route, Routes } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "./context/AuthContext";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { CalendarPage } from "./pages/CalendarPage";
import { BookingsPage } from "./pages/BookingsPage";
import { EmployeesPage } from "./pages/EmployeesPage";
import { ServicesPage } from "./pages/ServicesPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { AdminStaffPage } from "./pages/AdminStaffPage";

/** Block direct URL access (nav is already hidden in Layout for staff-only). */
function RequireManage({ children }: { children: React.ReactNode }) {
  const { canManage } = useAuth();
  if (!canManage) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Protected({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { employee, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-zinc-400">
        {t("common.loading")}
      </div>
    );
  }
  if (!employee) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="bookings" element={<BookingsPage />} />
        <Route
          path="employees"
          element={
            <RequireAdmin>
              <EmployeesPage />
            </RequireAdmin>
          }
        />
        <Route
          path="services"
          element={
            <RequireManage>
              <ServicesPage />
            </RequireManage>
          }
        />
        <Route
          path="analytics"
          element={
            <RequireManage>
              <AnalyticsPage />
            </RequireManage>
          }
        />
        <Route
          path="admin/staff"
          element={
            <RequireAdmin>
              <AdminStaffPage />
            </RequireAdmin>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
