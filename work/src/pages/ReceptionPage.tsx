import { useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { AppTopBar } from "../components/AppTopBar";
import { CalendarPage } from "./CalendarPage";

/**
 * Reception/kiosk mode — CRM calendar (ProCalendar) without sidebar nav.
 * Sets isReceptionMode=true so CalendarPage hides the side panel,
 * and AppTopBar shows "Reception" role + Switch User instead of Logout.
 */
export function ReceptionPage() {
  const { setReceptionMode } = useAuth();

  useEffect(() => {
    setReceptionMode(true);
    return () => setReceptionMode(false);
  }, [setReceptionMode]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <AppTopBar />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <CalendarPage />
      </div>
    </div>
  );
}
