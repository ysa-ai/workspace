import type { Context, Next } from "hono";

const counters = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(maxPerMinute: number) {
  return async (c: Context, next: Next) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    const key = `${c.req.path}:${ip}`;
    const now = Date.now();
    const entry = counters.get(key);
    if (!entry || entry.resetAt < now) {
      counters.set(key, { count: 1, resetAt: now + 60_000 });
    } else {
      entry.count++;
      if (entry.count > maxPerMinute) {
        return c.json({ error: "Too many requests" }, 429);
      }
    }
    await next();
  };
}
