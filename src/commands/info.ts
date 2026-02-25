// ---------------------------------------------------------------------------
// vskill info -- display detailed information about a skill
// ---------------------------------------------------------------------------

import { getSkill } from "../api/client.js";
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

export async function infoCommand(skillName: string): Promise<void> {
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
