import { Fragment, type ReactNode } from "react";
import type { ReceptionRows, ReceptionSectionId } from "./receptionLayout";

/** Две колонки: для пары календарь+ближайшие — прежние пропорции, иначе равные колонки. */
function pairGridClass(a: ReceptionSectionId, b: ReceptionSectionId): string {
  const asymmetric =
    (a === "calendar" && b === "upcoming") || (a === "upcoming" && b === "calendar");
  return asymmetric
    ? "grid gap-4 md:grid-cols-[1.45fr_1fr] md:gap-5"
    : "grid gap-4 md:grid-cols-2 md:gap-5";
}

export function renderReceptionRows(
  rows: ReceptionRows,
  sections: Record<ReceptionSectionId, ReactNode | null>,
): ReactNode {
  const chunks: ReactNode[] = [];
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i]!;
    if (cells.length === 2) {
      const [a, b] = cells;
      const left = sections[a];
      const right = sections[b];
      if (left != null || right != null) {
        chunks.push(
          <div key={`${a}|${b}-${i}`} className={pairGridClass(a, b)}>
            {left}
            {right}
          </div>,
        );
      }
    } else {
      const id = cells[0]!;
      const one = sections[id];
      if (one != null) chunks.push(<Fragment key={`${id}-${i}`}>{one}</Fragment>);
    }
  }
  return <>{chunks}</>;
}
