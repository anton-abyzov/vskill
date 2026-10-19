// ---------------------------------------------------------------------------
// 0932: the install-time gate over verified-skill.com's external security
// scans. The registry looks skills up by their full `owner/repo/skill` name;
// the bare skill name answered 404, so a CRITICAL finding could never block
// an install. Private repos are never looked up (the name must not leave the
// machine).
// ---------------------------------------------------------------------------

import { checkPlatformSecurity } from "../security/index.js";
import { getRepoVisibility, getRepoVisibilityFailure } from "./repo-visibility.js";
import { dim, red, yellow } from "../utils/output.js";

export interface PlatformSecurityGateArgs {
  owner: string;
  repo: string;
  skillName: string;
  privateRepo: boolean;
  force: boolean;
}

export type PlatformSecurityGateResult = "ok" | "blocked";

/** Registry identity of a GitHub skill. */
export function platformSkillName(owner: string, repo: string, skillName: string): string {
  return `${owner}/${repo}/${skillName}`;
}

/**
 * Look up the external scans for `owner/repo/skill` and report them.
 * Returns "blocked" when a provider found CRITICAL issues and --force is off.
 */
export async function platformSecurityGate(args: PlatformSecurityGateArgs): Promise<PlatformSecurityGateResult> {
  if (args.privateRepo) {
    // 0932: a repo GitHub would not describe (rate limit, outage) is only
    // treated as private; say why instead of calling it private.
    const ref = `${args.owner}/${args.repo}`;
    const failure = getRepoVisibility(ref) === "unknown" ? getRepoVisibilityFailure(ref) : undefined;
    const why =
      failure === "rate_limited"
        ? "GitHub API rate limit hit, visibility unconfirmed"
        : failure === "unavailable"
          ? "GitHub unavailable, visibility unconfirmed"
          : "Private repository";
    console.log(dim(`  ${why}: local security scan only.`));
    return "ok";
  }
  const report = await checkPlatformSecurity(platformSkillName(args.owner, args.repo, args.skillName));
  if (!report) {
    console.log(yellow("  Platform security check unavailable -- proceeding with local scan only."));
    return "ok";
  }
  if (report.hasCritical) {
    const providers = report.providers
      .filter((p) => p.status === "FAIL" && p.criticalCount > 0)
      .map((p) => p.provider);
    if (!args.force) {
      console.error(red("\n  BLOCKED: External security scan found CRITICAL findings"));
      if (providers.length > 0) console.error(red(`  Providers: ${providers.join(", ")}`));
      if (report.reportUrl) console.error(red(`  Report: https://verified-skill.com${report.reportUrl}`));
      console.error(dim("\n  Use --force to override (NOT recommended)"));
      return "blocked";
    }
    console.error(yellow("\n  WARNING: External scans found CRITICAL findings"));
    if (providers.length > 0) console.error(yellow(`  Providers: ${providers.join(", ")}`));
    console.error(yellow("  --force: proceeding despite CRITICAL findings\n"));
    return "ok";
  }
  if (report.overallVerdict === "PENDING") {
    console.log(dim("\n  External scans are pending. Proceeding with install.\n"));
  }
  return "ok";
}
