// ---------------------------------------------------------------------------
// vskill submit -- open browser for skill submission via GitHub OAuth
// ---------------------------------------------------------------------------

import { openBrowser } from "../utils/browser.js";
import { bold, green, red, dim, cyan } from "../utils/output.js";
import { validateRepoSegment, validateSkillName } from "../utils/validation.js";

interface SubmitOptions {
  skill?: string;
}

export async function submitCommand(
  source: string,
  opts: SubmitOptions
): Promise<void> {
  // Parse owner/repo
  const parts = source.split("/");
  if (parts.length !== 2) {
    console.error(
      red("Invalid source format. Use: ") + cyan("owner/repo")
    );
    process.exit(1);
  }

  const [owner, repo] = parts;

  if (!validateRepoSegment(owner) || !validateRepoSegment(repo)) {
    console.error(
      red("Invalid owner/repo name. ") + dim("Only letters, numbers, dots, hyphens, and underscores are allowed.")
    );
    process.exit(1);
  }

  if (opts.skill && !validateSkillName(opts.skill)) {
    console.error(
      red("Invalid skill name. ") + dim("Path traversal patterns are not allowed.")
    );
    process.exit(1);
  }

  const submitUrl = new URL("https://verified-skill.com/submit");
  submitUrl.searchParams.set("repo", `${owner}/${repo}`);
  if (opts.skill) {
    submitUrl.searchParams.set("skill", opts.skill);
  }
  const url = submitUrl.toString();

  console.log(dim(`Opening browser to submit ${bold(`${owner}/${repo}`)} for verification...\n`));

  try {
    await openBrowser(url);
    console.log(green("Browser opened!\n"));
    console.log(`Complete your submission in the browser at:`);
    console.log(cyan(url));
    console.log(dim("\nYou will authenticate with GitHub and complete the submission there."));
  } catch (err) {
    console.error(
      red("Could not open browser: ") +
        dim((err as Error).message)
    );
    console.log(`\nOpen this URL manually in your browser:`);
    console.log(cyan(url));
  }
}
