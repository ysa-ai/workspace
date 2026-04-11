import posthog from "posthog-js";

const key = "phc_ohNHDTAvug4KMQzQko5f6joX4YhxCW9CjFbecVUZGvx3";
const disabled = import.meta.env.VITE_TELEMETRY_DISABLED === "1";
const doNotTrack = typeof navigator !== "undefined" ? navigator.doNotTrack === "1" : false;

export function initAnalytics() {
  if (disabled || doNotTrack) return;
  posthog.init(key, {
    api_host: "https://eu.i.posthog.com",
    autocapture: false,
    capture_pageview: false,
    persistence: "localStorage",
  });
}

export function track(event: string, props?: Record<string, unknown>) {
  if (disabled || doNotTrack) return;
  posthog.capture(event, props);
}

export function identify(userId: string, props: Record<string, unknown>) {
  if (disabled) return;
  posthog.identify(userId, props);
}

export function resetIdentity() {
  if (disabled) return;
  posthog.reset();
}
