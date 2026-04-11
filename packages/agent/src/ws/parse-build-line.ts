export function parseBuildLine(line: string): { step: string; progress?: number } | null {
  let m = line.match(/STEP\s+(\d+)\/(\d+):\s*(.*)/);
  if (m) {
    const pct = Math.round((parseInt(m[1]) / parseInt(m[2])) * 100);
    return { step: `STEP ${m[1]}/${m[2]} — ${m[3].slice(0, 55)}`, progress: pct };
  }
  m = line.match(/\((\d+)\/(\d+)\)\s+(.*)/);
  if (m) {
    return { step: `${m[3].slice(0, 60)} (${m[1]}/${m[2]})` };
  }
  m = line.match(/mise\s+(\S+)\s+\[(\d+)\/(\d+)\]\s+(.*)/);
  if (m) {
    const pct = Math.round((parseInt(m[2]) / parseInt(m[3])) * 100);
    return { step: `${m[1]} — ${m[4].slice(0, 50)} [${m[2]}/${m[3]}]`, progress: pct };
  }
  return null;
}
