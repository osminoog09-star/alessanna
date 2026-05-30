import { useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { CalendarPage } from "./CalendarPage";

/**
 * Reception/kiosk mode — full CRM calendar without the sidebar nav.
 * Sets isReceptionMode=true while mounted so AppTopBar and other
 * components know they're running in kiosk context.
 */
export function ReceptionPage() {
  const { setReceptionMode } = useAuth();

  useEffect(() => {
    setReceptionMode(true);
    return () => setReceptionMode(false);
  }, [setReceptionMode]);

  return <CalendarPage />;
}
