// ---------------------------------------------------------------------------
// vskill pin / unpin -- version pinning for installed skills
// ---------------------------------------------------------------------------

import { readLockfile, writeLockfile } from "../lockfile/lockfile.js";
import { getVersions } from "../api/client.js";
import { parseSource } from "../resolvers/source-resolver.js";
import { bold, dim, cyan, red, green } from "../utils/output.js";

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

  // If a specific version is requested, validate it exists
  if (version) {
    const resolved = resolveFullName(skill, entry.source);
    const versions = await getVersions(resolved);
    const exists = versions.some((v) => v.version === version);
    if (!exists) {
      console.error(red(`Version ${version} not found for ${skill}.`));
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
    console.log(
      dim(`To install version ${pinVersion}, use: ${cyan(`vskill install ${skill}@${pinVersion}`)}`),
    );
  }
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
