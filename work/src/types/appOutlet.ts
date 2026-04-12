/** Outlet context from `Layout` for child pages (e.g. calendar staff quick-pick in top bar). */
export type CalendarStaffBarState = {
  value: string;
  onChange: (id: string) => void;
  options: { id: string; name: string }[];
};

export type AppOutletContext = {
  setCalendarStaffBar: (v: CalendarStaffBarState | null) => void;
};
