import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type ReceptionRows,
  type ReceptionSectionId,
  mergeRowWithNext,
  receptionRowSortableId,
  splitPairedRow,
  swapCellsInRow,
} from "../lib/receptionLayout";

function reorderRows(rows: ReceptionRows, from: number, to: number): ReceptionRows {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) {
    return rows;
  }
  const copy = rows.map((r) => [...r]);
  const [removed] = copy.splice(from, 1);
  copy.splice(to, 0, removed!);
  return copy;
}

function RowCard({
  rowIndex,
  rowCount,
  cells,
  disabled,
  compact,
  canMergeWithNext,
  onMergeWithNext,
  onSplit,
  onSwap,
  onMoveRow,
  dragIndex,
  setDragIndex,
  onReorderDrop,
}: {
  rowIndex: number;
  rowCount: number;
  cells: ReceptionSectionId[];
  disabled: boolean;
  compact: boolean;
  canMergeWithNext: boolean;
  onMergeWithNext: () => void;
  onSplit: () => void;
  onSwap: () => void;
  onMoveRow: (delta: number) => void;
  dragIndex: number | null;
  setDragIndex: (i: number | null) => void;
  onReorderDrop: (from: number, to: number) => void;
}) {
  const { t } = useTranslation();
  const rowId = receptionRowSortableId(cells);
  const dragging = dragIndex === rowIndex;

  const onDragStart = useCallback(
    (e: React.DragEvent) => {
      if (disabled) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/reception-row", String(rowIndex));
      setDragIndex(rowIndex);
    },
    [disabled, rowIndex, setDragIndex],
  );

  const onDragEnd = useCallback(() => {
    setDragIndex(null);
  }, [setDragIndex]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData("text/reception-row");
      const from = Number.parseInt(raw, 10);
      if (!Number.isFinite(from)) return;
      onReorderDrop(from, rowIndex);
      setDragIndex(null);
    },
    [onReorderDrop, rowIndex, setDragIndex],
  );

  return (
    <div
      data-row-id={rowId}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={
        `rounded-xl border border-zinc-700/80 bg-zinc-900/50 ` +
        (compact ? "p-2.5" : "p-3") +
        (dragging ? " opacity-60 ring-2 ring-sky-500/35" : "")
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            draggable={!disabled}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            disabled={disabled}
            className={
              `cursor-grab touch-none rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-xs ` +
              `text-zinc-400 hover:bg-zinc-800 active:cursor-grabbing disabled:opacity-30`
            }
            aria-label={t("reception.layout.editor.dragHandle")}
          >
            ⠿
          </button>
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              disabled={disabled || rowIndex === 0}
              onClick={() => onMoveRow(-1)}
              className="rounded border border-zinc-700 px-1.5 py-0 text-[10px] leading-tight text-zinc-500 hover:bg-zinc-800 disabled:opacity-25"
              aria-label={t("reception.layout.moveUp")}
            >
              ↑
            </button>
            <button
              type="button"
              disabled={disabled || rowIndex >= rowCount - 1}
              onClick={() => onMoveRow(1)}
              className="rounded border border-zinc-700 px-1.5 py-0 text-[10px] leading-tight text-zinc-500 hover:bg-zinc-800 disabled:opacity-25"
              aria-label={t("reception.layout.moveDown")}
            >
              ↓
            </button>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {cells.map((sid) => (
            <span
              key={sid}
              className={
                `rounded-lg border border-zinc-600/80 bg-black/30 px-2.5 py-1 ` +
                (compact ? "text-xs" : "text-sm") +
                ` text-zinc-200`
              }
            >
              {t(`reception.layout.block.${sid}`)}
            </span>
          ))}
        </div>
      </div>
      <div className={`mt-2 flex flex-wrap gap-2 ${compact ? "text-[11px]" : "text-xs"}`}>
        {cells.length === 2 && (
          <>
            <button
              type="button"
              disabled={disabled}
              onClick={onSplit}
              className="rounded border border-zinc-600 px-2 py-1 text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
            >
              {t("reception.layout.editor.splitRow")}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={onSwap}
              className="rounded border border-zinc-600 px-2 py-1 text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
            >
              {t("reception.layout.editor.swapColumns")}
            </button>
          </>
        )}
        {cells.length === 1 && canMergeWithNext && (
          <button
            type="button"
            disabled={disabled}
            onClick={onMergeWithNext}
            className="rounded border border-emerald-700/50 px-2 py-1 text-emerald-200/90 hover:bg-emerald-950/40 disabled:opacity-30"
          >
            {t("reception.layout.editor.mergeWithNext")}
          </button>
        )}
      </div>
    </div>
  );
}

export function ReceptionLayoutEditor({
  rows,
  onChange,
  disabled,
  variant = "full",
}: {
  rows: ReceptionRows;
  onChange: (next: ReceptionRows) => void;
  disabled?: boolean;
  variant?: "full" | "compact";
}) {
  const { t } = useTranslation();
  const compact = variant === "compact";
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const onReorderDrop = useCallback(
    (from: number, to: number) => {
      if (from === to) return;
      onChange(reorderRows(rows, from, to));
    },
    [rows, onChange],
  );

  return (
    <div className="space-y-3">
      {!compact && <p className="text-xs text-zinc-500">{t("reception.layout.editor.intro")}</p>}
      <div className="space-y-2">
        {rows.map((cells, index) => (
          <RowCard
            key={receptionRowSortableId(cells)}
            rowIndex={index}
            rowCount={rows.length}
            cells={[...cells]}
            disabled={!!disabled}
            compact={compact}
            canMergeWithNext={
              index < rows.length - 1 && cells.length === 1 && rows[index + 1]!.length === 1
            }
            onMergeWithNext={() => onChange(mergeRowWithNext(rows, index))}
            onSplit={() => onChange(splitPairedRow(rows, index))}
            onSwap={() => onChange(swapCellsInRow(rows, index))}
            onMoveRow={(delta) => {
              const j = index + delta;
              if (j < 0 || j >= rows.length) return;
              onChange(reorderRows(rows, index, j));
            }}
            dragIndex={dragIndex}
            setDragIndex={setDragIndex}
            onReorderDrop={onReorderDrop}
          />
        ))}
      </div>
    </div>
  );
}
