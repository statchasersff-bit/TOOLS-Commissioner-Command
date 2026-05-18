// Shared fetch wrapper that forwards the StatChasers auth token. The token
// lives in localStorage under the same key AuthContext uses.

import { API_BASE } from "@/lib/apiBase";

const SC_TOKEN_KEY = "sc_auth_token";

function getStoredToken(): string | null {
  try { return localStorage.getItem(SC_TOKEN_KEY); } catch { return null; }
}

export function scAuthHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function scAuthFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
    ...scAuthHeaders(),
  };
  return fetch(url, {
    credentials: "include",
    ...init,
    headers,
  });
}
