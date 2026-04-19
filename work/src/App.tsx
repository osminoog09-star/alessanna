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
import { AdminSupportPage } from "./pages/AdminSupportPage";
import { AdminIntegrationsPage } from "./pages/AdminIntegrationsPage";
import { AdminInventoryPage } from "./pages/AdminInventoryPage";
import { AdminCommunicationsPage } from "./pages/AdminCommunicationsPage";
import { MyHelpPage } from "./pages/MyHelpPage";
import { ProfileSecurityPage } from "./pages/ProfileSecurityPage";
import { PublicBookingPage } from "./pages/PublicBookingPage";
import { PublicInvitePage } from "./pages/PublicInvitePage";
import { AdminInvitesPage } from "./pages/AdminInvitesPage";

function RequireManage({ children }: { children: React.ReactNode }) {
  const { canManage } = useEffectiveRole();
  if (!canManage) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Protected({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { staffMember, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-zinc-400">
        {t("common.loading")}
      </div>
    );
  }
  if (!staffMember) return <Navigate to="/login" replace />;
  return <EffectiveRoleProvider>{children}</EffectiveRoleProvider>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/book" element={<PublicBookingPage />} />
      <Route path="/invite/:token" element={<PublicInvitePage />} />
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
          path="admin/support"
          element={
            <RequireManage>
              <AdminSupportPage />
            </RequireManage>
          }
        />
        <Route
          path="admin/integrations"
          element={
            <RequireManage>
              <AdminIntegrationsPage />
            </RequireManage>
          }
        />
        <Route
          path="admin/inventory"
          element={
            <RequireManage>
              <AdminInventoryPage />
            </RequireManage>
          }
        />
        <Route
          path="admin/communications"
          element={
            <RequireManage>
              <AdminCommunicationsPage />
            </RequireManage>
          }
        />
        <Route
          path="admin/invites"
          element={
            <RequireManage>
              <AdminInvitesPage />
            </RequireManage>
          }
        />
        <Route path="help" element={<MyHelpPage />} />
        <Route path="profile/security" element={<ProfileSecurityPage />} />
        <Route path="services" element={<Navigate to="/admin/services" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
