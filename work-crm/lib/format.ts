export function formatEurFromCents(cents: number): string {
  const n = Number(cents) || 0;
  return new Intl.NumberFormat("et-EE", { style: "currency", currency: "EUR" }).format(n / 100);
}
