// ---------------------------------------------------------------------------
// vskill submit -- submit skill for verification via API or browser fallback
// ---------------------------------------------------------------------------

import { openBrowser } from "../utils/browser.js";
import { submitSkill, getSubmission } from "../api/client.js";
import { bold, green, red, dim, cyan, yellow } from "../utils/output.js";
import { parseGitHubSource, validateSkillName } from "../utils/validation.js";

interface SubmitOptions {
  skill?: string;
  browser?: boolean;
  path?: string;
}

export async function submitCommand(
  source: string | undefined,
  opts: SubmitOptions
): Promise<void> {
  if (opts.skill && !validateSkillName(opts.skill)) {
    console.error(
      red("Invalid skill name. ") + dim("Path traversal patterns are not allowed.")
    );
    process.exit(1);
  }

  if (!source) {
    console.error(red("Source required. ") + dim("Use: vskill submit owner/repo --skill name"));
    process.exit(1);
  }

  const parsed = parseGitHubSource(source);
  if (!parsed) {
    console.error(
      red("Invalid source. Use: ") + cyan("owner/repo") + dim(" or ") + cyan("https://github.com/owner/repo")
    );
    process.exit(1);
  }

  const { owner, repo } = parsed;
  const repoUrl = `https://github.com/${owner}/${repo}`;

  // --browser flag: use browser-based OAuth flow
  if (opts.browser) {
    const submitUrl = new URL("https://verified-skill.com/submit");
    submitUrl.searchParams.set("repo", `${owner}/${repo}`);
    if (opts.skill) submitUrl.searchParams.set("skill", opts.skill);
    const url = submitUrl.toString();

    console.log(dim(`Opening browser to submit ${bold(`${owner}/${repo}`)} for verification...\n`));
    try {
      await openBrowser(url);
      console.log(green("Browser opened!\n"));
      console.log(`Complete your submission in the browser at:`);
      console.log(cyan(url));
    } catch (err) {
      console.error(red("Could not open browser: ") + dim((err as Error).message));
      console.log(`\nOpen this URL manually:\n${cyan(url)}`);
    }
    return;
  }

  // Default: programmatic API submission (no browser needed)
  console.log(dim(`Submitting ${bold(opts.skill || repo)} from ${owner}/${repo}...\n`));

  try {
    const response = await submitSkill({
      repoUrl,
      skillName: opts.skill,
      skillPath: opts.path,
      source: "cli-submit",
    });

    if (response.blocked) {
      console.error(red("Blocked: ") + dim("This skill is on the blocklist."));
      process.exit(1);
    }

    if (response.alreadyVerified) {
      console.log(green("Already verified! ") + dim("Skill is up-to-date in the registry."));
      if (response.id) console.log(dim(`Submission: ${response.id}`));
      return;
    }

    if (response.duplicate) {
      console.log(yellow("Duplicate: ") + dim("An identical submission is already pending."));
      if (response.submissionId) console.log(dim(`Existing submission: ${response.submissionId}`));
      return;
    }

    console.log(green("Submitted! ") + dim(`ID: ${response.id}`));
    console.log(dim(`State: ${response.state}`));
    console.log(dim("\nThe skill will go through tier-1 and tier-2 scanning."));
    console.log(dim(`Check status: vskill info ${opts.skill || repo}`));
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("429") || msg.includes("rate")) {
      console.error(red("Rate limited. ") + dim("Try again in a few minutes, or use --browser for OAuth."));
    } else {
      console.error(red("Submission failed: ") + dim(msg));
      console.log(dim("\nFallback: use --browser to submit via GitHub OAuth."));
    }
    process.exit(1);
  }
}
