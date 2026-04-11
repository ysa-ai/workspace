import { pollResourceMetrics } from "@ysa-ai/shared";
import type { ResourceUpdate } from "@ysa-ai/shared";

export function startResourceMonitor(
  sendFn: (msg: ResourceUpdate) => void,
  intervalMs = 10_000,
): () => void {
  let timer: Timer | null = null;

  const poll = async () => {
    try {
      const metrics = await pollResourceMetrics();
      sendFn({
        type: "resource_update",
        containers: metrics.containers,
        aggregate: metrics.aggregate,
        host: metrics.host,
        capacity: null,
        completed_peaks: metrics.completed_peaks,
        warnings: metrics.warnings,
      });
    } catch {
      // Silently skip — podman may not be running
    }
  };

  poll();
  timer = setInterval(poll, intervalMs);

  return () => {
    if (timer) clearInterval(timer);
  };
}
