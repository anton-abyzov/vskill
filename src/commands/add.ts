// ---------------------------------------------------------------------------
// vskill add -- install a skill from GitHub or local plugin directory
// ---------------------------------------------------------------------------

import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  copyFileSync,
  statSync,
  chmodSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { resolveTilde } from "../utils/paths.js";
import { detectInstalledAgents } from "../agents/agents-registry.js";
import { ensureLockfile, writeLockfile } from "../lockfile/index.js";
import { runTier1Scan } from "../scanner/index.js";
import { getPluginSource, getPluginVersion } from "../marketplace/index.js";
import { checkBlocklist } from "../blocklist/blocklist.js";
import type { BlocklistEntry } from "../blocklist/types.js";
import { checkPlatformSecurity } from "../security/index.js";
import {
  bold,
  green,
  red,
  yellow,
  dim,
  cyan,
  spinner,
} from "../utils/output.js";

// ---------------------------------------------------------------------------
// Command file filter (prevents plugin internals leaking as slash commands)
// ---------------------------------------------------------------------------

/**
 * Returns true for .md files that should NOT be installed into an agent's
 * commands directory. Claude Code (and similar agents) register every .md
 * file they find recursively as a slash command, so plugin-internal files
 * must be excluded.
 */
function shouldSkipFromCommands(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const filename = parts[parts.length - 1];

  if (!filename.endsWith(".md")) return false;
  if (parts.length === 1 && filename === "PLUGIN.md") return true;
  if (filename === "README.md") return true;
  if (filename === "FRESHNESS.md") return true;

  if (parts.length > 1 && parts[0].startsWith(".")) return true;

  const internalRootDirs = new Set(["knowledge-base", "lib", "templates", "scripts", "hooks"]);
  if (parts.length > 1 && internalRootDirs.has(parts[0])) return true;

  if (parts[0] === "skills" && parts.length > 2 && filename !== "SKILL.md") return true;

  return false;
}

function copyPluginFiltered(sourceDir: string, targetDir: string, relBase = ""): void {
  mkdirSync(targetDir, { recursive: true });
  const entries = readdirSync(sourceDir);
  for (const entry of entries) {
    const relPath = relBase ? `${relBase}/${entry}` : entry;
    const sourcePath = join(sourceDir, entry);
    const stat = statSync(sourcePath);
    if (stat.isDirectory()) {
      // Flatten: root-level commands/ and skills/ merge into the parent target dir
      const isFlattened = !relBase && (entry === "commands" || entry === "skills");
      const nextTargetDir = isFlattened ? targetDir : join(targetDir, entry);
      copyPluginFiltered(sourcePath, nextTargetDir, relPath);
    } else if (stat.isFile() && !shouldSkipFromCommands(relPath)) {
      copyFileSync(sourcePath, join(targetDir, entry));
    }
  }
}

// ---------------------------------------------------------------------------
// Plugin cache cleanup
// ---------------------------------------------------------------------------

/**
 * Remove a plugin installed via Claude Code's plugin system.
 * The cache at ~/.claude/plugins/cache/ contains ALL files without filtering,
 * causing internal .md files to leak as ghost slash commands.
 *
 * Uses `claude plugin uninstall` CLI to properly remove the plugin through
 * Claude Code's own API rather than directly manipulating internal files.
 */
function cleanPluginCache(pluginName: string, marketplace: string): void {
  const pluginKey = `${pluginName}@${marketplace}`;
  try {
    execSync(`claude plugin uninstall "${pluginKey}"`, { stdio: "ignore", timeout: 10_000 });
  } catch { /* ignore - plugin might not be installed via CLI */ }
}

// ---------------------------------------------------------------------------

interface AddOptions {
  skill?: string;
  plugin?: string;
  pluginDir?: string;
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

// ---------------------------------------------------------------------------
// Blocklist enforcement
// ---------------------------------------------------------------------------

function printBlockedError(entry: BlocklistEntry): void {
  console.error(red(bold("\n  BLOCKED: Known-malicious skill")));
  console.error(red(`  Skill: "${entry.skillName}"`));
  console.error(red(`  Threat: ${entry.threatType} (${entry.severity})`));
  console.error(red(`  Reason: ${entry.reason}`));
  console.error(dim("\n  Use --force to override (NOT recommended)"));
}

function printBlockedWarning(entry: BlocklistEntry): void {
  const line = (s: string) => console.error(red(s));
  line("");
  line("  +-------------------------------------------------+");
  line("  |  WARNING: Installing a known-malicious skill!    |");
  line("  |                                                   |");
  line(`  |  Skill: "${entry.skillName}"`);
  line(`  |  Threat: ${entry.threatType} (${entry.severity})`);
  line(`  |  Reason: ${entry.reason}`);
  line("  |                                                   |");
  line("  |  This skill is on the malicious skills blocklist. |");
  line("  |  Proceeding because --force was specified.         |");
  line("  +-------------------------------------------------+");
  line("");
}

// ---------------------------------------------------------------------------
// Plugin directory installation (local path)
// ---------------------------------------------------------------------------

/**
 * Resolve the plugin subdirectory from marketplace.json.
 * Returns the absolute path to the plugin's source directory.
 */
function resolvePluginDir(
  basePath: string,
  pluginName: string,
): string | null {
  const marketplacePath = join(basePath, ".claude-plugin", "marketplace.json");
  if (!existsSync(marketplacePath)) return null;

  const content = readFileSync(marketplacePath, "utf-8");
  const source = getPluginSource(pluginName, content);
  if (!source) return null;

  return resolve(basePath, source);
}

/**
 * Collect all file contents from a plugin directory for security scanning.
 * Concatenates content from all readable files.
 */
function collectPluginContent(pluginDir: string): string {
  const files = readdirSync(pluginDir, { recursive: true }) as string[];
  const parts: string[] = [];

  for (const file of files) {
    const fullPath = join(pluginDir, file);
    try {
      const content = readFileSync(fullPath, "utf-8");
      parts.push(`--- ${file} ---\n${content}`);
    } catch {
      // Skip unreadable files (directories, binary, etc.)
    }
  }

  return parts.join("\n");
}

/**
 * Fix permissions on hook scripts (.sh files) in the installed directory.
 */
function fixHookPermissions(targetDir: string): void {
  const files = readdirSync(targetDir, { recursive: true }) as string[];

  for (const file of files) {
    if (file.endsWith(".sh")) {
      chmodSync(join(targetDir, file), 0o755);
    }
  }
}

/**
 * Install a plugin from a local directory.
 */
async function installPluginDir(
  basePath: string,
  pluginName: string,
  opts: AddOptions,
): Promise<void> {
  // Resolve the plugin subdirectory from marketplace.json
  const pluginDir = resolvePluginDir(basePath, pluginName);
  if (!pluginDir) {
    console.error(
      red(`Plugin "${pluginName}" not found in marketplace.json\n`) +
        dim(`Checked: ${join(basePath, ".claude-plugin", "marketplace.json")}`)
    );
    process.exit(1);
  }

  // Blocklist check (before scanning)
  const blocked = await checkBlocklist(pluginName);
  if (blocked && !opts.force) {
    printBlockedError(blocked);
    process.exit(1);
  }
  if (blocked && opts.force) {
    printBlockedWarning(blocked);
  }

  // Collect all file content for scanning
  console.log(dim("\nCollecting plugin files for security scan..."));
  const content = collectPluginContent(pluginDir);

  // Run tier1 scan on all plugin content
  console.log(dim("Running security scan..."));
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

  // Read version from marketplace.json
  const marketplacePath = join(basePath, ".claude-plugin", "marketplace.json");
  const marketplaceContent = readFileSync(marketplacePath, "utf-8");
  const version = getPluginVersion(pluginName, marketplaceContent) || "0.0.0";

  // Remove unfiltered plugin cache that Claude Code's plugin system creates.
  // The cache at ~/.claude/plugins/cache/ contains ALL files without filtering,
  // causing internal .md files to leak as ghost slash commands.
  try {
    const marketplaceName = JSON.parse(marketplaceContent).name;
    if (marketplaceName) {
      cleanPluginCache(pluginName, marketplaceName);
    }
  } catch { /* ignore parse errors */ }

  // Install: recursively copy plugin directory to cache
  const sha = createHash("sha256").update(content).digest("hex").slice(0, 12);
  const locations: string[] = [];

  for (const agent of agents) {
    const cacheDir = join(
      opts.global ? resolveTilde(agent.globalSkillsDir) : join(process.cwd(), agent.localSkillsDir),
      pluginName,
    );

    try {
      // Full clean before copy: removes stale files from older installs
      if (existsSync(cacheDir)) {
        rmSync(cacheDir, { recursive: true, force: true });
      }
      copyPluginFiltered(pluginDir, cacheDir);
      fixHookPermissions(cacheDir);
      locations.push(`${agent.displayName}: ${cacheDir}`);
    } catch (err) {
      console.error(
        yellow(`Failed to install to ${agent.displayName}: `) +
          dim((err as Error).message)
      );
    }
  }

  // Update lockfile
  const lock = ensureLockfile();
  lock.skills[pluginName] = {
    version,
    sha,
    tier: "SCANNED",
    installedAt: new Date().toISOString(),
    source: `local:${basePath}`,
  };
  lock.agents = agents.map((a: { id: string }) => a.id);
  writeLockfile(lock);

  // Print summary
  console.log(
    green(
      `\nInstalled ${bold(pluginName)} to ${locations.length} agent${locations.length === 1 ? "" : "s"}:\n`
    )
  );
  for (const loc of locations) {
    console.log(`  ${dim(">")} ${loc}`);
  }
  console.log(dim(`\nSHA: ${sha} | Version: ${version}`));
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function addCommand(
  source: string,
  opts: AddOptions
): Promise<void> {
  // Plugin directory mode: local path with --plugin
  if (opts.pluginDir && opts.plugin) {
    return installPluginDir(opts.pluginDir, opts.plugin, opts);
  }

  // GitHub mode: owner/repo
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

  // Blocklist check (before scanning)
  const skillName = opts.skill || repo;
  const blocked = await checkBlocklist(skillName, undefined);
  if (blocked && !opts.force) {
    printBlockedError(blocked);
    process.exit(1);
  }
  if (blocked && opts.force) {
    printBlockedWarning(blocked);
  }

  // Platform security check (best-effort, non-blocking on network error)
  const platformSecurity = await checkPlatformSecurity(skillName);

  if (platformSecurity && platformSecurity.hasCritical && !opts.force) {
    const criticalProviders = platformSecurity.providers
      .filter((p) => p.status === "FAIL" && p.criticalCount > 0)
      .map((p) => p.provider);
    console.error(red("\n  BLOCKED: External security scan found CRITICAL findings"));
    console.error(red(`  Providers: ${criticalProviders.join(", ")}`));
    console.error(red(`  Report: https://verified-skill.com${platformSecurity.reportUrl}`));
    console.error(dim("\n  Use --force to override (NOT recommended)"));
    return process.exit(1);
  }

  if (platformSecurity && platformSecurity.hasCritical && opts.force) {
    console.error(yellow("\n  WARNING: External scans found CRITICAL findings"));
    const criticalProviders = platformSecurity.providers
      .filter((p) => p.status === "FAIL" && p.criticalCount > 0)
      .map((p) => p.provider);
    console.error(yellow(`  Providers: ${criticalProviders.join(", ")}`));
    console.error(yellow("  --force: proceeding despite CRITICAL findings\n"));
  }

  if (platformSecurity && platformSecurity.overallVerdict === "PENDING") {
    console.log(dim("\n  External scans are pending. Proceeding with install.\n"));
  }

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
  const sha = createHash("sha256").update(content).digest("hex").slice(0, 12);
  const locations: string[] = [];

  for (const agent of agents) {
    const baseDir = opts.global
      ? resolveTilde(agent.globalSkillsDir)
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
  lock.agents = agents.map((a: { id: string }) => a.id);
  writeLockfile(lock);

  // Print summary
  console.log(green(`\nInstalled ${bold(skillName)} to ${locations.length} agent${locations.length === 1 ? "" : "s"}:\n`));
  for (const loc of locations) {
    console.log(`  ${dim(">")} ${loc}`);
  }
  console.log(dim(`\nSHA: ${sha}`));
}
