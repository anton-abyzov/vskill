// Increment 0750: resolveSkillVersion
//
// Pure function. Picks a non-empty version string from three optional inputs
// using a fixed precedence chain and labels the source for downstream UI use.
//
//   frontmatter.version  >  registry.currentVersion  >  plugin.json.version  >  "1.0.0"
//
// Inputs that are null, undefined, empty, or fail semver validation are
// skipped. The resolver always returns a non-empty version string and a
// provenance label so the studio sidebar can render every skill consistently.
//
// Increment 0781: when `preferInstalled` is true and `installedCurrentVersion`
// is a valid semver, return it ahead of the frontmatter check. This lets the
// sidebar/right-panel match the Versions tab's [installed] marker for
// installed skills whose on-disk frontmatter has drifted past the version the
// user actually installed (lockfile / platform poll).

export type VersionSource = "frontmatter" | "registry" | "plugin" | "default";

export interface ResolveSkillVersionInput {
  frontmatterVersion?: string | null;
  registryCurrentVersion?: string | null;
  pluginVersion?: string | null;
  /** 0781: lockfile/platform-truth installed version. Used when `preferInstalled` is true. */
  installedCurrentVersion?: string | null;
  /** 0781: when true, prefer `installedCurrentVersion` over frontmatter. Set by callers for `origin === "installed"` skills. */
  preferInstalled?: boolean;
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
  // 0756: "0.0.0" is the studio's own placeholder for `/api/v1/skills/check-updates`
  // when it doesn't yet know a skill's version. The platform echoes it back as
  // `installed`, and mergeUpdatesIntoSkills writes it as registryCurrentVersion.
  // No real skill ships at 0.0.0 (submission pipeline defaults to 1.0.0 — incr 0728).
  // Treat it as absent so the chain falls through to pluginVersion or the default.
  if (trimmed === "0.0.0") return null;
  return trimmed;
}

export function resolveSkillVersion(
  input: ResolveSkillVersionInput,
): ResolveSkillVersionOutput {
  // 0781: for installed skills the lockfile/platform truth wins over the
  // on-disk frontmatter, which can drift after a save bumps the version
  // without an actual update.
  if (input.preferInstalled) {
    const inst = pick(input.installedCurrentVersion);
    if (inst) return { version: inst, versionSource: "registry" };
  }

  const fm = pick(input.frontmatterVersion);
  if (fm) return { version: fm, versionSource: "frontmatter" };

  const reg = pick(input.registryCurrentVersion);
  if (reg) return { version: reg, versionSource: "registry" };

  const plug = pick(input.pluginVersion);
  if (plug) return { version: plug, versionSource: "plugin" };

  return { version: "1.0.0", versionSource: "default" };
}
