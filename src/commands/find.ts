// ---------------------------------------------------------------------------
// vskill find -- search the verified-skill.com registry
// ---------------------------------------------------------------------------

import type { SkillSearchResult } from "../api/client.js";
import { searchSkills } from "../api/client.js";
import { bold, dim, cyan, yellow, green, red, link, formatInstalls } from "../utils/output.js";
import { extractBaseRepo, formatSkillId, getSkillUrl, getTrustBadge } from "../utils/skill-display.js";

interface FindOptions {
  json?: boolean;
  noHint?: boolean;
  limit?: number;
}

export async function findCommand(query: string, opts?: FindOptions): Promise<void> {
  console.log(dim(`Searching for "${query}"...\n`));

  let results: SkillSearchResult[];
  let hasMore = false;
  try {
    const response = await searchSkills(query, { limit: opts?.limit });
    results = response.results;
    hasMore = response.hasMore;
  } catch (err) {
    console.error(
      red("Failed to search registry: ") +
        dim((err as Error).message)
    );
    process.exit(1);
    return;
  }

  if (results.length === 0) {
    console.log(dim("No skills found matching your query."));
    console.log(
      dim(`Try a broader search or visit ${cyan("https://verified-skill.com")}`)
    );
    return;
  }

  // Sort: blocked at end, then by relevance score, then cert tier, then stars
  results.sort((a, b) => {
    if (a.isBlocked && !b.isBlocked) return 1;
    if (!a.isBlocked && b.isBlocked) return -1;
    const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    const certRank = (t: string | undefined) => t === "CERTIFIED" ? 0 : t === "VERIFIED" ? 1 : 2;
    const certDiff = certRank(a.certTier) - certRank(b.certTier);
    if (certDiff !== 0) return certDiff;
    return (b.githubStars ?? 0) - (a.githubStars ?? 0);
  });

  // JSON output mode
  if (opts?.json) {
    const enriched = results.map((r) => ({
      ...r,
      vskillInstalls: r.vskillInstalls ?? 0,
    }));
    console.log(JSON.stringify(enriched, null, 2));
    return;
  }

  const blockedCount = results.filter((r) => r.isBlocked).length;

  // ---------- TTY display: flat two-line entries ----------------------------
  if (process.stdout.isTTY) {
    for (const r of results) {
      const label = formatSkillId(r);
      const url = getSkillUrl(r);

      if (r.isBlocked) {
        const parts = [r.severity, r.threatType].filter(Boolean);
        const threatInfo = parts.length > 0 ? parts.join(" | ") : "blocked";
        console.log(`${red(bold(label))}  ${red("BLOCKED")}  ${red(threatInfo)}`);
      } else {
        const stars = r.githubStars ?? 0;
        const starsStr = `\u2605${formatInstalls(stars)}`;
        const badge = getTrustBadge(r.certTier, r.trustTier);
        const pluginBadge = r.pluginName ? dim(` [${r.pluginName}]`) : "";
        console.log(`${bold(label)}${pluginBadge}  ${dim(starsStr)}${badge ? "  " + badge : ""}`);
      }

      console.log(`  ${link(url, cyan(url))}`);
      if (r.alternateRepos) {
        const altLabels = r.alternateRepos.map((a) => `${a.ownerSlug}/${a.repoSlug}`).join(", ");
        console.log(`  ${dim("also: " + altLabels)}`);
      }
      console.log();
    }

    // Footer
    if (hasMore) {
      console.log(dim(`Use --limit N for more (up to 30)`));
    } else {
      console.log(dim(`${results.length} result${results.length === 1 ? "" : "s"} found.`));
    }

    if (blockedCount > 0) {
      console.log(
        red(
          `\n  ${blockedCount} BLOCKED skill${blockedCount === 1 ? "" : "s"} \u2014 known malicious, installation will be refused`
        )
      );
    }

    // Install hint — show exact skill path, then suggest full repo for more
    if (!opts?.noHint) {
      const firstInstallable = results.find((r) => !r.isBlocked);
      if (firstInstallable) {
        const skillId = formatSkillId(firstInstallable);
        const repo = extractBaseRepo(firstInstallable.repoUrl);
        console.log(dim("\nInstall: ") + cyan(`npx vskill i ${skillId}`));
        if (repo && repo !== skillId) {
          console.log(dim("  More from this repo: ") + cyan(`npx vskill i ${repo}`));
        }
      }
    }

    return;
  }

  // ---------- Non-TTY (piped) — tab-separated flat lines --------------------
  for (const r of results) {
    const name = r.name;
    const repo = extractBaseRepo(r.repoUrl) ?? "";
    if (r.isBlocked) {
      console.log(`${name}\t${repo}\tBLOCKED`);
    } else {
      const altRepos = r.alternateRepos?.map((a) => `${a.ownerSlug}/${a.repoSlug}`).join(",") ?? "";
      const tierOut = r.certTier ?? r.trustTier ?? "";
      console.log(`${name}\t${repo}\t${r.githubStars ?? 0}\t${tierOut}\t${r.pluginName ?? ""}\t${altRepos}`);
    }
  }

  const pipeCountText = `${results.length} result${results.length === 1 ? "" : "s"} found`;
  console.log(`\n${pipeCountText}${hasMore ? " (more available)" : ""}`);

  if (blockedCount > 0) {
    console.log(
      `\n  ${blockedCount} BLOCKED skill${blockedCount === 1 ? "" : "s"} \u2014 known malicious, installation will be refused`
    );
  }

  if (!opts?.noHint) {
    const firstInstallable = results.find((r) => !r.isBlocked);
    if (firstInstallable) {
      const skillId = formatSkillId(firstInstallable);
      const repo = extractBaseRepo(firstInstallable.repoUrl);
      console.log(`\nInstall: npx vskill i ${skillId}`);
      if (repo && repo !== skillId) {
        console.log(`  More from this repo: npx vskill i ${repo}`);
      }
    }
  }
}
