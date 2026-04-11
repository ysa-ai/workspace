function extractIdsFromSection(body: string, pattern: RegExp): number[] {
  const match = pattern.exec(body);
  if (!match) return [];
  const after = body.slice(match.index + match[0].length);
  const nextHeader = after.search(/^#{1,3}\s/m);
  const section = nextHeader >= 0 ? after.slice(0, nextHeader) : after;
  return [...section.matchAll(/#(\d+)/g)]
    .filter((m) => {
      // Skip lines that are checked/resolved: "- [x]" before the #id
      const lineStart = section.lastIndexOf("\n", m.index!) + 1;
      const linePrefix = section.slice(lineStart, m.index);
      return !/^\s*-\s*\[x\]/i.test(linePrefix);
    })
    .map((m) => parseInt(m[1]));
}

/** Returns issue IDs that block this issue ("Depends on" / "Blocked by" sections + inline) */
export function parseBlockedBy(body: string | null | undefined): number[] {
  if (!body) return [];
  const ids = new Set<number>();
  for (const pattern of [
    /^#{1,3}\s*depends?\s+on\s*$/im,
    /^#{1,3}\s*blocked?\s+by\s*$/im,
    /^#{1,3}\s*dependencies\s*$/im,
  ]) {
    for (const id of extractIdsFromSection(body, pattern)) ids.add(id);
  }
  for (const m of body.matchAll(/(?:blocked?\s+by|depends?\s+on)\s+#(\d+)/gi)) ids.add(parseInt(m[1]));
  return [...ids];
}

/** Returns issue IDs that this issue blocks ("Blocks" section) */
export function parseBlocks(body: string | null | undefined): number[] {
  if (!body) return [];
  return extractIdsFromSection(body, /^#{1,3}\s*blocks?\s*$/im);
}

/**
 * Build a map of issueId → blocker IDs from a list of issues with bodies.
 * Only marks an issue as blocked if the blocker is in the same open set.
 */
export function buildBlockedByMap(issues: { id: number; body: string | null | undefined }[]): Map<number, number[]> {
  const openIds = new Set(issues.map((i) => i.id));
  const map = new Map<number, number[]>();

  for (const issue of issues) {
    for (const blockerId of parseBlockedBy(issue.body)) {
      if (openIds.has(blockerId)) {
        const arr = map.get(issue.id) ?? [];
        if (!arr.includes(blockerId)) arr.push(blockerId);
        map.set(issue.id, arr);
      }
    }
    for (const blockedId of parseBlocks(issue.body)) {
      if (openIds.has(blockedId)) {
        const arr = map.get(blockedId) ?? [];
        if (!arr.includes(issue.id)) arr.push(issue.id);
        map.set(blockedId, arr);
      }
    }
  }

  return map;
}

interface ApiConfig {
  issueUrlTemplate: string;
  issueSource: string;
  issueSourceToken: string | null;
}

function buildApiContext(cfg: ApiConfig): { issueUrl: (id: number) => string; headers: Record<string, string> } | null {
  const tpl = cfg.issueUrlTemplate;
  if (!tpl || !cfg.issueSourceToken) return null;
  try {
    const url = new URL(tpl.replace("{id}", "0"));
    if (cfg.issueSource === "github") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length < 2) return null;
      const [owner, repo] = parts;
      return {
        issueUrl: (id) => `https://api.github.com/repos/${owner}/${repo}/issues/${id}`,
        headers: { Authorization: `Bearer ${cfg.issueSourceToken}`, Accept: "application/vnd.github+json" },
      };
    } else {
      const pathParts = url.pathname.split("/-/");
      if (pathParts.length < 2) return null;
      const projectPath = encodeURIComponent(pathParts[0].replace(/^\//, ""));
      return {
        issueUrl: (id) => `${url.protocol}//${url.hostname}/api/v4/projects/${projectPath}/issues/${id}`,
        headers: { "PRIVATE-TOKEN": cfg.issueSourceToken! },
      };
    }
  } catch {
    return null;
  }
}

async function fetchIssueData(ctx: ReturnType<typeof buildApiContext>, issueId: number, issueSource: string): Promise<{ body: string | null; open: boolean } | null> {
  if (!ctx) return null;
  try {
    const res = await fetch(ctx.issueUrl(issueId), { headers: ctx.headers });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const body: string | null = issueSource === "github" ? (data.body ?? null) : (data.description ?? null);
    const open: boolean = data.state === "open" || data.state === "opened";
    return { body, open };
  } catch {
    return null;
  }
}

/**
 * Fetches the issue from the API and returns the IDs of any active blockers.
 *
 * GitHub: parses body text; lines with "- [x]" prefix are considered resolved.
 * GitLab: uses the native issue links API (link_type "is_blocked_by").
 */
export async function checkOpenBlockers(cfg: ApiConfig, issueId: number): Promise<number[]> {
  const ctx = buildApiContext(cfg);
  if (!ctx) return [];

  if (cfg.issueSource === "github") {
    const issueData = await fetchIssueData(ctx, issueId, "github");
    if (!issueData) return [];
    // parseBlockedBy already skips "- [x]" lines (resolved references)
    return parseBlockedBy(issueData.body);
  } else {
    // GitLab: use native issue links API
    try {
      const res = await fetch(`${ctx.issueUrl(issueId)}/links`, { headers: ctx.headers });
      if (!res.ok) return [];
      const links = (await res.json()) as any[];
      return links
        .filter((l: any) => l.link_type === "is_blocked_by" && (l.state === "open" || l.state === "opened"))
        .map((l: any) => l.iid);
    } catch {
      return [];
    }
  }
}

/**
 * Marks a blocker reference as resolved in a GitHub issue body.
 * Turns "- #28 ..." or "- [ ] #28 ..." into "- [x] ~~#28 ...~~".
 */
function markBlockerResolved(body: string, blockerId: number): string {
  const ref = `#${blockerId}`;
  return body
    .split("\n")
    .map((line) => {
      if (!line.includes(ref)) return line;
      if (/^\s*-\s*\[x\]/i.test(line)) return line; // already resolved
      // "- [ ] #28 ..." or "- #28 ..." → "- [x] ~~#28 ...~~"
      return line.replace(/^(\s*-\s*)(?:\[\s*\]\s*)?(.+)$/, (_, prefix, rest) => {
        return `${prefix}[x] ~~${rest.trim()}~~`;
      });
    })
    .join("\n");
}

/**
 * After an issue is finalized, unblocks any issues that were waiting on it.
 *
 * GitHub: PATCHes each blocked issue's body to mark the reference as resolved.
 * GitLab: DELETEs the blocking issue links from the resolved issue.
 */
export async function unblockDependents(cfg: ApiConfig, resolvedIssueId: number): Promise<void> {
  const ctx = buildApiContext(cfg);
  if (!ctx) return;

  if (cfg.issueSource === "github") {
    const issueData = await fetchIssueData(ctx, resolvedIssueId, "github");
    if (!issueData) return;
    const blockedIds = parseBlocks(issueData.body);
    for (const blockedId of blockedIds) {
      try {
        const blockedData = await fetchIssueData(ctx, blockedId, "github");
        if (!blockedData?.body) continue;
        const newBody = markBlockerResolved(blockedData.body, resolvedIssueId);
        if (newBody === blockedData.body) continue;
        await fetch(ctx.issueUrl(blockedId), {
          method: "PATCH",
          headers: { ...ctx.headers, "Content-Type": "application/json" },
          body: JSON.stringify({ body: newBody }),
        });
      } catch {
        // best-effort
      }
    }
  } else {
    // GitLab: delete all "blocks" links from the resolved issue
    try {
      const res = await fetch(`${ctx.issueUrl(resolvedIssueId)}/links`, { headers: ctx.headers });
      if (!res.ok) return;
      const links = (await res.json()) as any[];
      for (const link of links.filter((l: any) => l.link_type === "blocks")) {
        try {
          await fetch(`${ctx.issueUrl(resolvedIssueId)}/links/${link.link_id}`, {
            method: "DELETE",
            headers: ctx.headers,
          });
        } catch {
          // best-effort
        }
      }
    } catch {
      // best-effort
    }
  }
}
