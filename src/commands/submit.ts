// ---------------------------------------------------------------------------
// vskill submit -- open browser for skill submission via GitHub OAuth
// ---------------------------------------------------------------------------

import { openBrowser } from "../utils/browser.js";
import { bold, green, red, dim, cyan } from "../utils/output.js";
import { parseGitHubSource, validateSkillName } from "../utils/validation.js";

interface SubmitOptions {
  skill?: string;
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

  const submitUrl = new URL("https://verified-skill.com/submit");

  if (source) {
    const parsed = parseGitHubSource(source);
    if (!parsed) {
      console.error(
        red("Invalid source. Use: ") + cyan("owner/repo") + dim(" or ") + cyan("https://github.com/owner/repo")
      );
      process.exit(1);
    }
    const { owner, repo } = parsed;
    submitUrl.searchParams.set("repo", `${owner}/${repo}`);
    console.log(dim(`Opening browser to submit ${bold(`${owner}/${repo}`)} for verification...\n`));
  } else {
    console.log(dim("Opening browser to submit a skill for verification...\n"));
  }

  if (opts.skill) {
    submitUrl.searchParams.set("skill", opts.skill);
  }
  const url = submitUrl.toString();

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
