import { saveCredentials, clearCredentials } from "./credentials.js";
import { updateStoredToken } from "../ws/client.js";
import { DASHBOARD_URL } from "./url.js";
import { log } from "../logger.js";

function parseJwtExp(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

export function scheduleTokenRefresh(refreshToken: string, accessToken: string): void {
  const exp = parseJwtExp(accessToken);
  if (!exp) return;
  const delay = Math.max(exp * 1000 - Date.now() - 5 * 60 * 1000, 0);
  setTimeout(() => doRefresh(refreshToken), delay);
}

async function doRefresh(refreshToken: string): Promise<void> {
  const url = DASHBOARD_URL;
  try {
    const res = await fetch(`${url}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      log.warn("Token refresh failed (session invalidated) — clearing credentials. Run: ysa-agent login");
      await clearCredentials(url);
      return;
    }
    const tokens = await res.json() as { accessToken: string; refreshToken: string };
    await saveCredentials(url, tokens);
    updateStoredToken(tokens.accessToken);
    log.info("Token refreshed");
    scheduleTokenRefresh(tokens.refreshToken, tokens.accessToken);
  } catch {
    log.warn("Token refresh network error — retrying in 5 min");
    setTimeout(() => doRefresh(refreshToken), 5 * 60 * 1000);
  }
}
