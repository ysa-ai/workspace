export function normalizeResult(data: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...data };

  if (out.mergeRequestUrl && !out.mr_url) { out.mr_url = out.mergeRequestUrl; delete out.mergeRequestUrl; }
  if (out.pullRequestUrl && !out.mr_url) { out.mr_url = out.pullRequestUrl; delete out.pullRequestUrl; }
  if (out.pr_url && !out.mr_url) { out.mr_url = out.pr_url; delete out.pr_url; }
  if (out.commitHash && !out.commit_hash) { out.commit_hash = out.commitHash; delete out.commitHash; }
  if (out.commitMessage && !out.commit_message) { out.commit_message = out.commitMessage; delete out.commitMessage; }
  if (out.filesChanged && !out.files_changed) { out.files_changed = out.filesChanged; delete out.filesChanged; }
  if (Array.isArray(out.files_changed)) {
    out.files_changed = out.files_changed.map((f: any) =>
      typeof f === "string" ? f : (f?.path ?? f?.filename ?? f?.new_path ?? f?.name ?? JSON.stringify(f))
    );
  }
  if (out.testDetails && !out.test_details) { out.test_details = out.testDetails; delete out.testDetails; }
  if (out.sonarIssues != null && out.sonar_issues == null) { out.sonar_issues = out.sonarIssues; delete out.sonarIssues; }
  if (out.sonarCritical != null && out.sonar_critical == null) { out.sonar_critical = out.sonarCritical; delete out.sonarCritical; }
  if (out.commit && !out.commit_hash) { out.commit_hash = out.commit; delete out.commit; }

  if (Array.isArray(out.tests)) {
    const items = out.tests as { id?: string; status?: string }[];
    const anyFailed = items.some((t) => t.status === "failed");
    const allPassed = items.every((t) => t.status === "passed");
    const passed = items.filter((t) => t.status === "passed").length;
    const failed = items.filter((t) => t.status === "failed").length;
    out.test_details = out.test_details ?? `${passed} passed, ${failed} failed, ${items.length} total`;
    out.tests = anyFailed ? "failed" : allPassed ? "passed" : "unknown";
  }

  if (out.testResults && typeof out.testResults === "object" && !out.tests) {
    const tr = out.testResults as Record<string, number>;
    if (tr.failed != null) {
      out.tests = tr.failed === 0 ? "passed" : "failed";
    }
    if (tr.passed != null || tr.total != null) {
      out.test_details = [
        tr.passed != null ? `${tr.passed} passed` : null,
        tr.failed != null ? `${tr.failed} failed` : null,
        tr.total != null ? `${tr.total} total` : null,
      ].filter(Boolean).join(", ");
    }
    delete out.testResults;
  }

  return out;
}
