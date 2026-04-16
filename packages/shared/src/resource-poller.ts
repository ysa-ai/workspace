import { cpus } from "os";
import type { ContainerMetrics, ContainerPeak, ResourceMetrics } from "./protocol";

const WARN_MEM_PCT = 85;
const WARN_DISK_GB = 5;

const isDarwin = process.platform === "darwin";

// Per-container peak tracking (in-memory while running)
const peakByContainer = new Map<string, number>();
let previousNames = new Set<string>();

// CPU: store last snapshot for delta calculation — no subprocess needed
let lastCpuSnapshot: { idle: number; total: number } | null = null;

// Memory: cache total RAM (never changes at runtime)
let cachedTotalMemMb: number | null = null;

// Podman machine state cache — skip expensive SSH calls when machine is stopped
let podmanMachineRunning: boolean | null = null;
let podmanMachineCheckedAt = 0;
const PODMAN_MACHINE_TTL_MS = 60_000;

async function exec(cmd: string): Promise<string> {
  const proc = Bun.spawn(["sh", "-c", cmd], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

async function execTimeout(cmd: string, ms: number): Promise<string | null> {
  return Promise.race([
    exec(cmd),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function getCpuSnapshot(): { idle: number; total: number } {
  let idle = 0, total = 0;
  for (const cpu of cpus()) {
    for (const [key, val] of Object.entries(cpu.times)) {
      total += val;
      if (key === "idle") idle += val;
    }
  }
  return { idle, total };
}

function getHostCpuPct(): number {
  const snap = getCpuSnapshot();
  let pct = 0;
  if (lastCpuSnapshot) {
    const dTotal = snap.total - lastCpuSnapshot.total;
    const dIdle = snap.idle - lastCpuSnapshot.idle;
    if (dTotal > 0) pct = Math.round(((dTotal - dIdle) / dTotal) * 1000) / 10;
  }
  lastCpuSnapshot = snap;
  return pct;
}

async function isPodmanMachineRunning(): Promise<boolean> {
  const now = Date.now();
  if (podmanMachineRunning !== null && now - podmanMachineCheckedAt < PODMAN_MACHINE_TTL_MS) {
    return podmanMachineRunning;
  }
  const raw = await execTimeout("podman machine list --format '{{.Running}}' 2>/dev/null", 2000);
  podmanMachineRunning = raw?.includes("true") ?? false;
  podmanMachineCheckedAt = now;
  return podmanMachineRunning;
}

async function getContainerNames(): Promise<string[]> {
  const raw = await exec("podman ps --format '{{.Names}}' 2>/dev/null");
  if (!raw) return [];
  return raw
    .split("\n")
    .filter((n) => n.startsWith("sandbox-") || n.startsWith("bench-"));
}

async function getContainerStats(names: string[]): Promise<ContainerMetrics[]> {
  if (names.length === 0) return [];
  const raw = await exec(
    `podman stats --no-stream --format '{{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}\\t{{.PIDs}}' ${names.join(" ")} 2>/dev/null`,
  );
  if (!raw) return [];

  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, cpuRaw, memRaw, pidsRaw] = line.split("\t");
      const cpu_pct = parseFloat(cpuRaw?.replace("%", "") || "0") || 0;
      const pids = parseInt(pidsRaw?.trim() || "0", 10) || 0;

      let mem_mb = 0;
      if (memRaw) {
        const match = memRaw.match(/([\d.]+)\s*(GiB|GB|MiB|MB|KiB|KB)/i);
        if (match) {
          const val = parseFloat(match[1]);
          const unit = match[2].toLowerCase();
          if (unit.startsWith("g")) mem_mb = Math.round(val * 1024);
          else if (unit.startsWith("k")) mem_mb = Math.round(val / 1024);
          else mem_mb = Math.round(val);
        }
      }

      return { name, cpu_pct, mem_mb, pids };
    });
}

async function getHostMemory(): Promise<{ used_mb: number; total_mb: number; mem_source: "vm" | "host" }> {
  if (isDarwin) {
    if (await isPodmanMachineRunning()) {
      const vmRaw = await execTimeout("podman machine ssh -- free -m 2>/dev/null", 3000);
      if (vmRaw) {
        const match = vmRaw.match(/^Mem:\s+(\d+)\s+(\d+)/m);
        if (match) {
          return { total_mb: parseInt(match[1], 10), used_mb: parseInt(match[2], 10), mem_source: "vm" };
        }
      }
    }

    if (cachedTotalMemMb === null) {
      const totalRaw = await exec("sysctl -n hw.memsize");
      cachedTotalMemMb = Math.round(parseInt(totalRaw, 10) / 1024 / 1024);
    }
    const vmStatRaw = await exec("vm_stat");
    const pageSize = parseInt(vmStatRaw.match(/page size of (\d+)/)?.[1] || "16384", 10);
    const get = (label: string) => {
      const m = vmStatRaw.match(new RegExp(`${label}:\\s+(\\d+)`));
      return parseInt(m?.[1] || "0", 10);
    };
    const active = get("Pages active");
    const wired = get("Pages wired down");
    const compressed = get("Pages occupied by compressor");
    const used_mb = Math.round(((active + wired + compressed) * pageSize) / 1024 / 1024);
    return { used_mb, total_mb: cachedTotalMemMb, mem_source: "host" };
  }

  const raw = await exec("free -m 2>/dev/null");
  const match = raw.match(/^Mem:\s+(\d+)\s+(\d+)/m);
  if (!match) return { used_mb: 0, total_mb: 0, mem_source: "host" };
  return { used_mb: parseInt(match[2], 10), total_mb: parseInt(match[1], 10), mem_source: "host" };
}

async function getDiskFreeGb(): Promise<number> {
  if (isDarwin) {
    if (await isPodmanMachineRunning()) {
      const vmRaw = await execTimeout("podman machine ssh -- df -BG / 2>/dev/null", 3000);
      if (vmRaw) {
        const match = vmRaw.match(/\n\S+\s+\S+\s+\S+\s+(\d+)G/);
        if (match) return parseInt(match[1], 10);
      }
    }
    const raw = await exec(`df -g "${process.env.HOME || "/"}" 2>/dev/null`);
    const match = raw.match(/\n\S+\s+\d+\s+\d+\s+(\d+)/);
    return parseInt(match?.[1] || "0", 10);
  }
  const raw = await exec(`df -BG "${process.env.HOME || "/"}" 2>/dev/null`);
  const match = raw.match(/\n\S+\s+\S+\s+\S+\s+(\d+)G/);
  return parseInt(match?.[1] || "0", 10);
}

export async function pollResourceMetrics(): Promise<Omit<ResourceMetrics, "capacity">> {
  const [names, hostMem, diskFreeGb] = await Promise.all([
    getContainerNames(),
    getHostMemory(),
    getDiskFreeGb(),
  ]);

  const hostCpu = getHostCpuPct();

  const containers = await getContainerStats(names);
  const currentNames = new Set(names);

  // Update peaks for running containers
  for (const c of containers) {
    const prev = peakByContainer.get(c.name) ?? 0;
    if (c.mem_mb > prev) peakByContainer.set(c.name, c.mem_mb);
  }

  // Detect removed containers → collect their peaks
  const completed_peaks: ContainerPeak[] = [];
  for (const name of previousNames) {
    if (!currentNames.has(name)) {
      const peak = peakByContainer.get(name);
      if (peak && peak > 0) {
        completed_peaks.push({ name, peak_mb: peak });
      }
      peakByContainer.delete(name);
    }
  }
  previousNames = currentNames;

  const aggregate = {
    count: containers.length,
    total_cpu_pct: Math.round(containers.reduce((s, c) => s + c.cpu_pct, 0) * 10) / 10,
    total_mem_mb: containers.reduce((s, c) => s + c.mem_mb, 0),
  };

  const mem_pct = hostMem.total_mb > 0
    ? Math.round((hostMem.used_mb * 100) / hostMem.total_mb)
    : 0;

  const host = {
    cpu_pct: hostCpu,
    mem_used_mb: hostMem.used_mb,
    mem_total_mb: hostMem.total_mb,
    mem_pct,
    disk_free_gb: diskFreeGb,
    mem_source: hostMem.mem_source,
  };

  const warnings: string[] = [];
  if (mem_pct >= WARN_MEM_PCT) warnings.push("memory_high");
  if (diskFreeGb < WARN_DISK_GB) warnings.push("disk_low");

  return { containers, aggregate, host, completed_peaks, warnings };
}
