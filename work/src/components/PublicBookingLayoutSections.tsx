import {
  eachDayOfInterval,
  eachMonthOfInterval,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  format,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from "date-fns";
import type { TFunction } from "i18next";
import type { i18n } from "i18next";
import { useTranslation } from "react-i18next";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type {
  ReceptionMastersDensity,
  ReceptionMastersLayoutMode,
  ReceptionUpcomingDensity,
  ReceptionUpcomingContentWidth,
} from "../lib/receptionLayout";
import type { PublicCalendarScope } from "../lib/publicCalendarRange";
import type { StaffCalendarColor } from "../lib/staffCalendarColors";
import { resolveStaffPublicPastelCard } from "../lib/staffCalendarColors";
import { formatSlotRange, type Slot } from "../lib/slots";
import type { AppointmentRow, StaffMember } from "../types/database";
import { PublicBookingDayTimeline } from "./PublicBookingDayTimeline";
import {
  CalendarStaffLegend,
  PublicCalendarWeekAgenda,
} from "./PublicCalendarAgendaViews";

type PublicServiceMini = { id: string; name: string; active: boolean };

const WEEKDAY_MON_FIRST = ["1", "2", "3", "4", "5", "6", "0"] as const;

export type MasterDayRow = {
  id: string;
  name: string;
  workTime: string;
  freeSlots: number;
  busyItems: number;
  timeOffItems: number;
  status: "free" | "busy" | "off";
  /** Ближайшее свободное окно сегодня (HH:mm) или null. */
  earliestFreeLabel: string | null;
};

type CalendarProps = {
  t: TFunction;
  i18n: i18n;
  calendarScope: PublicCalendarScope;
  setCalendarScope: Dispatch<SetStateAction<PublicCalendarScope>>;
  viewMonth: Date;
  setViewMonth: Dispatch<SetStateAction<Date>>;
  selectedDay: Date;
  /** yyyy-MM-dd (Europe/Tallinn), совпадает с днём записи. */
  selectedDayYmd: string;
  /** Не раньше этого дня можно выбрать дату (завтра по Таллину). */
  minSelectableYmd: string;
  onSelectCalendarDay: (d: Date) => void;
  monthStart: Date;
  calendarDays: Date[];
  weekDays: Date[];
  rangeTitle: string;
  onNavigatePrev: () => void;
  onNavigateNext: () => void;
  renderDayButtons: (gridDays: Date[], anchorMonth: Date, compact: boolean) => ReactNode;
  calendarRangeAppointments: AppointmentRow[];
  staffColorAssignments: ReadonlyMap<string, StaffCalendarColor>;
  staffById: Map<string, StaffMember>;
  services: PublicServiceMini[];
  /** Колонки в дневной сетке (как в классических программах): обычно все мастера панели. */
  timelineStaff: StaffMember[];
};

function scopeButtonClass(active: boolean): string {
  return `rounded-md px-2 py-1 text-[11px] md:px-2.5 md:text-xs ${
    active ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"
  }`;
}

export function PublicBookingCalendarSection({
  t,
  i18n,
  calendarScope,
  setCalendarScope,
  viewMonth,
  setViewMonth,
  selectedDay,
  selectedDayYmd,
  minSelectableYmd,
  onSelectCalendarDay,
  monthStart,
  calendarDays,
  weekDays,
  rangeTitle,
  onNavigatePrev,
  onNavigateNext,
  renderDayButtons,
  calendarRangeAppointments,
  staffColorAssignments,
  staffById,
  services,
  timelineStaff,
}: CalendarProps) {
  const appointmentStaffIds = [
    ...new Set(
      calendarRangeAppointments.filter((a) => a.status !== "cancelled").map((a) => a.staff_id),
    ),
  ];

  function setScope(next: PublicCalendarScope) {
    setCalendarScope(next);
    if (next === "year") setViewMonth((v) => startOfYear(v));
    else if (next === "quarter") setViewMonth((v) => startOfQuarter(v));
  }

  const miniMonthGrid = (fromMonth: Date, toMonth: Date, compact: boolean) => (
    <div
      className={
        compact
          ? "grid max-h-[min(70vh,52rem)] gap-5 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3"
          : "grid gap-4 sm:grid-cols-3"
      }
    >
      {eachMonthOfInterval({ start: fromMonth, end: toMonth }).map((mStart) => {
        const mAnchor = startOfMonth(mStart);
        const from = startOfWeek(mAnchor, { weekStartsOn: 1 });
        const to = endOfWeek(endOfMonth(mAnchor), { weekStartsOn: 1 });
        const days = eachDayOfInterval({ start: from, end: to });
        return (
          <div
            key={mAnchor.toISOString()}
            className="rounded-lg border border-zinc-800/80 bg-black/25 p-2.5 md:p-3"
          >
            <p className="mb-2 text-center text-xs font-semibold capitalize text-zinc-200">
              {format(mAnchor, "LLLL yyyy")}
            </p>
            <div className="mb-1.5 grid grid-cols-7 gap-0.5 text-center text-[9px] text-zinc-600 md:gap-1 md:text-[10px]">
              {WEEKDAY_MON_FIRST.map((wd) => (
                <span key={wd}>{t(`weekday.${wd}`)}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5 md:gap-1">{renderDayButtons(days, mAnchor, true)}</div>
          </div>
        );
      })}
    </div>
  );

  return (
    <section className="rounded-xl border border-zinc-800 bg-black/30 p-4 md:p-5">
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-200">{t("publicBook.calendarTitle")}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {calendarScope === "year" || calendarScope === "quarter"
              ? t("publicBook.yearHint")
              : t("publicBook.calendarColorHint")}{" "}
            {t("publicBook.bookingTimezoneHint")}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex max-w-full flex-wrap rounded-lg border border-zinc-800 p-0.5">
            {(
              [
                ["day", t("publicBook.dayView")] as const,
                ["week", t("publicBook.weekView")] as const,
                ["month", t("publicBook.monthView")] as const,
                ["quarter", t("publicBook.quarterView")] as const,
                ["year", t("publicBook.yearView")] as const,
              ] as const
            ).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setScope(key)} className={scopeButtonClass(calendarScope === key)}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onNavigatePrev}
              className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500 hover:text-white"
            >
              ←
            </button>
            <span className="min-w-[100px] max-w-[14rem] text-center text-xs text-zinc-400 md:min-w-[160px]">
              {rangeTitle}
            </span>
            <button
              type="button"
              onClick={onNavigateNext}
              className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500 hover:text-white"
            >
              →
            </button>
          </div>
        </div>
      </div>

      {calendarScope === "day" && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-500">{t("publicBook.dayTimelineHint")}</p>
          <PublicBookingDayTimeline
            day={selectedDay}
            appointments={calendarRangeAppointments}
            timelineStaff={timelineStaff}
            staffById={staffById}
            services={services}
            staffColorAssignments={staffColorAssignments}
            startHour={8}
            endHour={20}
          />
        </div>
      )}

      {calendarScope === "week" && (
        <PublicCalendarWeekAgenda
          weekDays={weekDays}
          appointments={calendarRangeAppointments}
          staffById={staffById}
          services={services}
          i18n={i18n}
          selectedDayYmd={selectedDayYmd}
          minSelectableYmd={minSelectableYmd}
          onSelectDay={onSelectCalendarDay}
          staffColorAssignments={staffColorAssignments}
        />
      )}

      {calendarScope === "month" && (
        <>
          <div className="mb-2 grid grid-cols-7 gap-1.5 text-center text-[10px] uppercase tracking-wide text-zinc-600 md:gap-2 md:text-xs">
            {WEEKDAY_MON_FIRST.map((wd) => (
              <span key={wd}>{t(`weekday.${wd}`)}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5 md:gap-2">{renderDayButtons(calendarDays, monthStart, false)}</div>
        </>
      )}

      {calendarScope === "quarter" && Number.isFinite(viewMonth.getTime())
        ? miniMonthGrid(startOfQuarter(viewMonth), endOfQuarter(viewMonth), true)
        : null}

      {calendarScope === "year" && Number.isFinite(viewMonth.getTime())
        ? miniMonthGrid(startOfYear(viewMonth), endOfYear(viewMonth), true)
        : null}

      <CalendarStaffLegend
        appointmentStaffIds={appointmentStaffIds}
        staffById={staffById}
        staffColorAssignments={staffColorAssignments}
      />
    </section>
  );
}

type UpcomingProps = {
  receptionUpcoming: AppointmentRow[];
  staff: StaffMember[];
  services: PublicServiceMini[];
  i18n: i18n;
  t: TFunction;
  density?: ReceptionUpcomingDensity;
  contentWidth?: ReceptionUpcomingContentWidth;
};

function upcomingSectionPadding(d: ReceptionUpcomingDensity | undefined): string {
  switch (d) {
    case "comfortable":
      return "p-4 md:p-5";
    case "dense":
      return "p-2.5 md:p-3";
    default:
      return "p-3 md:p-4";
  }
}

function upcomingCardClass(d: ReceptionUpcomingDensity | undefined): string {
  switch (d) {
    case "comfortable":
      return "rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2.5 text-sm text-zinc-300";
    case "dense":
      return "rounded-md border border-zinc-800/90 bg-zinc-950/70 px-2 py-1.5 text-[11px] leading-snug text-zinc-300";
    default:
      return "rounded-lg border border-zinc-800 bg-zinc-950/70 px-2.5 py-1.5 text-xs text-zinc-300";
  }
}

export function PublicBookingUpcomingSection({
  receptionUpcoming,
  staff,
  services,
  i18n,
  t,
  density = "compact",
  contentWidth = "narrow",
}: UpcomingProps) {
  const widthCls =
    contentWidth === "full"
      ? "w-full"
      : contentWidth === "medium"
        ? "w-full max-w-xl"
        : "w-full max-w-md";
  return (
    <section
      className={`rounded-xl border border-zinc-800 bg-black/30 ${upcomingSectionPadding(density)} ${widthCls}`}
    >
      <h2 className="text-sm font-semibold text-white">{t("publicBook.upcomingWorksTitle")}</h2>
      <p className="mt-1 text-xs text-zinc-500">{t("publicBook.upcomingWorksHint")}</p>
      <div className={density === "dense" ? "mt-2 space-y-1.5" : "mt-2.5 space-y-2"}>
        {receptionUpcoming.length > 0 ? (
          receptionUpcoming.map((ap) => {
            const master = staff.find((s) => s.id === ap.staff_id);
            const svcName = services.find((s) => String(s.id) === String(ap.service_id))?.name || "—";
            return (
              <div key={ap.id} className={upcomingCardClass(density)}>
                <div className="font-medium text-zinc-100">
                  {ap.start_time
                    ? new Date(ap.start_time).toLocaleString(i18n.language, {
                        dateStyle: "short",
                        timeStyle: "short",
                      })
                    : "—"}
                </div>
                <div className="mt-0.5 text-zinc-400">
                  {master?.name || "—"} · {svcName}
                </div>
                <div className="mt-0.5 text-zinc-500">{ap.client_name || "—"}</div>
              </div>
            );
          })
        ) : (
          <p className="text-xs text-zinc-600">{t("publicBook.upcomingWorksEmpty")}</p>
        )}
      </div>
    </section>
  );
}

type MastersProps = {
  t: TFunction;
  hairMasters: MasterDayRow[];
  nailMasters: MasterDayRow[];
  selectedStaffId: string | null;
  onPickMaster: (staffId: string) => void;
  density?: ReceptionMastersDensity;
  mastersLayout?: ReceptionMastersLayoutMode;
  staffById: Map<string, StaffMember>;
  staffColorAssignments: ReadonlyMap<string, StaffCalendarColor>;
};

function cardDensityClass(d: ReceptionMastersDensity | undefined): {
  btn: string;
  badge: string;
  meta: string;
} {
  switch (d) {
    case "comfortable":
      return {
        btn: "px-3 py-2.5 text-sm md:px-4 md:py-3 md:text-[15px]",
        badge: "px-2 py-0.5 text-[10px] md:text-[11px]",
        meta: "mt-1.5 text-xs md:text-sm text-zinc-500",
      };
    case "dense":
      return {
        btn: "px-2 py-1 text-[11px] md:px-2.5 md:py-1.5 md:text-xs",
        badge: "px-1.5 py-px text-[9px]",
        meta: "mt-0.5 text-[10px] md:text-[11px] text-zinc-500",
      };
    default:
      return {
        btn: "px-3 py-2 text-xs md:px-4 md:py-2.5 md:text-sm",
        badge: "px-2 py-0.5 text-[10px]",
        meta: "mt-1 text-xs text-zinc-500",
      };
  }
}

function MasterDayCard({
  m,
  selected,
  onPick,
  density,
  staffById,
  staffColorAssignments,
}: {
  m: MasterDayRow;
  selected: boolean;
  onPick: () => void;
  density?: ReceptionMastersDensity;
  staffById: Map<string, StaffMember>;
  staffColorAssignments: ReadonlyMap<string, StaffCalendarColor>;
}) {
  const { t } = useTranslation();
  const dc = cardDensityClass(density);
  const pastel = resolveStaffPublicPastelCard(m.id, staffById, staffColorAssignments);
  return (
    <button
      type="button"
      onClick={onPick}
      className={
        `w-full rounded-lg border border-l-4 text-left text-zinc-300 transition ${dc.btn} ` +
        (selected
          ? "border-sky-500/80 bg-sky-950/35 text-white ring-1 ring-sky-500/40"
          : "border-zinc-800 bg-zinc-950/70 hover:border-sky-700/70 hover:text-white")
      }
      style={{ borderLeftColor: pastel.borderColor }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-zinc-100">{m.name}</span>
        <span
          className={
            `shrink-0 rounded-full border ${dc.badge} ` +
            (m.status === "free"
              ? "border-emerald-700/60 bg-emerald-950/40 text-emerald-200"
              : m.status === "off"
                ? "border-zinc-700 bg-zinc-900 text-zinc-400"
                : "border-amber-700/60 bg-amber-950/40 text-amber-200")
          }
        >
          {m.status === "free"
            ? t("publicBook.masterStatusFree")
            : m.status === "off"
              ? t("publicBook.masterStatusOff")
              : t("publicBook.masterStatusBusy")}
        </span>
      </div>
      <div className={dc.meta}>
        {m.workTime}
        {m.status === "free" && m.earliestFreeLabel && (
          <>
            {" · "}
            <span className="text-emerald-400/95">
              {t("publicBook.masterEarliestSlot", { time: m.earliestFreeLabel })}
            </span>
            {" · "}
            {t("publicBook.masterFreeSlotsCount", { count: m.freeSlots })}
          </>
        )}
        {m.status === "busy" && (
          <span className="text-zinc-600">
            {" · "}
            {t("publicBook.masterNoSlotsToday")}
          </span>
        )}
      </div>
    </button>
  );
}

export function PublicBookingMastersSection({
  t,
  hairMasters,
  nailMasters,
  selectedStaffId,
  onPickMaster,
  density = "compact",
  mastersLayout = "two_columns",
  staffById,
  staffColorAssignments,
}: MastersProps) {
  const emptyBoth = hairMasters.length === 0 && nailMasters.length === 0;
  const sectionPad =
    density === "comfortable"
      ? "p-4 md:p-6"
      : density === "dense"
        ? "p-3 md:p-4"
        : "p-4 md:p-5";
  const gridGap = density === "dense" ? "gap-3 md:gap-4" : "gap-4 md:gap-5";
  const colGap = density === "dense" ? "space-y-1.5" : "space-y-2";
  const gridClass =
    mastersLayout === "single_column"
      ? `mt-4 grid ${gridGap} md:mx-auto md:max-w-xl md:grid-cols-1`
      : `mt-4 grid ${gridGap} md:grid-cols-2`;

  return (
    <section className={`rounded-xl border border-zinc-800 bg-black/30 ${sectionPad}`}>
      <h2 className="text-sm font-semibold text-white">{t("publicBook.mastersTitle")}</h2>
      <p className="mt-1 text-xs text-zinc-500">{t("publicBook.mastersHint")}</p>
      {emptyBoth ? (
        <p className="mt-3 text-xs text-zinc-600">{t("publicBook.mastersEmpty")}</p>
      ) : (
        <div className={gridClass}>
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              {t("publicBook.mastersHair")}
            </h3>
            <div className={`mt-2 ${colGap}`}>
              {hairMasters.length > 0 ? (
                hairMasters.map((m) => (
                  <MasterDayCard
                    key={m.id}
                    m={m}
                    selected={selectedStaffId === m.id}
                    onPick={() => onPickMaster(m.id)}
                    density={density}
                    staffById={staffById}
                    staffColorAssignments={staffColorAssignments}
                  />
                ))
              ) : (
                <p className="text-xs text-zinc-600">{t("publicBook.mastersColumnEmpty")}</p>
              )}
            </div>
          </div>
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              {t("publicBook.mastersNails")}
            </h3>
            <div className={`mt-2 ${colGap}`}>
              {nailMasters.length > 0 ? (
                nailMasters.map((m) => (
                  <MasterDayCard
                    key={m.id}
                    m={m}
                    selected={selectedStaffId === m.id}
                    onPick={() => onPickMaster(m.id)}
                    density={density}
                    staffById={staffById}
                    staffColorAssignments={staffColorAssignments}
                  />
                ))
              ) : (
                <p className="text-xs text-zinc-600">{t("publicBook.mastersColumnEmpty")}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

type BookingProps = {
  t: TFunction;
  i18n: i18n;
  isReceptionMode: boolean;
  serviceId: string;
  setServiceId: Dispatch<SetStateAction<string | null>>;
  setStaffId: Dispatch<SetStateAction<string | null>>;
  services: PublicServiceMini[];
  staffId: string | null;
  ANY_MASTER_ID: string;
  slots: Slot[];
  slotCoverage: Map<string, number>;
  pickedStart: Date | null;
  setPickedStart: Dispatch<SetStateAction<Date | null>>;
  clientName: string;
  setClientName: Dispatch<SetStateAction<string>>;
  clientPhone: string;
  setClientPhone: Dispatch<SetStateAction<string>>;
  booking: boolean;
  confirmBook: () => void;
  eligibleStaff: StaffMember[];
  highlightServiceIds: Set<string>;
  /** Объединение услуг всех мастеров панели — в списке услуг не показываем весь салон. */
  panelServiceIds: Set<string>;
  /** Подпись к слоту: кто свободен в это время (для «любой мастер»). */
  slotStaffLabelsByStart: Map<string, string>;
  onPickEarliestAcrossMasters: () => void;
  earliestAcrossMastersLabel: string | null;
};

export function PublicBookingBookingSection({
  t,
  i18n,
  isReceptionMode,
  serviceId,
  setServiceId,
  setStaffId,
  services,
  staffId,
  ANY_MASTER_ID,
  slots,
  slotCoverage,
  pickedStart,
  setPickedStart,
  clientName,
  setClientName,
  clientPhone,
  setClientPhone,
  booking,
  confirmBook,
  eligibleStaff,
  highlightServiceIds,
  panelServiceIds,
  slotStaffLabelsByStart,
  onPickEarliestAcrossMasters,
  earliestAcrossMastersLabel,
}: BookingProps) {
  const activeServices = services.filter((s) => s.active);
  const salonWidePool =
    panelServiceIds.size > 0 ? activeServices.filter((s) => panelServiceIds.has(s.id)) : activeServices;
  const masterChosen = staffId !== ANY_MASTER_ID && staffId != null;
  const masterHasLinks = masterChosen && highlightServiceIds.size > 0;
  const narrowedForMaster = masterHasLinks
    ? salonWidePool.filter((s) => highlightServiceIds.has(s.id))
    : null;
  const canFilter = narrowedForMaster != null && narrowedForMaster.length > 0;
  let selectServices = canFilter ? narrowedForMaster : salonWidePool;
  let listIsFiltered = canFilter;
  if (serviceId && !selectServices.some((s) => s.id === serviceId)) {
    selectServices = salonWidePool;
    listIsFiltered = false;
  }
  const showStarInOption = masterHasLinks && !listIsFiltered;

  return (
    <div className="space-y-4">
      <label className="block text-sm">
        <span className="text-zinc-400">{t("modal.service")}</span>
        <select
          value={serviceId}
          onChange={(e) => {
            setServiceId(e.target.value ? String(e.target.value) : null);
            setStaffId(ANY_MASTER_ID);
            setPickedStart(null);
          }}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-white md:py-2.5"
        >
          <option value="">{t("modal.pickService")}</option>
          {selectServices.map((s) => {
            const mark = showStarInOption && highlightServiceIds.has(s.id);
            return (
              <option key={s.id} value={s.id}>
                {mark ? `★ ${s.name}` : s.name}
              </option>
            );
          })}
        </select>
        {listIsFiltered && (
          <p className="mt-1 text-xs text-emerald-400/85">{t("publicBook.masterServicesFiltered")}</p>
        )}
        {masterHasLinks && !listIsFiltered && (
          <p className="mt-1 text-xs text-emerald-400/85">{t("publicBook.masterServicesMarked")}</p>
        )}
        {panelServiceIds.size > 0 && !masterChosen && (
          <p className="mt-1 text-xs text-zinc-500">{t("publicBook.servicesLimitedToPanel")}</p>
        )}
      </label>

      <div>
        <p className="text-sm text-zinc-400">{t("publicBook.slots")}</p>
        {staffId === ANY_MASTER_ID && (
          <p className="mt-1 text-xs text-zinc-500">{t("publicBook.slotsAnyMasterHint")}</p>
        )}
        {staffId === ANY_MASTER_ID && earliestAcrossMastersLabel && (
          <button
            type="button"
            onClick={() => onPickEarliestAcrossMasters()}
            className="mt-2 rounded-lg border border-emerald-700/50 bg-emerald-950/35 px-3 py-2 text-left text-xs font-medium text-emerald-100 transition hover:border-emerald-500/60 hover:bg-emerald-950/50"
          >
            {t("publicBook.pickEarliestSlot", { time: earliestAcrossMastersLabel })}
          </button>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {slots.map((s) => {
            const key = s.start.toISOString();
            const freeCount = slotCoverage.get(key) || 0;
            const who = slotStaffLabelsByStart.get(key) || "";
            return (
              <button
                key={key}
                type="button"
                onClick={() => setPickedStart(s.start)}
                className={`max-w-[min(100%,20rem)] rounded-lg border px-3 py-2 text-left text-sm md:px-4 md:py-2.5 ${
                  pickedStart?.getTime() === s.start.getTime()
                    ? "border-sky-500 bg-sky-950/50 text-white"
                    : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                }`}
              >
                <span className="block font-medium">{formatSlotRange(s)}</span>
                {staffId === ANY_MASTER_ID && freeCount > 0 && who ? (
                  <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                    {t("publicBook.slotWhoFree", { names: who, count: freeCount })}
                  </span>
                ) : staffId === ANY_MASTER_ID && freeCount > 0 ? (
                  <span className="mt-0.5 block text-[11px] text-zinc-500">
                    {t("publicBook.slotFreeCount", { count: freeCount })}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {slots.length === 0 && <p className="mt-2 text-xs text-zinc-600">{t("publicBook.noSlots")}</p>}
      </div>

      <label className="block text-sm">
        <span className="text-zinc-400">Мастер (по желанию)</span>
        <select
          value={staffId ?? ANY_MASTER_ID}
          onChange={(e) => {
            setStaffId(e.target.value || ANY_MASTER_ID);
            setPickedStart(null);
          }}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-white md:py-2.5"
        >
          <option value={ANY_MASTER_ID}>Любой свободный мастер</option>
          {eligibleStaff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      {pickedStart && (
        <div className="space-y-3 rounded-xl border border-zinc-800 bg-black/40 p-4">
          <p className="text-sm text-zinc-400">
            {pickedStart.toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" })}
          </p>
          <input
            placeholder={isReceptionMode ? "Имя клиента (необязательно)" : (t("modal.client") as string)}
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm"
          />
          <input
            placeholder={isReceptionMode ? "Телефон (необязательно)" : (t("modal.phone") as string)}
            value={clientPhone}
            onChange={(e) => setClientPhone(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={booking}
            onClick={() => void confirmBook()}
            className="w-full rounded-lg bg-sky-600 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {t("publicBook.confirm")}
          </button>
        </div>
      )}
    </div>
  );
}
