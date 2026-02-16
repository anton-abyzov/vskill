// ---------------------------------------------------------------------------
// vskill submit -- submit a skill for verification
// ---------------------------------------------------------------------------

import { submitSkill } from "../api/client.js";
import { bold, green, red, dim, cyan } from "../utils/output.js";

interface SubmitOptions {
  email?: string;
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
  const repoUrl = `https://github.com/${owner}/${repo}`;

  console.log(dim(`Submitting ${bold(`${owner}/${repo}`)} for verification...\n`));

  try {
    const result = await submitSkill({
      repoUrl,
      skillName: repo,
      email: opts.email,
    });

    console.log(green("Submission received!\n"));
    console.log(`${bold("Submission ID:")} ${result.id}`);
    console.log(`${bold("Status:")}        ${result.status}`);
    console.log(
      `${bold("Track at:")}      ${cyan(result.trackingUrl || `https://verified-skill.com/submissions/${result.id}`)}`
    );
    console.log(
      dim("\nYou will receive updates as the review progresses.")
    );
  } catch (err) {
    console.error(
      red("Submission failed: ") +
        dim((err as Error).message)
    );
    process.exit(1);
  }
}
