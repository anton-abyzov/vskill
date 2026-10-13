/** Explicit private publishing; GitHub access is the platform App installation's. */
import { parseGitHubSource, validateSkillName } from "../utils/validation.js";
import { assertPrivateFilePath, createPrivateSubmission, getPrivateSubmission, PRIVATE_TERMINAL_STATES, resolvePrivateTenant } from "../api/private-skills.js";

export interface PrivateSubmitOptions {
  tenant?: string;
  skill?: string;
  path?: string;
  browser?: boolean;
  wait?: boolean;
  submission?: string;
}
export async function submitPrivateCommand(source: string | undefined, opts: PrivateSubmitOptions): Promise<void> {
  try {
    if (opts.browser) throw new Error("Private submissions stay in the CLI. Omit --browser.");
    if (!opts.tenant) throw new Error("Private publishing requires --tenant <account>. Connect the GitHub App if no accounts are available.");
    const parsed = source ? parseGitHubSource(source) : null;
    if (!opts.submission && !parsed) throw new Error("Use vskill submit owner/repo --skill name --private --tenant <account>.");
    const skill = opts.skill || parsed?.repo || "";
    if (!opts.submission && !validateSkillName(skill)) throw new Error("Invalid private skill name.");
    const path = (opts.path || "SKILL.md").replace(/^\.\//, "");
    assertPrivateFilePath(path);
    if (path !== "SKILL.md" && !path.endsWith("/SKILL.md")) throw new Error("--path must identify a SKILL.md file.");
    const tenant = await resolvePrivateTenant(opts.tenant);
    if (!opts.submission && !tenant.installationId) throw new Error("Connect the GitHub App to this account at https://verified-skill.com/settings/integrations before publishing.");
    let result = opts.submission
      ? await getPrivateSubmission(tenant, opts.submission)
      : await createPrivateSubmission(tenant, `https://github.com/${parsed!.owner}/${parsed!.repo}`, skill, path);
    console.log(`Private submission ${result.id}: ${result.state}`);
    if (opts.wait !== false) {
      for (let attempt = 0; attempt < 120 && !PRIVATE_TERMINAL_STATES.has(result.state); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        const next = await getPrivateSubmission(tenant, result.id);
        if (next.state !== result.state) console.log(`Private submission ${next.id}: ${next.state}`);
        result = next;
      }
    }
    if (result.state === "PUBLISHED") {
      console.log(`Published privately to ${tenant.slug}. Install with: vskill install --tenant ${tenant.slug} ${skill || "<skill-name>"}`);
    } else if (PRIVATE_TERMINAL_STATES.has(result.state)) {
      throw new Error(`Private verification ended in ${result.state}${result.error ? `: ${result.error}` : ""}`);
    } else {
      console.log(`Still processing. Check with: vskill submit --private --tenant ${tenant.slug} --submission ${result.id}`);
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
