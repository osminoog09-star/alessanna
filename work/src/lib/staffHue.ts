/** Stable hue (0–359) from staff id for calendar block colors (fallback). */
export function staffHueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

/**
 * Разносит оттенки по кругу HSL без коллизий, пока мастеров ≤ 360: сортировка по id,
 * затем равномерный шаг 360/n (стабильно между сеансами для того же состава staff).
 */
export function buildStaffHueMap(staffIds: Iterable<string>): Map<string, number> {
  const sorted = [...new Set(staffIds)].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const map = new Map<string, number>();
  const n = sorted.length;
  if (n === 0) return map;
  const golden = 137.50848946157;
  sorted.forEach((id, idx) => {
    const hue =
      n <= 360
        ? Math.round((idx * 360) / n) % 360
        : Math.round((idx * golden) % 360);
    map.set(id, hue);
  });
  return map;
}

export function staffHueFromMap(staffId: string, map: ReadonlyMap<string, number>): number {
  return map.get(staffId) ?? staffHueFromId(staffId);
}
