export const TOKEN_KEY = "alessanna_access_token";

function apiBase(): string {
  if (typeof window === "undefined") return "";
  return process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
}

/** Absolute or same-origin API path (for mobile confirm page, QR scan URL, etc.). */
export function apiUrl(path: string): string {
  if (path.startsWith("http")) return path;
  const base = apiBase();
  return `${base}${path}`;
}

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = apiBase();
  const url = path.startsWith("http") ? path : `${base}${path}`;
  const headers = new Headers(init?.headers);
  const token = getStoredToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(url, {
    ...init,
    headers,
    credentials: "include",
  });
}
