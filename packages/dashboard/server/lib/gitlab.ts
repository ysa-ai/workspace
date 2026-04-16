export async function fetchGitlabProjectId(issueUrlTemplate: string, token: string | null | undefined): Promise<number | null> {
  if (!issueUrlTemplate || !token) return null;
  try {
    const url = new URL(issueUrlTemplate.replace("{id}", "0"));
    const parts = url.pathname.split("/-/");
    if (parts.length < 2) return null;
    const projectPath = parts[0].replace(/^\//, "");
    if (!projectPath) return null;
    const apiUrl = `${url.protocol}//${url.hostname}/api/v4/projects/${encodeURIComponent(projectPath)}`;
    const res = await fetch(apiUrl, { headers: { "PRIVATE-TOKEN": token }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json() as { id?: number };
    return data.id ?? null;
  } catch {
    return null;
  }
}
