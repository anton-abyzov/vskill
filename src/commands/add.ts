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
import { join, resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { resolveTilde } from "../utils/paths.js";
import { findProjectRoot } from "../utils/project-root.js";
import { filterAgents } from "../utils/agent-filter.js";
import { detectInstalledAgents } from "../agents/agents-registry.js";
import { ensureLockfile, writeLockfile } from "../lockfile/index.js";
import { runTier1Scan } from "../scanner/index.js";
import { getPluginSource, getPluginVersion } from "../marketplace/index.js";
import { checkBlocklist } from "../blocklist/blocklist.js";
import type { BlocklistEntry } from "../blocklist/types.js";
import { getSkill } from "../api/client.js";
import { checkPlatformSecurity } from "../security/index.js";
import { discoverSkills } from "../discovery/github-tree.js";
import { parseGitHubSource } from "../utils/validation.js";
import type { DiscoveredSkill } from "../discovery/github-tree.js";
import {
  bold,
  green,
  red,
  yellow,
  dim,
  cyan,
  spinner,
} from "../utils/output.js";
import { isTTY, createPrompter } from "../utils/prompts.js";
import { installSymlink, installCopy } from "../installer/canonical.js";

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
  agent?: string[];
  cwd?: boolean;
  yes?: boolean;
}

/**
 * Join base dir with localSkillsDir, avoiding double-nesting when base already
 * ends with the agent's dotfolder (e.g. running from inside ~/.openclaw/).
 *
 * Example without fix: join("~/.openclaw", ".openclaw/skills") → ~/.openclaw/.openclaw/skills
 * Example with fix:    join("~/.openclaw", ".openclaw/skills") → ~/.openclaw/skills
 */
function resolveSkillsPath(base: string, localSkillsDir: string): string {
  const parts = localSkillsDir.split("/");
  const agentBase = parts[0]; // e.g. ".openclaw", ".claude", ".gemini"
  if (basename(base) === agentBase) {
    return join(base, ...parts.slice(1));
  }
  return join(base, localSkillsDir);
}

/**
 * Resolve the base directory for local skill installation.
 *
 * Priority:
 * 1. `--global` -> agent's globalSkillsDir
 * 2. `--cwd`   -> process.cwd() + agent's localSkillsDir
 * 3. default   -> findProjectRoot(cwd) + agent's localSkillsDir (with fallback warning)
 */
function resolveInstallBase(
  opts: AddOptions,
  agent: { globalSkillsDir: string; localSkillsDir: string },
): string {
  if (opts.global) {
    return resolveTilde(agent.globalSkillsDir);
  }

  const cwd = process.cwd();

  if (opts.cwd) {
    return resolveSkillsPath(cwd, agent.localSkillsDir);
  }

  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    console.log(
      yellow("No project root found; installing relative to current directory."),
    );
    return resolveSkillsPath(cwd, agent.localSkillsDir);
  }

  if (projectRoot !== cwd) {
    console.log(
      dim(`Project root: ${projectRoot}`),
    );
  }

  return resolveSkillsPath(projectRoot, agent.localSkillsDir);
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

  // Detect installed agents and apply --agent filter
  let agents = await detectInstalledAgents();
  if (agents.length === 0) {
    console.error(red("No AI agents detected. Install Claude Code, Cursor, or another supported agent and try again."));
    process.exit(1);
  }
  try {
    agents = filterAgents(agents, opts.agent);
  } catch (e) {
    console.error(red((e as Error).message));
    process.exit(1);
    return;
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
      resolveInstallBase(opts, agent),
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
  lock.agents = [...new Set([...(lock.agents || []), ...agents.map((a: { id: string }) => a.id)])];
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
// Single GitHub skill install (fetch, scan, install to agents)
// Returns null on failure, skill entry on success.
// ---------------------------------------------------------------------------

interface SkillInstallResult {
  skillName: string;
  installed: boolean;
  verdict: string;
  sha?: string;
}

async function installOneGitHubSkill(
  owner: string,
  repo: string,
  skillName: string,
  rawUrl: string,
  opts: AddOptions,
  agents: Array<{ id: string; displayName: string; localSkillsDir: string; globalSkillsDir: string }>,
): Promise<SkillInstallResult> {
  // Fetch content (non-exiting for multi-skill support)
  let content: string;
  try {
    const res = await fetch(rawUrl);
    if (!res.ok) {
      return { skillName, installed: false, verdict: "FETCH_FAILED" };
    }
    content = await res.text();
  } catch {
    return { skillName, installed: false, verdict: "FETCH_FAILED" };
  }

  // Blocklist check
  const blocked = await checkBlocklist(skillName, undefined);
  if (blocked && !opts.force) {
    printBlockedError(blocked);
    return { skillName, installed: false, verdict: "BLOCKED" };
  }
  if (blocked && opts.force) {
    printBlockedWarning(blocked);
  }

  // Platform security check
  const platformSecurity = await checkPlatformSecurity(skillName);
  if (!platformSecurity) {
    console.log(yellow("  Platform security check unavailable -- proceeding with local scan only."));
  }
  if (platformSecurity && platformSecurity.hasCritical && !opts.force) {
    return { skillName, installed: false, verdict: "SECURITY_FAIL" };
  }

  // Tier 1 scan
  const scanResult = runTier1Scan(content);

  if ((scanResult.verdict === "FAIL" || scanResult.verdict === "CONCERNS") && !opts.force) {
    return { skillName, installed: false, verdict: scanResult.verdict };
  }

  // Install to each agent
  const sha = createHash("sha256").update(content).digest("hex").slice(0, 12);
  for (const agent of agents) {
    const baseDir = resolveInstallBase(opts, agent);
    const skillDir = join(baseDir, skillName);
    try {
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), content, "utf-8");
    } catch { /* skip agent on write error */ }
  }

  return { skillName, installed: true, verdict: scanResult.verdict, sha };
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

  // Normalize full GitHub URLs to owner/repo shorthand
  const parsed = parseGitHubSource(source);
  if (parsed) {
    source = `${parsed.owner}/${parsed.repo}`;
  }

  // GitHub mode: owner/repo
  const parts = source.split("/");
  if (parts.length !== 2) {
    // No slash → try registry lookup by skill name
    return installFromRegistry(source, opts);
  }

  const [owner, repo] = parts;

  // --skill flag: single-skill mode (no discovery, backward compat)
  if (opts.skill) {
    return installSingleSkillLegacy(owner, repo, opts.skill, opts);
  }

  // Discovery mode: find all skills in the repo
  const discovered: DiscoveredSkill[] = (await discoverSkills(owner, repo)) || [];

  if (discovered.length === 0) {
    // Fallback: discovery returned nothing — try root SKILL.md directly
    return installSingleSkillLegacy(owner, repo, undefined, opts);
  }

  // Detect agents
  let agents = await detectInstalledAgents();
  if (agents.length === 0) {
    console.error(red("No AI agents detected. Install Claude Code, Cursor, or another supported agent and try again."));
    process.exit(1);
  }
  try {
    agents = filterAgents(agents, opts.agent);
  } catch (e) {
    console.error(red((e as Error).message));
    process.exit(1);
    return;
  }

  // Determine selected skills, agents, scope, and method
  let selectedSkills = discovered;
  let selectedAgents = agents;
  let useGlobal = !!opts.global;
  let method: "symlink" | "copy" = "symlink";

  const interactive = discovered.length > 1 && isTTY() && !opts.yes;

  if (interactive) {
    const prompter = createPrompter();

    // Step 1: Skill selection
    const skillIndices = await prompter.promptCheckboxList(
      discovered.map((s) => ({ label: s.name, checked: true })),
      { title: "Select skills to install (space to toggle)" },
    );
    selectedSkills = skillIndices.map((i) => discovered[i]);

    if (selectedSkills.length === 0) {
      console.log(dim("No skills selected. Aborting."));
      return process.exit(0);
    }

    // Step 2: Agent selection (skip if --agent flag provided or only 1 agent)
    if (!opts.agent?.length && agents.length > 1) {
      const prompter2 = createPrompter();
      const agentIndices = await prompter2.promptCheckboxList(
        agents.map((a) => ({ label: a.displayName, description: a.parentCompany, checked: true })),
        { title: `Detected ${agents.length} agents` },
      );
      selectedAgents = agentIndices.map((i) => agents[i]);

      if (selectedAgents.length === 0) {
        console.log(dim("No agents selected. Aborting."));
        return process.exit(0);
      }
    }

    // Step 3: Scope selection (skip if --global flag provided)
    if (!opts.global) {
      const prompter3 = createPrompter();
      const scopeIdx = await prompter3.promptChoice("Installation scope:", [
        { label: "Project", hint: "Install in current directory (committed with your project)" },
        { label: "Global", hint: "Install to ~/.<agent>/ directories" },
      ]);
      useGlobal = scopeIdx === 1;
    }

    // Step 4: Install method
    const prompter4 = createPrompter();
    const methodIdx = await prompter4.promptChoice("Installation method:", [
      { label: "Symlink", hint: "Single source of truth, easy updates" },
      { label: "Copy", hint: "Independent copies to all agents" },
    ]);
    method = methodIdx === 0 ? "symlink" : "copy";

    // Step 5: Summary and confirmation
    console.log(dim("\n--- Installation Summary ---"));
    console.log(`  Skills: ${selectedSkills.map((s) => s.name).join(", ")}`);
    console.log(`  Agents: ${selectedAgents.map((a) => a.displayName).join(", ")}`);
    console.log(`  Scope:  ${useGlobal ? "Global" : "Project"}`);
    console.log(`  Method: ${method}`);

    const prompter5 = createPrompter();
    const proceed = await prompter5.promptConfirm("\nProceed?", true);
    if (!proceed) {
      return process.exit(0);
    }
  }

  // Override global flag based on wizard choice
  if (useGlobal) opts.global = true;

  // Install selected skills
  const results: SkillInstallResult[] = [];
  for (const skill of selectedSkills) {
    console.log(dim(`\nInstalling skill: ${bold(skill.name)}...`));
    const result = await installOneGitHubSkill(owner, repo, skill.name, skill.rawUrl, opts, selectedAgents);
    results.push(result);
  }

  // Update lockfile with all installed skills
  const lock = ensureLockfile();
  for (const r of results) {
    if (r.installed && r.sha) {
      lock.skills[r.skillName] = {
        version: "0.0.0",
        sha: r.sha,
        tier: "SCANNED",
        installedAt: new Date().toISOString(),
        source: `github:${owner}/${repo}`,
      };
    }
  }
  lock.agents = [...new Set([...(lock.agents || []), ...selectedAgents.map((a: { id: string }) => a.id)])];
  writeLockfile(lock);

  // Summary
  console.log(green(`\nInstalled ${bold(String(results.filter((r) => r.installed).length))} of ${results.length} skills:\n`));
  for (const r of results) {
    const icon = r.installed ? green("✓") : red("✗");
    const detail = r.installed ? dim(`(${r.verdict})`) : red(`(${r.verdict})`);
    console.log(`  ${icon} ${r.skillName} ${detail}`);
  }
}

// ---------------------------------------------------------------------------
// Trust tier labels
// ---------------------------------------------------------------------------

function getTrustLabel(tier: string): string {
  switch (tier) {
    case "T0": return "Blocked";
    case "T1": return "Unscanned";
    case "T2": return "Scanned";
    case "T3": return "Verified";
    case "T4": return "Certified";
    default: return "Unknown";
  }
}

// ---------------------------------------------------------------------------
// Registry name install — look up skill by name, install from content
// ---------------------------------------------------------------------------

async function installFromRegistry(
  skillName: string,
  opts: AddOptions,
): Promise<void> {
  const spin = spinner("Looking up skill in registry");
  let detail: Awaited<ReturnType<typeof getSkill>>;

  try {
    detail = await getSkill(skillName);
    spin.stop(green(`Found: ${detail.name} by ${detail.author}`));

    // Display trust tier and score if available
    if (detail.trustTier) {
      const trustLabel = getTrustLabel(detail.trustTier);
      const trustColor = detail.trustTier === "T0" ? red
        : detail.trustTier === "T1" ? yellow
        : green;
      console.log(
        `${bold("Trust:")} ${trustColor(`${detail.trustTier} (${trustLabel})`)}` +
          (detail.trustScore != null ? ` ${dim(`score ${detail.trustScore}/100`)}` : "")
      );

      // T0 (blocked): require --force
      if (detail.trustTier === "T0" && !opts.force) {
        console.error(red(bold("\n  BLOCKED: This skill has trust tier T0 (blocked)")));
        console.error(dim("  Use --force to override (NOT recommended)"));
        process.exit(1);
      }

      // T1 (unscanned): amber warning
      if (detail.trustTier === "T1") {
        console.log(yellow("  Warning: Unverified skill (T1 -- no scan results)"));
      }
    }
  } catch {
    spin.stop();
    console.error(
      red(`Skill "${skillName}" not found in registry.\n`) +
        dim(`Use ${cyan("owner/repo")} for GitHub installs, or `) +
        dim(`${cyan("vskill find <query>")} to search.`)
    );
    process.exit(1);
    return;
  }

  if (!detail.content) {
    // Registry doesn't serve content inline — fall back to GitHub install
    let ownerRepo: string | undefined;
    if (detail.repoUrl) {
      const match = detail.repoUrl.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/|$)/);
      if (match) ownerRepo = match[1];
    }
    if (!ownerRepo && detail.author) {
      ownerRepo = `${detail.author}/${skillName}`;
    }
    if (!ownerRepo) {
      console.error(
        red(`Skill found but content not available and no source repo.\n`) +
          dim(`Use ${cyan("owner/repo")} for GitHub installs.`)
      );
      process.exit(1);
      return;
    }
    console.log(dim(`Registry has no inline content — installing from GitHub (${ownerRepo})...`));
    return addCommand(ownerRepo, opts);
  }

  const content = detail.content;

  // Blocklist check
  const blocked = await checkBlocklist(skillName, undefined);
  if (blocked && !opts.force) {
    printBlockedError(blocked);
    process.exit(1);
  }
  if (blocked && opts.force) {
    printBlockedWarning(blocked);
  }

  // Tier 1 scan
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

  if ((scanResult.verdict === "FAIL" || scanResult.verdict === "CONCERNS") && !opts.force) {
    console.error(
      red(`\nScan ${scanResult.verdict}. Refusing to install.\n`) +
        dim("Use --force to install anyway.")
    );
    process.exit(1);
  }

  // Detect installed agents and apply --agent filter
  let agents = await detectInstalledAgents();
  if (agents.length === 0) {
    console.error(red("No AI agents detected. Install Claude Code, Cursor, or another supported agent and try again."));
    process.exit(1);
  }
  try {
    agents = filterAgents(agents, opts.agent);
  } catch (e) {
    console.error(red((e as Error).message));
    process.exit(1);
    return;
  }

  // Install to each agent
  const sha = createHash("sha256").update(content).digest("hex").slice(0, 12);
  const locations: string[] = [];

  for (const agent of agents) {
    const baseDir = resolveInstallBase(opts, agent);
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
    version: detail.version || "0.0.0",
    sha,
    tier: "SCANNED",
    installedAt: new Date().toISOString(),
    source: `registry:${skillName}`,
  };
  lock.agents = [...new Set([...(lock.agents || []), ...agents.map((a: { id: string }) => a.id)])];
  writeLockfile(lock);

  console.log(green(`\nInstalled ${bold(skillName)} to ${locations.length} agent${locations.length === 1 ? "" : "s"}:\n`));
  for (const loc of locations) {
    console.log(`  ${dim(">")} ${loc}`);
  }
  console.log(dim(`\nSHA: ${sha} | Version: ${detail.version || "0.0.0"}`));
}

// ---------------------------------------------------------------------------
// Legacy single-skill install (preserves original behavior exactly)
// ---------------------------------------------------------------------------

async function installSingleSkillLegacy(
  owner: string,
  repo: string,
  skill: string | undefined,
  opts: AddOptions,
): Promise<void> {
  const skillSubpath = skill ? `skills/${skill}/SKILL.md` : "SKILL.md";
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/${skillSubpath}`;

  // Fetch SKILL.md
  const content = await fetchSkillContent(url);

  // Blocklist check (before scanning)
  const skillName = skill || repo;
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
  if (!platformSecurity) {
    console.log(yellow("  Platform security check unavailable -- proceeding with local scan only."));
  }

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

  // Detect installed agents and apply --agent filter
  let agents = await detectInstalledAgents();
  if (agents.length === 0) {
    console.error(red("No AI agents detected. Install Claude Code, Cursor, or another supported agent and try again."));
    process.exit(1);
  }
  try {
    agents = filterAgents(agents, opts.agent);
  } catch (e) {
    console.error(red((e as Error).message));
    process.exit(1);
    return;
  }

  // Install to each agent
  const sha = createHash("sha256").update(content).digest("hex").slice(0, 12);
  const locations: string[] = [];

  for (const agent of agents) {
    const baseDir = resolveInstallBase(opts, agent);

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
  lock.agents = [...new Set([...(lock.agents || []), ...agents.map((a: { id: string }) => a.id)])];
  writeLockfile(lock);

  // Print summary
  console.log(green(`\nInstalled ${bold(skillName)} to ${locations.length} agent${locations.length === 1 ? "" : "s"}:\n`));
  for (const loc of locations) {
    console.log(`  ${dim(">")} ${loc}`);
  }
  console.log(dim(`\nSHA: ${sha}`));
}
