// ---------------------------------------------------------------------------
// 0932: resolve a published registry version of a public skill.
//
// verified-skill.com stores, per published version, the commit it scanned
// (gitSha) and the SKILL.md content hash. `vskill install owner/repo/skill@1.2.3`
// (or `--version 1.2.3`) installs the content of that commit instead of the
// repo's current HEAD, and `vskill pin` validates against the same list.
// ---------------------------------------------------------------------------

import { getVersions, type SkillVersionEntry } from "../api/client.js";
import { dim, red } from "../utils/output.js";

export interface RegistryVersion {
  version: string;
  gitSha: string | null;
  contentHash: string | null;
  certTier: string;
  createdAt: string;
}

export class RegistryVersionError extends Error {
  readonly available: string[];
  readonly code: "unknown_version" | "no_commit" | "unavailable";
  constructor(message: string, code: RegistryVersionError["code"], available: string[] = []) {
    super(message);
    this.name = "RegistryVersionError";
    this.code = code;
    this.available = available;
  }
}

const SEMVERISH = /^v?\d+(\.\d+){0,2}([-+][0-9A-Za-z.-]+)?$/;

/**
 * Split a trailing `@version` off an `owner/repo/skill@version` source.
 * Only a three-part, non-URL source with a version-like suffix is split, so
 * scoped names and URLs pass through unchanged.
 */
export function splitVersionSuffix(source: string): { source: string; version?: string } {
  if (source.includes("://")) return { source };
  const at = source.lastIndexOf("@");
  if (at <= 0) return { source };
  const base = source.slice(0, at);
  const version = source.slice(at + 1);
  if (base.split("/").length !== 3 || !SEMVERISH.test(version)) return { source };
  return { source: base, version: version.replace(/^v/, "") };
}

function toRegistryVersion(v: SkillVersionEntry): RegistryVersion {
  return {
    version: v.version,
    gitSha: v.gitSha && /^[0-9a-f]{7,40}$/i.test(v.gitSha) ? v.gitSha : null,
    contentHash: v.contentHash ?? null,
    certTier: v.certTier,
    createdAt: v.createdAt,
  };
}

/** Every published version of `owner/repo/skill`, newest first. Throws when the registry is unreachable. */
export async function listRegistryVersions(fullName: string): Promise<RegistryVersion[]> {
  const versions = await getVersions(fullName, { limit: 100 });
  return versions.filter((v) => v.version).map(toRegistryVersion);
}

/**
 * Resolve `version` of `owner/repo/skill` to the commit the registry scanned.
 * Throws RegistryVersionError for an unknown version (with the available
 * versions), a version without a recorded commit, or an unreachable registry.
 */
export async function resolveRegistryVersion(
  owner: string,
  repo: string,
  skill: string,
  version: string,
): Promise<RegistryVersion> {
  const fullName = `${owner}/${repo}/${skill}`;
  let versions: RegistryVersion[];
  try {
    versions = await listRegistryVersions(fullName);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      throw new RegistryVersionError(`${fullName} is not published on verified-skill.com.`, "unknown_version");
    }
    throw new RegistryVersionError(
      `Could not reach verified-skill.com to resolve ${fullName}@${version}: ${(err as Error).message}`,
      "unavailable",
    );
  }
  const wanted = version.replace(/^v/, "");
  const match = versions.find((v) => v.version === wanted);
  const available = versions.map((v) => v.version);
  if (!match) {
    throw new RegistryVersionError(`Version ${wanted} of ${fullName} is not published.`, "unknown_version", available);
  }
  if (!match.gitSha) {
    throw new RegistryVersionError(
      `Version ${wanted} of ${fullName} has no recorded commit on verified-skill.com, so it cannot be installed exactly.`,
      "no_commit",
      available,
    );
  }
  return match;
}

/**
 * resolveRegistryVersion for a CLI command: prints the reason (and the
 * available versions) and exits 1 when the version cannot be installed.
 */
export async function resolveRegistryVersionOrExit(
  owner: string,
  repo: string,
  skill: string,
  version: string,
): Promise<RegistryVersion> {
  try {
    return await resolveRegistryVersion(owner, repo, skill, version);
  } catch (err) {
    if (!(err instanceof RegistryVersionError)) throw err;
    console.error(red(err.message));
    if (err.available.length > 0) {
      console.error(dim(`Available versions: ${err.available.join(", ")}`));
    }
    return process.exit(1);
  }
}

/** The command that installs `fullName` at `version`. */
export function pinnedInstallCommand(fullName: string, version: string): string {
  return `vskill install ${fullName}@${version}`;
}
