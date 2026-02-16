// ---------------------------------------------------------------------------
// vskill add -- install a skill from GitHub with security scanning
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { detectInstalledAgents } from "../agents/agents-registry.js";
import { ensureLockfile, writeLockfile } from "../lockfile/index.js";
import { runTier1Scan } from "../scanner/index.js";
import {
  bold,
  green,
  red,
  yellow,
  dim,
  cyan,
  spinner,
} from "../utils/output.js";

interface AddOptions {
  skill?: string;
  global?: boolean;
  force?: boolean;
}

async function fetchSkillContent(url: string): Promise<string> {
  const spin = spinner("Fetching skill");
  try {
    const res = await fetch(url);
    if (!res.ok) {
      spin.stop();
      if (res.status === 404) {
        console.error(
          red(`SKILL.md not found at ${url}\n`) +
            dim("Make sure the repo exists and has a SKILL.md on the main branch.")
        );
      } else {
        console.error(red(`Failed to fetch: ${res.status} ${res.statusText}`));
      }
      return process.exit(1);
    }
    const content = await res.text();
    spin.stop(green("Fetched SKILL.md"));
    return content;
  } catch (err) {
    spin.stop();
    console.error(red("Network error: ") + dim((err as Error).message));
    return process.exit(1);
  }
}

export async function addCommand(
  source: string,
  opts: AddOptions
): Promise<void> {
  // Parse owner/repo
  const parts = source.split("/");
  if (parts.length !== 2) {
    console.error(red("Invalid source format. Use: ") + cyan("owner/repo"));
    process.exit(1);
  }

  const [owner, repo] = parts;
  const skillSubpath = opts.skill
    ? `skills/${opts.skill}/SKILL.md`
    : "SKILL.md";
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/${skillSubpath}`;

  // Fetch SKILL.md
  const content = await fetchSkillContent(url);

  // Run tier1 scan
  console.log(dim("\nRunning security scan..."));
  const scanResult = runTier1Scan(content);

  const verdictColor =
    scanResult.verdict === "PASS"
      ? green
      : scanResult.verdict === "CONCERNS"
        ? yellow
        : red;

  console.log(
    `${bold("Score:")} ${verdictColor(String(scanResult.score))}/100  ` +
      `${bold("Verdict:")} ${verdictColor(scanResult.verdict)}\n`
  );

  if (scanResult.findings.length > 0) {
    console.log(
      dim(
        `Found ${scanResult.findings.length} issue${scanResult.findings.length === 1 ? "" : "s"}: ` +
          `${scanResult.criticalCount} critical, ${scanResult.highCount} high, ${scanResult.mediumCount} medium`
      )
    );
  }

  // Decision based on verdict
  if (scanResult.verdict === "FAIL" && !opts.force) {
    console.error(
      red("\nScan FAILED. Refusing to install.\n") +
        dim("Use --force to install anyway (not recommended).")
    );
    process.exit(1);
  }

  if (scanResult.verdict === "CONCERNS" && !opts.force) {
    console.error(
      yellow("\nScan found CONCERNS. Refusing to install.\n") +
        dim("Use --force to install anyway.")
    );
    process.exit(1);
  }

  if (scanResult.verdict === "FAIL" && opts.force) {
    console.log(yellow("\n--force: installing despite FAIL verdict.\n"));
  }

  if (scanResult.verdict === "CONCERNS" && opts.force) {
    console.log(yellow("\n--force: installing despite CONCERNS.\n"));
  }

  // Detect installed agents
  const agents = await detectInstalledAgents();
  if (agents.length === 0) {
    console.error(
      red("No AI agents detected. Run ") +
        cyan("vskill init") +
        red(" first.")
    );
    process.exit(1);
  }

  // Install to each agent
  const skillName = opts.skill || repo;
  const sha = createHash("sha256").update(content).digest("hex").slice(0, 12);
  const locations: string[] = [];

  for (const agent of agents) {
    const baseDir = opts.global
      ? agent.globalSkillsDir
      : join(process.cwd(), agent.localSkillsDir);

    const skillDir = join(baseDir, skillName);

    try {
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), content, "utf-8");
      locations.push(`${agent.displayName}: ${skillDir}`);
    } catch (err) {
      console.error(
        yellow(`Failed to write to ${agent.displayName}: `) +
          dim((err as Error).message)
      );
    }
  }

  // Update lockfile
  const lock = ensureLockfile();
  lock.skills[skillName] = {
    version: "0.0.0",
    sha,
    tier: "SCANNED",
    installedAt: new Date().toISOString(),
    source: `github:${owner}/${repo}`,
  };
  lock.agents = agents.map((a) => a.id);
  writeLockfile(lock);

  // Print summary
  console.log(green(`\nInstalled ${bold(skillName)} to ${locations.length} agent${locations.length === 1 ? "" : "s"}:\n`));
  for (const loc of locations) {
    console.log(`  ${dim(">")} ${loc}`);
  }
  console.log(dim(`\nSHA: ${sha}`));
}
