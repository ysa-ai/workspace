import type { ResourceMetrics } from "@ysa-ai/shared";
import { db } from "../db";
import { containerPeaks, tasks } from "../db/schema";
import { sql, eq } from "drizzle-orm";

const SAFETY_BUFFER_MB = 2048;

let latest: ResourceMetrics | null = null;
let lastUpdated = 0;

async function persistPeaks(peaks: ResourceMetrics["completed_peaks"]) {
  if (peaks.length === 0) return;
  for (const p of peaks) {
    // Resolve project_id from container name (format: "issue-<id>")
    let projectId: string | null = null;
    const match = p.name.match(/^sandbox-(\d+)/);
    if (match) {
      const row = (await db.select({ project_id: tasks.project_id })
        .from(tasks)
        .where(eq(tasks.task_id, parseInt(match[1]))))[0];
      projectId = row?.project_id ?? null;
    }
    await db.insert(containerPeaks).values({ name: p.name, peak_mb: p.peak_mb, project_id: projectId });
  }
}

async function computeCapacity(freeMb: number, projectId?: string | null): Promise<ResourceMetrics["capacity"]> {
  let row;
  if (projectId) {
    row = (await db
      .select({
        total: sql<number>`sum(peak_mb)`,
        count: sql<number>`count(*)`,
      })
      .from(containerPeaks)
      .where(eq(containerPeaks.project_id, projectId)))[0];
  } else {
    row = (await db
      .select({
        total: sql<number>`sum(peak_mb)`,
        count: sql<number>`count(*)`,
      })
      .from(containerPeaks))[0];
  }

  if (!row || row.count === 0) return null;
  const avg = Math.round(row.total / row.count);
  if (avg <= 0) return null;

  return {
    estimated_remaining: Math.max(0, Math.floor((freeMb - SAFETY_BUFFER_MB) / avg)),
    avg_peak_mb: avg,
  };
}

export async function setResourceMetrics(m: Omit<ResourceMetrics, "capacity">): Promise<void> {
  await persistPeaks(m.completed_peaks);
  const freeMb = m.host.mem_total_mb - m.host.mem_used_mb;
  latest = { ...m, capacity: await computeCapacity(freeMb) };
  lastUpdated = Date.now();
}

export async function getResourceMetrics(projectId?: string | null): Promise<{ metrics: ResourceMetrics | null; stale: boolean }> {
  if (!latest) return { metrics: null, stale: true };

  // Recompute capacity for the requested project
  if (projectId) {
    const freeMb = latest.host.mem_total_mb - latest.host.mem_used_mb;
    const projectMetrics = { ...latest, capacity: await computeCapacity(freeMb, projectId) };
    return { metrics: projectMetrics, stale: Date.now() - lastUpdated > 30_000 };
  }

  return { metrics: latest, stale: Date.now() - lastUpdated > 30_000 };
}
