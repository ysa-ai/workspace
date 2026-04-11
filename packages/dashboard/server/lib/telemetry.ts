// Server-side anonymous telemetry — fires from all self-hosted installs.
// Opt out: set YSA_TELEMETRY_DISABLED=1 or DO_NOT_TRACK=1 in your environment.
// What is collected: anonymous instance ID + event name + timestamp. No PII, no user data.

const POSTHOG_KEY = "phc_sBtMfQgBUFDkwuH5w2bfLLQm8hbQaGsXXGKcDPzijO2";
const POSTHOG_HOST = "https://eu.i.posthog.com";

const disabled =
  process.env.YSA_TELEMETRY_DISABLED === "1" ||
  process.env.DO_NOT_TRACK === "1" ||
  process.env.NODE_ENV === "test" ||
  process.env.CI === "true";

let instanceId: string | null = null;

async function getInstanceId(): Promise<string> {
  if (instanceId) return instanceId;
  const { db } = await import("../db");
  const { appSettings } = await import("../db/schema");
  const { eq } = await import("drizzle-orm");
  const { randomBytes } = await import("crypto");

  const row = (await db.select().from(appSettings).where(eq(appSettings.key, "instance_id")))[0];
  if (row) {
    instanceId = row.value;
    return instanceId;
  }

  instanceId = randomBytes(16).toString("hex");
  await db.insert(appSettings).values({ key: "instance_id", value: instanceId }).onConflictDoNothing();
  return instanceId;
}

export async function telemetry(event: string, props?: Record<string, unknown>) {
  if (disabled) return;
  try {
    const id = await getInstanceId();
    await fetch(`${POSTHOG_HOST}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: POSTHOG_KEY,
        event,
        distinct_id: id,
        properties: { ...props, $lib: "ysa-server" },
      }),
    });
  } catch {}
}
