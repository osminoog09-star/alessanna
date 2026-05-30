import { useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { ReceptionCalendarPage } from "./ReceptionCalendarPage";

export function ReceptionPage() {
  const { setReceptionMode } = useAuth();

  useEffect(() => {
    setReceptionMode(true);
    return () => setReceptionMode(false);
  }, [setReceptionMode]);

  return <ReceptionCalendarPage />;
}
