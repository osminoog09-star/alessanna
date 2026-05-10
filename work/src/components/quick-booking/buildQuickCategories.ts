import type { QuickPublicService } from "../../hooks/useQuickBookingResources";

export type QuickCategoryCard = {
  id: string;
  title: string;
  emoji: string;
  serviceIds: string[];
};

function pickEmoji(categoryTitle: string, exampleServiceName: string): string {
  const blob = `${categoryTitle} ${exampleServiceName}`.toLowerCase();
  if (/маник|nail|гель|lakk|geel/i.test(blob)) return "💅";
  if (/педик|pedic|стоп|jalg/i.test(blob)) return "🦶";
  if (/бров|ресниц|kulm|ripsm/i.test(blob)) return "👁️";
  if (/стриж|барбер|бород|mehed|lõikus|juus/i.test(blob)) return "✂️";
  if (/окраш|värv|värvim|juuksevärv|color/i.test(blob)) return "🎨";
  if (/космет|facial|näo|massaa|массаж/i.test(blob)) return "✨";
  return "📋";
}

function stableId(title: string, idx: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || `cat-${idx}`;
}

/** Группирует услуги каталога по `categoryName` (или «Прочее») для больших карточек-категорий. */
export function buildQuickCategories(
  services: QuickPublicService[],
  otherLabel: string,
): QuickCategoryCard[] {
  const order: string[] = [];
  const groups = new Map<string, string[]>();
  for (const s of services) {
    if (!s.active) continue;
    const title = (s.categoryName?.trim() || "").length > 0 ? s.categoryName!.trim() : otherLabel;
    if (!groups.has(title)) {
      groups.set(title, []);
      order.push(title);
    }
    groups.get(title)!.push(s.id);
  }
  return order.map((title, idx) => {
    const serviceIds = groups.get(title) ?? [];
    const example = services.find((x) => serviceIds.includes(x.id));
    return {
      id: stableId(title, idx),
      title,
      emoji: pickEmoji(title, example?.name ?? ""),
      serviceIds,
    };
  });
}
