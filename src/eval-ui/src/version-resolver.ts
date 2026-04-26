// Increment 0750: resolveSkillVersion
//
// Pure function. Picks a non-empty version string from three optional inputs
// using a fixed precedence chain and labels the source for downstream UI use.
//
//   frontmatter.version  >  registry.currentVersion  >  plugin.json.version  >  "0.0.0"
//
// Inputs that are null, undefined, empty, or fail semver validation are
// skipped. The resolver always returns a non-empty version string and a
// provenance label so the studio sidebar can render every skill consistently.

export type VersionSource = "frontmatter" | "registry" | "plugin" | "default";

export interface ResolveSkillVersionInput {
  frontmatterVersion?: string | null;
  registryCurrentVersion?: string | null;
  pluginVersion?: string | null;
}

export interface ResolveSkillVersionOutput {
  version: string;
  versionSource: VersionSource;
}

// Lightweight semver check — major.minor.patch with optional pre-release/build
// metadata. We only need to filter junk values; we do not need full semver
// parsing because the value flows straight to display.
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function pick(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!SEMVER_RE.test(trimmed)) return null;
  return trimmed;
}

export function resolveSkillVersion(
  input: ResolveSkillVersionInput,
): ResolveSkillVersionOutput {
  const fm = pick(input.frontmatterVersion);
  if (fm) return { version: fm, versionSource: "frontmatter" };

  const reg = pick(input.registryCurrentVersion);
  if (reg) return { version: reg, versionSource: "registry" };

  const plug = pick(input.pluginVersion);
  if (plug) return { version: plug, versionSource: "plugin" };

  return { version: "0.0.0", versionSource: "default" };
}
