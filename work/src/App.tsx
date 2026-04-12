import { Navigate, Route, Routes } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "./context/AuthContext";
import { EffectiveRoleProvider, useEffectiveRole } from "./context/EffectiveRoleContext";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { CalendarPage } from "./pages/CalendarPage";
import { BookingsPage } from "./pages/BookingsPage";
import { ServicesPage } from "./pages/ServicesPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { AdminStaffPage } from "./pages/AdminStaffPage";
import { AdminSchedulePage } from "./pages/AdminSchedulePage";
import { AdminTimeOffPage } from "./pages/AdminTimeOffPage";
import { PublicBookingPage } from "./pages/PublicBookingPage";
import { FinancePage } from "./pages/FinancePage";
import { ClientsPage } from "./pages/ClientsPage";

function RequireManage({ children }: { children: React.ReactNode }) {
  const { canManage } = useEffectiveRole();
  if (!canManage) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppShell() {
  const { t } = useTranslation();
  const { loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-zinc-400">
        {t("common.loading")}
      </div>
    );
  }
  return (
    <EffectiveRoleProvider>
      <Layout />
    </EffectiveRoleProvider>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/book" element={<PublicBookingPage />} />
      <Route path="/" element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="bookings" element={<BookingsPage />} />
        <Route
          path="admin/staff"
          element={
            <RequireManage>
              <AdminStaffPage />
            </RequireManage>
          }
        />
        <Route
          path="admin/services"
          element={
            <RequireManage>
              <ServicesPage />
            </RequireManage>
          }
        />
        <Route
          path="admin/schedule"
          element={
            <RequireManage>
              <AdminSchedulePage />
            </RequireManage>
          }
        />
        <Route
          path="admin/time-off"
          element={
            <RequireManage>
              <AdminTimeOffPage />
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
          path="finance"
          element={
            <RequireManage>
              <FinancePage />
            </RequireManage>
          }
        />
        <Route
          path="clients"
          element={
            <RequireManage>
              <ClientsPage />
            </RequireManage>
          }
        />
        <Route path="services" element={<Navigate to="/admin/services" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
