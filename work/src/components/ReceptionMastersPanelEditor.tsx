import { useTranslation } from "react-i18next";
import type {
  ReceptionMastersDensity,
  ReceptionMastersLayoutMode,
  ReceptionMastersPanelConfig,
} from "../lib/receptionLayout";
import type { StaffMember } from "../types/database";

function toggleId(ids: string[], id: string, on: boolean): string[] {
  const set = new Set(ids);
  if (on) set.add(id);
  else set.delete(id);
  return [...set];
}

export function ReceptionMastersPanelEditor({
  staff,
  config,
  onChange,
  disabled,
}: {
  staff: StaffMember[];
  config: ReceptionMastersPanelConfig;
  onChange: (next: ReceptionMastersPanelConfig) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const sorted = [...staff].sort((a, b) => a.name.localeCompare(b.name, "et"));

  function setAssignment(assignment: "auto" | "manual") {
    onChange({ ...config, assignment });
  }

  function setDensity(density: ReceptionMastersDensity) {
    onChange({ ...config, density });
  }

  function setMastersLayout(mastersLayout: ReceptionMastersLayoutMode) {
    onChange({ ...config, mastersLayout });
  }

  function toggleHair(id: string, checked: boolean) {
    onChange({ ...config, hairStaffIds: toggleId(config.hairStaffIds, id, checked) });
  }

  function toggleNails(id: string, checked: boolean) {
    onChange({ ...config, nailsStaffIds: toggleId(config.nailsStaffIds, id, checked) });
  }

  function moveInList(ids: string[], id: string, dir: -1 | 1): string[] {
    const i = ids.indexOf(id);
    if (i < 0) return ids;
    const j = i + dir;
    if (j < 0 || j >= ids.length) return ids;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  }

  function moveHair(id: string, dir: -1 | 1) {
    onChange({ ...config, hairStaffIds: moveInList(config.hairStaffIds, id, dir) });
  }

  function moveNails(id: string, dir: -1 | 1) {
    onChange({ ...config, nailsStaffIds: moveInList(config.nailsStaffIds, id, dir) });
  }

  return (
    <div className="space-y-4 rounded-xl border border-zinc-700/80 bg-zinc-950/40 p-3 md:p-4">
      <div>
        <p className="text-sm font-medium text-zinc-200">{t("reception.layout.masters.title")}</p>
        <p className="mt-1 text-xs text-zinc-500">{t("reception.layout.masters.subtitle")}</p>
        <p className="mt-1 text-xs text-zinc-600">{t("reception.layout.masters.crmServicesHint")}</p>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-zinc-400">{t("reception.layout.masters.assignment")}</p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["auto", t("reception.layout.masters.assignmentAuto")] as const,
              ["manual", t("reception.layout.masters.assignmentManual")] as const,
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => setAssignment(key)}
              className={
                `rounded-lg border px-2.5 py-1 text-xs md:text-sm ` +
                (config.assignment === key
                  ? "border-amber-500/50 bg-amber-950/35 text-amber-100"
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {config.assignment === "manual" && (
        <div className="space-y-2">
          <p className="text-[11px] text-zinc-600">{t("reception.layout.masters.orderHint")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
          <fieldset className="min-w-0 rounded-lg border border-zinc-800 p-2.5">
            <legend className="px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              {t("publicBook.mastersHair")}
            </legend>
            <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto pr-1">
              {sorted.map((m) => (
                <label
                  key={`h-${m.id}`}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-xs text-zinc-300 hover:bg-zinc-900/80"
                >
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={config.hairStaffIds.includes(m.id)}
                    onChange={(e) => toggleHair(m.id, e.target.checked)}
                    className="h-3.5 w-3.5 shrink-0 accent-amber-500"
                  />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  {config.hairStaffIds.includes(m.id) ? (
                    <span className="flex shrink-0 gap-0.5">
                      <button
                        type="button"
                        disabled={disabled}
                        title={t("reception.layout.moveUp")}
                        aria-label={t("reception.layout.moveUp")}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          moveHair(m.id, -1);
                        }}
                        className="rounded border border-zinc-700 px-1 py-px text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-40"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={disabled}
                        title={t("reception.layout.moveDown")}
                        aria-label={t("reception.layout.moveDown")}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          moveHair(m.id, 1);
                        }}
                        className="rounded border border-zinc-700 px-1 py-px text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-40"
                      >
                        ↓
                      </button>
                    </span>
                  ) : null}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="min-w-0 rounded-lg border border-zinc-800 p-2.5">
            <legend className="px-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              {t("publicBook.mastersNails")}
            </legend>
            <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto pr-1">
              {sorted.map((m) => (
                <label
                  key={`n-${m.id}`}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-xs text-zinc-300 hover:bg-zinc-900/80"
                >
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={config.nailsStaffIds.includes(m.id)}
                    onChange={(e) => toggleNails(m.id, e.target.checked)}
                    className="h-3.5 w-3.5 shrink-0 accent-amber-500"
                  />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  {config.nailsStaffIds.includes(m.id) ? (
                    <span className="flex shrink-0 gap-0.5">
                      <button
                        type="button"
                        disabled={disabled}
                        title={t("reception.layout.moveUp")}
                        aria-label={t("reception.layout.moveUp")}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          moveNails(m.id, -1);
                        }}
                        className="rounded border border-zinc-700 px-1 py-px text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-40"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={disabled}
                        title={t("reception.layout.moveDown")}
                        aria-label={t("reception.layout.moveDown")}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          moveNails(m.id, 1);
                        }}
                        className="rounded border border-zinc-700 px-1 py-px text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-40"
                      >
                        ↓
                      </button>
                    </span>
                  ) : null}
                </label>
              ))}
            </div>
          </fieldset>
          </div>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-xs font-medium text-zinc-400">{t("reception.layout.masters.density")}</p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["comfortable", t("reception.layout.masters.densityComfortable")] as const,
              ["compact", t("reception.layout.masters.densityCompact")] as const,
              ["dense", t("reception.layout.masters.densityDense")] as const,
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => setDensity(key)}
              className={
                `rounded-lg border px-2.5 py-1 text-xs ` +
                (config.density === key
                  ? "border-sky-500/50 bg-sky-950/30 text-sky-100"
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-500")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-zinc-400">{t("reception.layout.masters.columns")}</p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["two_columns", t("reception.layout.masters.columnsTwo")] as const,
              ["single_column", t("reception.layout.masters.columnsOne")] as const,
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => setMastersLayout(key)}
              className={
                `rounded-lg border px-2.5 py-1 text-xs ` +
                (config.mastersLayout === key
                  ? "border-sky-500/50 bg-sky-950/30 text-sky-100"
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-500")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
