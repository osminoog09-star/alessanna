/** Staff login phone: national digits only (no country code), typical EE length. */
export const STAFF_LOGIN_PHONE_DIGITS_MIN = 8;
export const STAFF_LOGIN_PHONE_DIGITS_MAX = 10;

/** Keep only digits, cap length (input mask). */
export function filterStaffLoginPhoneInput(raw: string, maxLen = STAFF_LOGIN_PHONE_DIGITS_MAX): string {
  return raw.replace(/\D/g, "").slice(0, maxLen);
}

export function isValidStaffLoginPhoneDigits(digits: string): boolean {
  const n = digits.length;
  return n >= STAFF_LOGIN_PHONE_DIGITS_MIN && n <= STAFF_LOGIN_PHONE_DIGITS_MAX;
}
