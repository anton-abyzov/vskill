// ---------------------------------------------------------------------------
// vskill info -- display detailed information about a skill
// ---------------------------------------------------------------------------

import { getSkill } from "../api/client.js";
import type { SkillDetail } from "../api/client.js";
import { fetchUpstreamDeprecations, formatDeprecation, readDeprecation, type SkillDeprecation } from "../lib/deprecation.js";
import { isPrivateSkillName } from "../lib/private-source.js";
import { bold, green, red, yellow, dim, cyan, spinner } from "../utils/output.js";

function getTrustLabel(tier: string): string {
  switch (tier) {
    case "T0": return "Blocked";
    case "T1": return "Unscanned";
    case "T2": return "Basic";
    case "T3": return "Verified";
    case "T4": return "Certified";
    default: return "Unknown";
  }
}

function getTrustColor(tier: string): (s: string) => string {
  switch (tier) {
    case "T0": return red;
    case "T1": return yellow;
    case "T2": return cyan;
    case "T3": return green;
    case "T4": return green;
    default: return dim;
  }
}

/**
 * 1486: the deprecation a registry skill declares. The SKILL.md the registry
 * returns comes first, then the source's current SKILL.md on GitHub, then
 * the platform's own SkillVersion.deprecated flag. Null when none says so.
 */
export async function resolveInfoDeprecation(
  detail: SkillDetail,
): Promise<{ deprecation: SkillDeprecation } | { platformMessage: string } | null> {
  const fromContent = readDeprecation(detail.content);
  if (fromContent) return { deprecation: fromContent };
  const repo = detail.repoUrl?.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/);
  if (repo && detail.skillPath) {
    const found = await fetchUpstreamDeprecations(detail.name, {
      version: detail.version,
      sha: "",
      tier: detail.tier,
      installedAt: "",
      source: `github:${repo[1]}/${repo[2]}`,
      sourceSkillPath: detail.skillPath,
    });
    if (found[0]) return { deprecation: found[0].deprecation };
  }
  if (detail.deprecated) return { platformMessage: detail.deprecationMsg || "This skill is deprecated." };
  return null;
}

export async function infoCommand(skillName: string): Promise<void> {
  // Registry details live on verified-skill.com, which never hears about a
  // skill from a private (or unconfirmed) repo.
  if (await isPrivateSkillName(skillName)) {
    console.log(
      dim(`${skillName} comes from a private repository; it has no verified-skill.com listing.`),
    );
    return;
  }
  const spin = spinner("Looking up skill");

  try {
    const detail = await getSkill(skillName);
    spin.stop(green(`Found: ${detail.name}`));

    console.log("");
    console.log(`  ${bold("Name:")}        ${detail.name}`);
    console.log(`  ${bold("Author:")}      ${detail.author}`);
    console.log(`  ${bold("Description:")} ${detail.description}`);
    console.log(`  ${bold("Version:")}     ${detail.version}`);
    console.log(`  ${bold("Installs:")}    ${detail.installs}`);
    console.log(`  ${bold("Updated:")}     ${detail.updatedAt}`);

    if (detail.repoUrl) {
      console.log(`  ${bold("Repository:")}  ${detail.repoUrl}`);
    }

    // Certification tier
    console.log(`  ${bold("Cert Tier:")}   ${detail.tier} (score: ${detail.score}/100)`);

    // Trust tier and score
    if (detail.trustTier) {
      const color = getTrustColor(detail.trustTier);
      console.log(
        `  ${bold("Trust Tier:")}  ${color(`${detail.trustTier} (${getTrustLabel(detail.trustTier)})`)}` +
          (detail.trustScore != null ? ` ${dim(`score ${detail.trustScore}/100`)}` : ""),
      );
    } else {
      console.log(`  ${bold("Trust Tier:")}  ${dim("not available")}`);
    }

    // Provenance verification
    if (detail.provenanceVerified != null) {
      const provLabel = detail.provenanceVerified
        ? green("Verified")
        : yellow("Not verified");
      console.log(`  ${bold("Provenance:")}  ${provLabel}`);
    }

    const deprecated = await resolveInfoDeprecation(detail).catch(() => null);
    if (deprecated) {
      const shortName = detail.name.slice(detail.name.lastIndexOf("/") + 1);
      const line = "deprecation" in deprecated
        ? formatDeprecation(shortName, deprecated.deprecation)
        : `${shortName} is deprecated: ${deprecated.platformMessage}`;
      console.log(`  ${bold("Deprecated:")}  ${yellow(line)}`);
    }

    console.log("");
  } catch {
    spin.stop();
    console.error(
      red(`Skill "${skillName}" not found in registry.\n`) +
        dim(`Use ${cyan("vskill find <query>")} to search.`),
    );
    process.exit(1);
  }
}
