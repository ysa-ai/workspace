export function buildAllowedToolsFromPreset(
  _preset: string,
  allowlist: string[] | null,
): string {
  return allowlist && allowlist.length > 0 ? allowlist.join(",") : "";
}
