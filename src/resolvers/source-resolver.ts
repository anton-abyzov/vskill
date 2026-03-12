// ---------------------------------------------------------------------------
// Source string parser for vskill lockfile entries.
// Parses the `source` field into a typed discriminated union for update routing.
// ---------------------------------------------------------------------------

export type ParsedSource =
  | { type: "registry"; skillName: string }
  | { type: "github"; owner: string; repo: string }
  | { type: "github-plugin"; owner: string; repo: string; pluginName: string }
  | { type: "marketplace"; owner: string; repo: string; pluginName: string }
  | { type: "local"; baseName: string }
  | { type: "unknown"; raw: string };

/**
 * Parse a lockfile `source` string into a typed discriminated union.
 *
 * Supported formats:
 *   "registry:skillName"
 *   "local:baseName"
 *   "marketplace:owner/repo#pluginName"
 *   "github:owner/repo"
 *   "github:owner/repo#plugin:pluginName"
 *   "" or unrecognized → { type: "unknown" }
 */
export function parseSource(source: string): ParsedSource {
  if (source.startsWith("registry:")) {
    return { type: "registry", skillName: source.slice("registry:".length) };
  }

  if (source.startsWith("local:")) {
    return { type: "local", baseName: source.slice("local:".length) };
  }

  if (source.startsWith("marketplace:")) {
    const rest = source.slice("marketplace:".length);
    const hashIdx = rest.indexOf("#");
    if (hashIdx === -1) return { type: "unknown", raw: source };
    const ownerRepo = rest.slice(0, hashIdx);
    const pluginName = rest.slice(hashIdx + 1);
    const slashIdx = ownerRepo.indexOf("/");
    if (slashIdx === -1) return { type: "unknown", raw: source };
    const owner = ownerRepo.slice(0, slashIdx);
    const repo = ownerRepo.slice(slashIdx + 1);
    if (!owner || !repo || !pluginName) return { type: "unknown", raw: source };
    return { type: "marketplace", owner, repo, pluginName };
  }

  if (source.startsWith("github:")) {
    const rest = source.slice("github:".length);
    const hashIdx = rest.indexOf("#");
    const ownerRepo = hashIdx === -1 ? rest : rest.slice(0, hashIdx);
    const slashIdx = ownerRepo.indexOf("/");
    if (slashIdx === -1) return { type: "unknown", raw: source };
    const owner = ownerRepo.slice(0, slashIdx);
    const repo = ownerRepo.slice(slashIdx + 1);
    if (!owner || !repo) return { type: "unknown", raw: source };

    if (hashIdx !== -1) {
      const fragment = rest.slice(hashIdx + 1);
      if (fragment.startsWith("plugin:")) {
        const pluginName = fragment.slice("plugin:".length);
        return { type: "github-plugin", owner, repo, pluginName };
      }
      // Unknown fragment type
      return { type: "unknown", raw: source };
    }

    return { type: "github", owner, repo };
  }

  return { type: "unknown", raw: source };
}
