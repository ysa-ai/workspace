const ACCESS_KEY = "ysa_access_token";
const REFRESH_KEY = "ysa_refresh_token";

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export async function tryRefresh(): Promise<string | null> {
  const refresh = localStorage.getItem(REFRESH_KEY);
  if (!refresh) return null;
  try {
    const res = await fetch("/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    if (!res.ok) {
      // Only clear tokens on explicit auth rejection (401/403), not server errors
      if (res.status === 401 || res.status === 403) clearTokens();
      return null;
    }
    const data = await res.json();
    setTokens(data.accessToken, data.refreshToken);
    return data.accessToken;
  } catch {
    // Network error — do not clear tokens, user may still have a valid session
    return null;
  }
}
