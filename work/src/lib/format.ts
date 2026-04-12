export function eurFromCents(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

/** `earnings.amount` is stored as euros (numeric), not cents. */
export function eurFromEuroAmount(amount: number): string {
  return Number(amount).toFixed(2).replace(".", ",") + " €";
}
