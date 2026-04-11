export type BuildStatus = "idle" | "building" | "done" | "error";

export interface BuildState {
  status: BuildStatus;
  step: string;
  progress: number;
  error?: string;
}

const states = new Map<string, BuildState>();

export function getBuildState(projectId: string): BuildState {
  return states.get(projectId) ?? { status: "idle", step: "", progress: 0 };
}

export function updateBuildProgress(projectId: string, step: string, progress: number): void {
  const current = states.get(projectId);
  if (!current || current.status !== "building") return;
  states.set(projectId, {
    ...current,
    step,
    progress: progress >= current.progress ? progress : current.progress,
  });
}

export function startBuild(
  projectId: string,
  run: () => Promise<{ ok: boolean; error?: string }>,
): void {
  states.set(projectId, { status: "building", step: "Starting…", progress: 0 });
  run().then((result) => {
    const current = states.get(projectId)!;
    states.set(projectId, {
      status: result.ok ? "done" : "error",
      step: result.ok ? "Done" : (result.error ?? "Build failed"),
      progress: result.ok ? 100 : current.progress,
      error: result.error,
    });
  }).catch((err) => {
    const current = states.get(projectId)!;
    states.set(projectId, { status: "error", step: String(err), progress: current.progress, error: String(err) });
  });
}
