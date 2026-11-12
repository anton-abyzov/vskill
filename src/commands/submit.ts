// ---------------------------------------------------------------------------
// vskill submit -- submit skill for verification via API or browser fallback
// ---------------------------------------------------------------------------

import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { openBrowser } from "../utils/browser.js";
import { submitSkill, getVersions } from "../api/client.js";
import { bold, green, red, dim, cyan, yellow } from "../utils/output.js";
import { parseGitHubSource, validateSkillName } from "../utils/validation.js";
import { upsertFrontmatterVersion, validatesAsYamlFrontmatter } from "../lib/frontmatter.js";
import { addAuthoredSkill } from "../lockfile/authored.js";
import { getProjectRoot } from "../lockfile/project-root.js";
import { typedRepoStatus } from "../lib/private-source.js";
import {
  findTrackedSkill,
  isCommitted,
  isOnOriginBranch,
  listTrackedSkillFiles,
  listTrackedSkills,
  locateSkillFile,
  readLocalCheckout,
  readSkillName,
  sameRepo,
  toRepoPath,
  type LocalCheckout,
} from "../lib/git-checkout.js";
import { FAILED_STATES, followSubmission } from "./submit-status.js";

export interface SubmitOptions {
  skill?: string;
  browser?: boolean;
  path?: string;
  tenant?: string;
  submission?: string;
  /** Poll the new (or --submission) submission until it is published or rejected. */
  wait?: boolean;
  /**
   * Internal (vskill skill publish): the skill was found in a local checkout
   * of the source repo, so run the same committed / pushed / default-branch
   * checks as a no-argument submit.
   */
  checkLocal?: boolean;
}

interface SubmitTarget {
  owner: string;
  repo: string;
  skillName: string;
  /** Repo-relative SKILL.md path sent to the platform. */
  skillPath?: string;
  /** Local SKILL.md file, used for the version write-back. */
  localFile?: string;
  /** Set when the target came from the cwd checkout (no source argument). */
  checkout?: LocalCheckout;
}

function fail(message: string, hint?: string): never {
  console.error(red(message) + (hint ? " " + dim(hint) : ""));
  process.exit(1);
}

/**
 * owner/repo given. When a local checkout of that same repo holds the
 * SKILL.md (--path, else the cwd's), send its repo-relative path and name the
 * skill from it; otherwise name the skill after --skill or the repo.
 */
function targetFromSource(source: string, opts: SubmitOptions): SubmitTarget {
  const parsed = parseGitHubSource(source);
  if (!parsed) {
    console.error(
      red("Invalid source. Use: ") + cyan("owner/repo") + dim(" or ") + cyan("https://github.com/owner/repo")
    );
    process.exit(1);
  }
  const { owner, repo } = parsed;
  // An absolute --path (skill publish) names its own checkout, whatever the cwd.
  const from = opts.path && path.isAbsolute(opts.path) ? opts.path : process.cwd();
  const checkout = readLocalCheckout(from);
  const local = sameRepo(checkout, owner, repo) ? checkout : null;
  const fallback: SubmitTarget = { owner, repo, skillName: opts.skill ?? repo, skillPath: opts.path };
  // --skill alone names a skill the platform finds on its own.
  if (!local || (opts.skill && !opts.path)) {
    if (opts.checkLocal) fail(`No local checkout of ${owner}/${repo} holds this skill.`);
    return fallback;
  }

  const file = locateSkillFile({ path: opts.path, checkout: local });
  const repoPath = file ? toRepoPath(local, file) : null;
  if (!file || !repoPath) {
    if (opts.checkLocal) fail(`No SKILL.md at ${opts.path ?? "this folder"} in ${local.root}.`);
    return fallback;
  }
  const skillName = opts.skill ?? readSkillName(file, local.root) ?? repo;
  if (opts.checkLocal) {
    assertCommitted(local, repoPath, file);
    return { owner, repo, skillName, skillPath: repoPath, localFile: file, checkout: local };
  }
  const skillPath = (opts.path || isCommitted(local, repoPath)) ? repoPath : undefined;
  return { owner, repo, skillName, skillPath, localFile: file };
}

/** The tracked SKILL.md named `name`, or exit listing the skills that are there. */
function trackedSkillNamed(checkout: LocalCheckout, name: string): string {
  const match = findTrackedSkill(checkout, name);
  if (match) return match.file;
  const available = listTrackedSkills(checkout);
  console.error(red(`No tracked SKILL.md in ${checkout.owner}/${checkout.repo} is named "${name}".`));
  if (available.length > 0) {
    console.error(dim("Skills in this repository:"));
    for (const s of available.slice(0, 20)) {
      console.error("  " + cyan(s.name ?? "(no name)") + dim(`  ${s.repoPath}`));
    }
    console.error(dim("Pick one with --skill <name>, or pass --path <path/to/SKILL.md>."));
  } else {
    console.error(dim("Create one with `vskill skill new`, commit it, then run vskill submit again."));
  }
  process.exit(1);
}

/** No source: the cwd's git checkout names the repo and its SKILL.md names the skill. */
function targetFromCheckout(opts: SubmitOptions): SubmitTarget {
  const checkout = readLocalCheckout(process.cwd());
  if (!checkout) {
    fail("Not inside a git checkout.", "Run this from your skill's repository, or use: vskill submit owner/repo --skill <name>");
  }
  if (!checkout.remoteUrl) {
    console.error(red("This repository has no `origin` remote, so it is not on GitHub yet."));
    console.error(dim("Create a public GitHub repo from this folder and push it, then submit:"));
    console.error("  " + cyan("gh repo create <owner>/<repo> --public --source=. --remote=origin --push"));
    console.error("  " + cyan("vskill submit"));
    process.exit(1);
  }
  if (!checkout.owner || !checkout.repo) {
    fail(`origin is not a GitHub repository (${checkout.remoteUrl}).`, "verified-skill.com only reviews public GitHub repos.");
  }

  let file: string | null;
  if (opts.skill && !opts.path) {
    // --skill names the SKILL.md: never pair the cwd's file with another name.
    const here = locateSkillFile({ checkout });
    file = here && readSkillName(here, checkout.root) === opts.skill ? here : trackedSkillNamed(checkout, opts.skill);
  } else {
    file = locateSkillFile({ path: opts.path, checkout });
    if (!file && !opts.path) {
      const tracked = listTrackedSkillFiles(checkout);
      if (tracked.length === 1) file = path.join(checkout.root, tracked[0]);
      else if (tracked.length > 1) {
        console.error(red("This repository has several skills; say which one with --path:"));
        for (const t of tracked.slice(0, 20)) console.error("  " + cyan(`vskill submit --path ${t}`));
        process.exit(1);
      }
    }
  }
  if (!file) {
    fail(
      opts.path ? `No SKILL.md at ${opts.path}.` : "No SKILL.md found in this folder or tracked in this repository.",
      "Create one with `vskill skill new`, commit it, then run vskill submit again.",
    );
  }
  const repoPath = toRepoPath(checkout, file);
  if (!repoPath) fail(`${file} is outside the repository at ${checkout.root}.`);
  assertCommitted(checkout, repoPath, file);
  const skillName = opts.skill ?? readSkillName(file, checkout.root) ?? checkout.repo;
  return { owner: checkout.owner, repo: checkout.repo, skillName, skillPath: repoPath, localFile: file, checkout };
}

/** GitHub can only serve a SKILL.md that is committed. */
function assertCommitted(checkout: LocalCheckout, repoPath: string, file: string): void {
  if (isCommitted(checkout, repoPath)) return;
  console.error(red(`${repoPath} is not committed yet, so GitHub cannot serve it.`));
  console.error("  " + cyan(`git add ${repoPath} && git commit -m "Add ${path.basename(path.dirname(path.resolve(file))) || "skill"}"`));
  console.error("  " + cyan("git push -u origin HEAD"));
  process.exit(1);
}

/** The branch must be on GitHub before the platform can read the SKILL.md. */
function assertPushed(checkout: LocalCheckout, skillPath: string | undefined): void {
  if (!checkout.branch) {
    fail("HEAD is detached.", "Check out the branch that holds the skill, push it, then submit.");
  }
  if (!checkout.hasUpstream) {
    console.error(red(`Branch ${checkout.branch} is not on GitHub yet. Push it first:`));
    console.error("  " + cyan("git push -u origin HEAD"));
    process.exit(1);
  }
  if (!checkout.pushed) {
    console.error(red(`Branch ${checkout.branch} has commits that are not on GitHub yet. Push them first:`));
    console.error("  " + cyan("git push"));
    process.exit(1);
  }
  assertOnDefaultBranch(checkout, checkout.branch, skillPath);
}

/**
 * The platform reads SKILL.md from the repository's default branch, so a
 * skill that exists only on a pushed feature branch would not be found.
 */
function assertOnDefaultBranch(checkout: LocalCheckout, branch: string, skillPath: string | undefined): void {
  const main = checkout.defaultBranch;
  if (main) {
    if (branch === main || !skillPath || isOnOriginBranch(checkout, main, skillPath)) return;
    console.error(
      red(`${skillPath} is on ${branch} but not on ${main}, the default branch verified-skill.com reads. `) +
        dim("Merge it first, for example:"),
    );
    console.error("  " + cyan(`gh pr create --fill --base ${main}`) + dim(" && ") + cyan("gh pr merge --merge"));
    console.error("  " + cyan(`git checkout ${main} && git merge ${branch} && git push`));
    console.error(dim("Already merged on GitHub? Run ") + cyan("git fetch origin") + dim(" and submit again."));
    process.exit(1);
  }
  if (branch !== "main" && branch !== "master") {
    console.log(
      yellow(`You are on ${branch}. `) +
        dim("verified-skill.com reads the repository's default branch; make sure the skill is merged there."),
    );
  }
}

export async function submitCommand(
  source: string | undefined,
  opts: SubmitOptions
): Promise<void> {
  // Private submission ids (psub_) and tenants belong to --private.
  if (opts.tenant || opts.submission?.startsWith("psub_")) {
    console.error(red("--tenant and --submission require --private for publishing."));
    process.exit(1);
  }

  if (opts.skill && !validateSkillName(opts.skill)) {
    console.error(
      red("Invalid skill name. ") + dim("Path traversal patterns are not allowed.")
    );
    process.exit(1);
  }

  if (opts.submission) {
    await followSubmission(opts.submission, { wait: opts.wait === true });
    return;
  }

  const target = source ? targetFromSource(source, opts) : targetFromCheckout(opts);
  const { owner, repo, skillName } = target;
  if (!validateSkillName(skillName)) {
    fail(`Invalid skill name "${skillName}".`, "Pass a plain name with --skill.");
  }
  const repoUrl = `https://github.com/${owner}/${repo}`;

  // This default path publishes publicly. A repo GitHub reports as private
  // (or hides) requires the separate explicit --private --tenant workflow.
  const status = await typedRepoStatus(owner, repo);
  if (status === "private") {
    console.error(
      red(`${owner}/${repo} is a private repository, so `) +
        dim("nothing was submitted publicly. Use --private --tenant <account> for hosted private verification."),
    );
    process.exit(1);
  }
  // 0932: GitHub's 404 covers a missing repo and a private one this token
  // cannot see; say "not found" rather than claiming either.
  if (status === "not-found") {
    console.error(
      red(`${owner}/${repo} was not found on GitHub, so nothing was submitted. `) +
        dim(
          "Check the owner and repo name. If it is a private repo, sign in with `vskill auth login --repos` " +
            "and use --private --tenant <account>.",
        ),
    );
    const local = target.checkout ?? readLocalCheckout(process.cwd());
    console.error(dim("If the repo does not exist yet, create it from this folder and submit again:"));
    if (sameRepo(local, owner, repo)) {
      console.error("  " + cyan(`gh repo create ${owner}/${repo} --public`) + dim(" && ") + cyan("git push -u origin HEAD"));
    } else {
      console.error("  " + cyan(`gh repo create ${owner}/${repo} --public --source=. --remote=origin --push`));
    }
    console.error("  " + cyan(source ? `vskill submit ${owner}/${repo}` : "vskill submit"));
    process.exit(1);
  }

  if (target.checkout) assertPushed(target.checkout, target.skillPath);

  // --browser flag: use browser-based OAuth flow
  if (opts.browser) {
    // The submit page pre-fills only a full https://github.com/... repo URL;
    // skill and path name the same SKILL.md the API flow would send.
    const submitUrl = new URL("https://verified-skill.com/submit");
    submitUrl.searchParams.set("repo", repoUrl);
    submitUrl.searchParams.set("skill", skillName);
    if (target.skillPath) submitUrl.searchParams.set("path", target.skillPath);
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
  console.log(dim(`Submitting ${bold(skillName)} from ${owner}/${repo}...\n`));
  const fullName = `${owner}/${repo}/${skillName}`;
  const writeBackPath = target.localFile ?? opts.path;

  let followId: string | undefined;
  try {
    const response = await submitSkill({
      repoUrl,
      skillName,
      skillPath: target.skillPath,
      source: "cli-submit",
    });

    if (response.blocked) {
      console.error(red("Blocked: ") + dim("This skill is on the blocklist."));
      process.exit(1);
    }

    if (response.alreadyVerified) {
      console.log(green("Already verified! ") + dim("Skill is up-to-date in the registry."));
      if (response.id) console.log(dim(`Submission: ${response.id}`));
      // 0794 / T-005 — write registry version back to local SKILL.md frontmatter.
      // Only fires when the user has a local source path: prevents phantom
      // "update available" right after submit (project_skill_version_publish_desync.md).
      if (response.skillName && writeBackPath) {
        await tryWriteBackVersion(response.skillName, writeBackPath);
      }
      return;
    }

    // 0932: the platform answers a rejected submission with `duplicate: true`
    // and the rejected state; that is a rejection, not a pending duplicate.
    if (isRejectedSubmission(response)) {
      console.error(
        red("Rejected: ") +
          dim(`this exact SKILL.md was already reviewed and rejected (${response.state}).`),
      );
      if (response.id) {
        console.error(dim(`Submission: ${response.id}`));
        console.error(dim("See the findings: ") + cyan(`vskill submit --submission ${response.id}`));
      }
      console.error(dim("Fix the findings, push the change, then run the same submit again to have it re-evaluated."));
      process.exit(1);
    }

    if (response.duplicate) {
      console.log(yellow("Duplicate: ") + dim("An identical submission is already pending."));
      const existing = response.id ?? response.submissionId;
      if (existing) {
        console.log(dim(`Existing submission: ${existing}`));
        if (opts.wait) followId = existing;
        else console.log(dim("Follow it: ") + cyan(`vskill submit --submission ${existing} --wait`));
      }
      console.log(dim(`Check status: vskill info ${fullName}`));
    } else {
      console.log(
        green(response.requeued ? "Resubmitted! " : "Submitted! ") +
          dim(`ID: ${response.id}`) +
          (response.requeued ? dim(" (SKILL.md changed; publishing a new version)") : ""),
      );
      console.log(dim(`State: ${response.state}`));
      console.log(dim("\nThe skill will go through tier-1 and tier-2 scanning."));
      if (response.id && opts.wait) followId = response.id;
      else if (response.id) console.log(dim("Follow it: ") + cyan(`vskill submit --submission ${response.id} --wait`));
      // 0932: `vskill info` needs the full owner/repo/skill name.
      console.log(dim(`Check status: vskill info ${fullName}`));
      // 0794 / T-005 — when state is already 'completed' (rare fast-path),
      // attempt write-back. For pending state the user should re-run after
      // scan completes (or use vskill outdated which will pick up the new version).
      if (response.state === "completed" && response.skillName && writeBackPath) {
        await tryWriteBackVersion(response.skillName, writeBackPath);
      }
    }
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

  if (followId) {
    console.log("");
    const { outcome, detail } = await followSubmission(followId, { wait: true });
    // The platform's published name wins over the locally built one.
    const published = detail?.publishedSkillName ?? fullName;
    if (outcome === "published" && writeBackPath) await tryWriteBackVersion(published, writeBackPath);
  }
}

/** 0932: a submission the registry already rejected for this content. */
export function isRejectedSubmission(response: { rejected?: boolean; state?: string }): boolean {
  return response.rejected === true || (!!response.state && FAILED_STATES.has(response.state));
}

/**
 * 0794 / T-005 — write the registry's latest version back to the user's
 * local SKILL.md frontmatter. Looks up the latest published version via
 * the registry's `/skills/<name>/versions` endpoint and uses
 * upsertFrontmatterVersion to update only the top-level `version:` field.
 *
 * Best-effort: any failure is logged as dim text and never throws —
 * write-back is a UX nicety, not a correctness requirement.
 */
async function tryWriteBackVersion(skillName: string, sourcePath: string): Promise<void> {
  try {
    const resolved = path.resolve(sourcePath);
    if (!existsSync(resolved)) return;
    const versions = await getVersions(skillName);
    if (!versions || versions.length === 0) return;
    const latest = versions[0]; // API returns versions newest-first
    if (!latest?.version) return;
    const before = await fs.readFile(resolved, "utf8");
    const after = upsertFrontmatterVersion(before, latest.version);
    if (after === before) return; // already up to date
    if (!validatesAsYamlFrontmatter(after)) {
      console.log(dim(`(skipped writeback: result would not be valid YAML frontmatter)`));
      return;
    }
    await fs.writeFile(resolved, after);
    console.log(dim(`Wrote version ${latest.version} to ${path.relative(process.cwd(), resolved)}`));
    // 0794 / T-006 — track this skill for source-origin update polling.
    try {
      addAuthoredSkill(getProjectRoot(), skillName, resolved);
    } catch {
      // Authored tracking is best-effort; never block writeback.
    }
  } catch (err) {
    console.log(dim(`(version writeback skipped: ${(err as Error).message})`));
  }
}
