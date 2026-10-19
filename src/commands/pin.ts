// ---------------------------------------------------------------------------
// vskill pin / unpin -- version pinning for installed skills
// ---------------------------------------------------------------------------

import { readLockfile, writeLockfile } from "../lockfile/lockfile.js";
import { getVersions } from "../api/client.js";
import { parseSource } from "../resolvers/source-resolver.js";
import { isPrivateSource } from "../lib/private-source.js";
import { pinnedInstallCommand } from "../lib/registry-version.js";
import { bold, dim, cyan, red, green } from "../utils/output.js";
import type { SkillLockEntry } from "../lockfile/types.js";

function resolveFullName(name: string, source: string): string {
  if (name.includes("/")) return name;
  const parsed = parseSource(source);
  if (parsed.type === "github" || parsed.type === "github-plugin" || parsed.type === "marketplace") {
    return `${parsed.owner}/${parsed.repo}/${name}`;
  }
  return name;
}

export async function pinCommand(
  skill: string,
  version?: string,
): Promise<void> {
  const lock = readLockfile();
  if (!lock) {
    console.error(red("No vskill.lock found. Run ") + cyan("vskill install") + red(" first."));
    process.exit(1);
  }

  const entry = lock.skills[skill];
  if (!entry) {
    console.error(red(`Skill ${skill} is not installed.`));
    process.exit(1);
  }

  const pinVersion = version ?? entry.version;
  const privateSource = await isPrivateSource(entry);

  // If a specific version is requested, validate it exists — on the registry,
  // which never hears about skills from private (or unconfirmed) repos.
  if (version && privateSource) {
    console.log(
      dim(`${skill} comes from a private repository; ${version} was not checked against verified-skill.com.`),
    );
  } else if (version) {
    const resolved = resolveFullName(skill, entry.source);
    const versions = await getVersions(resolved);
    const exists = versions.some((v) => v.version === version);
    if (!exists) {
      console.error(red(`Version ${version} not found for ${skill}.`));
      if (versions.length > 0) {
        console.error(dim(`Available versions: ${versions.map((v) => v.version).join(", ")}`));
      }
      process.exit(1);
    }
  }

  entry.pinnedVersion = pinVersion;
  writeLockfile(lock);

  console.log(green(`Pinned ${bold(skill)} at ${bold(pinVersion)}`));
  if (version && version !== entry.version) {
    console.log(
      dim(`Note: installed version is ${entry.version}. Pin prevents future updates past ${pinVersion}.`),
    );
    const command = installCommandFor(skill, entry, pinVersion, privateSource);
    if (command) {
      console.log(dim(`To install version ${pinVersion}, use: ${cyan(command)}`));
    }
  }
}

/**
 * 0932: a command that really installs `skill` at `version`, or null when
 * there is none (a skill from a private GitHub repo has no registry versions).
 */
export function installCommandFor(
  skill: string,
  entry: SkillLockEntry,
  version: string,
  privateSource: boolean,
): string | null {
  if (entry.hostedPrivate) {
    return `vskill install --tenant ${entry.hostedPrivate.tenantSlug} ${entry.hostedPrivate.skillSlug} --version ${version}`;
  }
  if (privateSource) return null;
  const fullName = resolveFullName(skill, entry.source);
  if (fullName.split("/").length !== 3) return null;
  return pinnedInstallCommand(fullName, version);
}

export async function unpinCommand(skill: string): Promise<void> {
  const lock = readLockfile();
  if (!lock) {
    console.error(red("No vskill.lock found."));
    process.exit(1);
  }

  const entry = lock.skills[skill];
  if (!entry) {
    console.error(red(`Skill ${skill} is not installed.`));
    process.exit(1);
  }

  delete entry.pinnedVersion;
  writeLockfile(lock);

  console.log(green(`Unpinned ${bold(skill)}`));
}
