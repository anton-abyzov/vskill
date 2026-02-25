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
import { reportInstall } from "../api/client.js";
import { filterAgents } from "../utils/agent-filter.js";
import { detectInstalledAgents, AGENTS_REGISTRY } from "../agents/agents-registry.js";
import type { AgentDefinition } from "../agents/agents-registry.js";
import { ensureLockfile, writeLockfile } from "../lockfile/index.js";
import { runTier1Scan } from "../scanner/index.js";
import { getAvailablePlugins, getPluginSource, getPluginVersion } from "../marketplace/index.js";
import { checkInstallSafety } from "../blocklist/blocklist.js";
import type { BlocklistEntry, RejectionInfo } from "../blocklist/types.js";
import { getSkill } from "../api/client.js";
import { checkPlatformSecurity } from "../security/index.js";
import { discoverSkills } from "../discovery/github-tree.js";
import { parseGitHubSource, classifyIdentifier } from "../utils/validation.js";
import {
  parseSkillsShUrl,
  isCompleteParsed,
  isIncompleteParsed,
} from "../resolvers/url-resolver.js";
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
import {
  isClaudeCliAvailable,
  registerMarketplace,
  installNativePlugin,
} from "../utils/claude-cli.js";
import { getMarketplaceName } from "../marketplace/index.js";

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
// Native Claude Code plugin install
// ---------------------------------------------------------------------------

/**
 * Attempt to install a plugin via Claude Code's native plugin system.
 *
 * Returns true if native install succeeded (Claude Code should be excluded
 * from the extraction agent list). Returns false if native install was
 * skipped or failed (fall back to extraction).
 *
 * Conditions for native install:
 * - `claude` CLI is available on PATH
 * - --copy flag is NOT set
 * - User opts in (interactive prompt) OR --yes flag is set
 */
async function tryNativeClaudeInstall(
  marketplacePath: string,
  marketplaceContent: string,
  pluginName: string,
  opts: AddOptions,
): Promise<boolean> {
  if (opts.copy) return false;
  if (!isClaudeCliAvailable()) return false;

  const marketplaceName = getMarketplaceName(marketplaceContent);
  if (!marketplaceName) return false;

  // Prompt user unless --yes
  if (isTTY() && !opts.yes) {
    const prompter = createPrompter();
    const choice = await prompter.promptChoice(
      "Claude Code plugin install method:",
      [
        { label: "Native plugin install", hint: `recommended — enables ${marketplaceName}:${pluginName} namespacing` },
        { label: "Extract skills individually", hint: "copies files to .claude/skills/ directory" },
      ],
    );
    if (choice !== 0) return false;
  }

  // Register marketplace
  const regSpin = spinner("Registering marketplace with Claude Code");
  const registered = registerMarketplace(marketplacePath);
  if (!registered) {
    regSpin.stop();
    console.log(yellow("  Failed to register marketplace — falling back to extraction."));
    return false;
  }
  regSpin.stop();

  // Install plugin
  const installSpin = spinner(`Installing ${pluginName} via Claude Code plugin system`);
  const installed = installNativePlugin(pluginName, marketplaceName);
  if (!installed) {
    installSpin.stop();
    console.log(yellow("  Native install failed — falling back to extraction."));
    return false;
  }
  installSpin.stop();

  console.log(green(`  ${bold(pluginName)} installed as native Claude Code plugin`));
  console.log(dim(`  Namespace: ${marketplaceName}:${pluginName}`));
  console.log(dim(`  Manage: claude plugin list | claude plugin uninstall "${pluginName}@${marketplaceName}"`));
  reportInstall(pluginName).catch(() => {});

  return true;
}

// ---------------------------------------------------------------------------

interface AddOptions {
  skill?: string;
  plugin?: string;
  pluginDir?: string;
  repo?: string;
  all?: boolean;
  global?: boolean;
  force?: boolean;
  agent?: string | string[];
  cwd?: boolean;
  yes?: boolean;
  copy?: boolean;
  select?: boolean;
  /** @internal Registry target skill name — auto-select from discovery */
  _targetSkill?: string;
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
  const home = process.env.HOME || process.env.USERPROFILE || "";

  if (opts.cwd) {
    return resolveSkillsPath(cwd, agent.localSkillsDir);
  }

  const projectRoot = findProjectRoot(cwd);

  // Guard: never treat $HOME as project root — that would pollute the home dir
  if (!projectRoot || (home && resolve(projectRoot) === resolve(home))) {
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

// ---------------------------------------------------------------------------
// Interactive agent/scope selection (shared across all install paths)
// ---------------------------------------------------------------------------

interface InstallSelections {
  agents: AgentDefinition[];
  global: boolean;
  symlink: boolean;
}

/**
 * Prompt the user for agent selection and installation scope.
 *
 * Interactive by default when TTY is available. Skipped when:
 * - `--yes` flag is passed
 * - Not a TTY (CI/piped)
 * - `--agent` flag narrows to specific agents (skip agent prompt only)
 * - `--global` or `--cwd` explicitly sets scope (skip scope prompt only)
 */
async function promptInstallOptions(
  agents: AgentDefinition[],
  opts: AddOptions,
): Promise<InstallSelections> {
  const shouldPrompt = isTTY() && !opts.yes;
  let selectedAgents = agents;
  let useGlobal = !!opts.global;

  if (!shouldPrompt) {
    return { agents: selectedAgents, global: useGlobal, symlink: !opts.copy };
  }

  // Agent selection — show detected agents (pre-checked) + all others (unchecked)
  if (!opts.agent?.length) {
    const detectedIds = new Set(agents.map((a) => a.id));
    const undetected = AGENTS_REGISTRY.filter(
      (a) => !a.isUniversal && !detectedIds.has(a.id),
    );

    // Build combined list: detected first (checked), then undetected (unchecked)
    const allAgents = [...agents, ...undetected];
    const items = allAgents.map((a) => ({
      label: a.displayName,
      description: detectedIds.has(a.id)
        ? a.parentCompany
        : `${a.parentCompany} — not detected`,
      checked: detectedIds.has(a.id),
    }));

    if (allAgents.length > 1) {
      console.log(dim(`\nDetected ${agents.length} of ${AGENTS_REGISTRY.filter((a) => !a.isUniversal).length} supported agents (checked via CLI binary or config directory):`));
      const prompter = createPrompter();
      const agentIndices = await prompter.promptCheckboxList(items, {
        title: "Select agents to install to",
      });
      selectedAgents = agentIndices.map((i) => allAgents[i]);

      if (selectedAgents.length === 0) {
        console.log(dim("No agents selected. Aborting."));
        return process.exit(0);
      }
    } else if (agents.length === 1) {
      console.log(dim(`\nDetected agent: ${agents[0].displayName}`));
    }
  }

  // Scope selection (skip if --global or --cwd already set)
  if (!opts.global && !opts.cwd) {
    const prompter2 = createPrompter();
    const scopeIdx = await prompter2.promptChoice("Installation scope:", [
      { label: "Project", hint: "install in current project root" },
      { label: "Global", hint: "install in user home directory" },
    ]);
    useGlobal = scopeIdx === 1;
  }

  // Installation method (skip if --copy explicitly set)
  let useSymlink = !opts.copy;
  if (!opts.copy) {
    const prompter3 = createPrompter();
    const methodIdx = await prompter3.promptChoice("Installation method:", [
      { label: "Symlink", hint: "single source of truth, easy updates" },
      { label: "Copy to all agents", hint: "independent copies, no symlink dependency" },
    ]);
    useSymlink = methodIdx === 0;
  }

  // Installation summary
  const methodLabel = useSymlink ? "Symlink" : "Copy";
  const scopeLabel = useGlobal ? "Global" : "Project";
  console.log("");
  console.log(cyan("  Installation Summary"));
  console.log(dim("  ─────────────────────────────────────────────────"));
  console.log(dim(`  Scope: ${bold(scopeLabel)}  |  Method: ${bold(methodLabel)}`));
  console.log(dim(`  Agents (${selectedAgents.length}):`));
  for (const agent of selectedAgents) {
    const base = useGlobal
      ? resolveTilde(agent.globalSkillsDir)
      : resolveSkillsPath(
          opts.cwd
            ? process.cwd()
            : findProjectRoot(process.cwd()) || process.cwd(),
          agent.localSkillsDir,
        );
    console.log(dim(`    ${agent.displayName}: ${base}/`));
  }
  console.log(dim("  ─────────────────────────────────────────────────"));

  return { agents: selectedAgents, global: useGlobal, symlink: useSymlink };
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
  console.error(dim(`  Details: https://verified-skill.com/skills/${encodeURIComponent(entry.skillName)}`));
  console.error(red("\n  Installation is not allowed for blocked skills."));
}

function printRejectedWarning(rejection: RejectionInfo): void {
  console.error(yellow(bold("\n  WARNING: Skill failed platform verification")));
  console.error(yellow(`  Skill: "${rejection.skillName}"`));
  if (rejection.score != null) {
    console.error(yellow(`  Score: ${rejection.score}/100`));
  }
  console.error(yellow(`  Reason: ${rejection.reason}`));
  console.error(dim(`  Details: https://verified-skill.com/skills/${encodeURIComponent(rejection.skillName)}`));
  console.error("");
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

  // Blocklist + rejection check (before scanning)
  const safety = await checkInstallSafety(pluginName);
  if (safety.blocked) {
    printBlockedError(safety.entry!);
    process.exit(1);
  }
  if (safety.rejected) {
    printRejectedWarning(safety.rejection!);
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

  // Interactive agent/scope selection
  const selections = await promptInstallOptions(agents, opts);
  const selectedAgents = selections.agents;
  if (selections.global) opts.global = true;

  // Read version from marketplace.json
  const mktPath = join(basePath, ".claude-plugin", "marketplace.json");
  const mktContent = readFileSync(mktPath, "utf-8");
  const version = getPluginVersion(pluginName, mktContent) || "0.0.0";

  // Native Claude Code plugin install
  const hasClaude = selectedAgents.some((a) => a.id === "claude-code");
  let claudeNativeSuccess = false;

  if (hasClaude) {
    claudeNativeSuccess = await tryNativeClaudeInstall(
      resolve(basePath),
      mktContent,
      pluginName,
      opts,
    );
  }

  // Filter Claude Code out of extraction if native install succeeded
  const extractionAgents = claudeNativeSuccess
    ? selectedAgents.filter((a) => a.id !== "claude-code")
    : selectedAgents;

  // Clean stale plugin cache only when NOT using native install
  if (!claudeNativeSuccess) {
    try {
      const marketplaceName = JSON.parse(mktContent).name;
      if (marketplaceName) {
        cleanPluginCache(pluginName, marketplaceName);
      }
    } catch { /* ignore parse errors */ }
  }

  // Install: recursively copy plugin directory to each agent
  const sha = createHash("sha256").update(content).digest("hex").slice(0, 12);
  const locations: string[] = [];

  if (claudeNativeSuccess) {
    locations.push("Claude Code: native plugin");
  }

  for (const agent of extractionAgents) {
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

  // Compute project root for consistent lockfile location
  const pluginProjectRoot = opts.cwd
    ? process.cwd()
    : (findProjectRoot(process.cwd()) || process.cwd());

  // Update lockfile (same project root as skills)
  const lock = ensureLockfile(pluginProjectRoot);
  lock.skills[pluginName] = {
    version,
    sha,
    tier: "SCANNED",
    installedAt: new Date().toISOString(),
    source: `local:${basePath}`,
  };
  lock.agents = [...new Set([...(lock.agents || []), ...selectedAgents.map((a: { id: string }) => a.id)])];
  writeLockfile(lock, pluginProjectRoot);

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
  score?: number;
  sha?: string;
}

async function installOneGitHubSkill(
  owner: string,
  repo: string,
  skillName: string,
  rawUrl: string,
  opts: AddOptions,
  agents: Array<{ id: string; displayName: string; localSkillsDir: string; globalSkillsDir: string }>,
  projectRoot: string,
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

  // Blocklist + rejection check
  const safety = await checkInstallSafety(skillName);
  if (safety.blocked) {
    printBlockedError(safety.entry!);
    return { skillName, installed: false, verdict: "BLOCKED" };
  }
  if (safety.rejected) {
    printRejectedWarning(safety.rejection!);
  }

  // Platform security check
  const platformSecurity = await checkPlatformSecurity(skillName);
  if (!platformSecurity) {
    console.log(yellow("  Platform security check unavailable -- proceeding with local scan only."));
  }
  if (platformSecurity && platformSecurity.hasCritical && !opts.force) {
    const criticalProviders = platformSecurity.providers
      .filter((p) => p.status === "FAIL" && p.criticalCount > 0)
      .map((p) => p.provider);
    console.log(red(`  BLOCKED: External security scan found CRITICAL findings`));
    if (criticalProviders.length > 0) {
      console.log(dim(`  Providers: ${criticalProviders.join(", ")}`));
    }
    if (platformSecurity.reportUrl) {
      console.log(dim(`  Report: https://verified-skill.com${platformSecurity.reportUrl}`));
    }
    return { skillName, installed: false, verdict: "SECURITY_FAIL" };
  }

  // Tier 1 scan
  const scanResult = runTier1Scan(content);

  if ((scanResult.verdict === "FAIL" || scanResult.verdict === "CONCERNS") && !opts.force) {
    const verdictColor = scanResult.verdict === "FAIL" ? red : yellow;
    console.log(
      `  ${bold("Score:")} ${verdictColor(String(scanResult.score))}/100  ` +
        `${bold("Verdict:")} ${verdictColor(scanResult.verdict)}`
    );
    if (scanResult.findings.length > 0) {
      console.log(
        dim(
          `  Found ${scanResult.findings.length} issue${scanResult.findings.length === 1 ? "" : "s"}: ` +
            `${scanResult.criticalCount} critical, ${scanResult.highCount} high, ${scanResult.mediumCount} medium`
        )
      );
      for (const f of scanResult.findings) {
        console.log(dim(`    ${f.patternId} [${f.severity}] ${f.patternName}: ${JSON.stringify(f.match)} (line ${f.lineNumber})`));
      }
    }
    return { skillName, installed: false, verdict: scanResult.verdict, score: scanResult.score };
  }

  // Install to each agent using canonical installer
  const sha = createHash("sha256").update(content).digest("hex").slice(0, 12);
  const installOpts = { global: !!opts.global, projectRoot };

  try {
    if (opts.copy) {
      installCopy(skillName, content, agents as AgentDefinition[], installOpts);
    } else {
      installSymlink(skillName, content, agents as AgentDefinition[], installOpts);
    }
  } catch (err) {
    console.error(red(`  Failed to install skill "${skillName}": ${(err as Error).message}`));
    return { skillName, installed: false, verdict: "WRITE_ERROR", score: scanResult.score };
  }

  return { skillName, installed: true, verdict: scanResult.verdict, score: scanResult.score, sha };
}

// ---------------------------------------------------------------------------
// Bulk repo plugin installation: --repo with --all
// ---------------------------------------------------------------------------

async function installAllRepoPlugins(
  ownerRepo: string,
  opts: AddOptions,
): Promise<void> {
  const [owner, repo] = ownerRepo.split("/");
  if (!owner || !repo) {
    console.error(red("--repo must be in owner/repo format (e.g. anton-abyzov/vskill)"));
    process.exit(1);
  }

  // Fetch marketplace.json
  const manifestUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/.claude-plugin/marketplace.json`;
  const manifestSpin = spinner("Fetching marketplace.json");
  let manifestContent: string;
  try {
    const res = await fetch(manifestUrl);
    if (!res.ok) {
      manifestSpin.stop();
      console.error(
        red(`marketplace.json not found at ${owner}/${repo}\n`) +
          dim("Ensure the repo has .claude-plugin/marketplace.json on the main branch.")
      );
      process.exit(1);
    }
    manifestContent = await res.text();
    manifestSpin.stop(green("Found marketplace.json"));
  } catch (err) {
    manifestSpin.stop();
    console.error(red("Network error: ") + dim((err as Error).message));
    process.exit(1);
    return;
  }

  // Get all plugins
  const allPlugins = getAvailablePlugins(manifestContent);
  if (allPlugins.length === 0) {
    console.error(red("No plugins found in marketplace.json"));
    process.exit(1);
  }

  console.log(bold(`\nInstalling all ${allPlugins.length} plugins from ${owner}/${repo}:\n`));
  for (const p of allPlugins) {
    console.log(`  ${dim(">")} ${p.name}${p.description ? dim(` — ${p.description}`) : ""}`);
  }
  console.log();

  // Install each plugin sequentially (--all implies --yes)
  const forceOpts = { ...opts, yes: true };
  let installed = 0;
  let failed = 0;

  for (let i = 0; i < allPlugins.length; i++) {
    const p = allPlugins[i];
    console.log(dim(`[${i + 1}/${allPlugins.length}] `) + bold(p.name));
    try {
      await installRepoPlugin(ownerRepo, p.name, forceOpts);
      installed++;
    } catch (err) {
      console.error(yellow(`  Failed: ${(err as Error).message}`));
      failed++;
    }
  }

  // Summary
  console.log(
    `\n${green(bold("Done!"))} Installed ${bold(String(installed))}` +
      (failed > 0 ? `, ${red(`failed ${failed}`)}` : "") +
      ` of ${allPlugins.length} plugins.`
  );
}

// ---------------------------------------------------------------------------
// Remote plugin installation from a GitHub repository with marketplace.json
// ---------------------------------------------------------------------------

async function installRepoPlugin(
  ownerRepo: string,
  pluginName: string,
  opts: AddOptions,
): Promise<void> {
  const [owner, repo] = ownerRepo.split("/");
  if (!owner || !repo) {
    throw new Error("--repo must be in owner/repo format (e.g. anton-abyzov/vskill)");
  }

  // Fetch marketplace.json from GitHub
  const manifestUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/.claude-plugin/marketplace.json`;
  const manifestSpin = spinner("Fetching marketplace.json");
  let manifestContent: string;
  try {
    const res = await fetch(manifestUrl);
    if (!res.ok) {
      manifestSpin.stop();
      throw new Error(
        `marketplace.json not found at ${owner}/${repo}. ` +
          "Ensure the repo has .claude-plugin/marketplace.json on the main branch."
      );
    }
    manifestContent = await res.text();
    manifestSpin.stop(green("Found marketplace.json"));
  } catch (err) {
    manifestSpin.stop();
    if (err instanceof Error && err.message.startsWith("marketplace.json not found")) throw err;
    throw new Error(`Network error: ${(err as Error).message}`);
  }

  // Find the plugin in the marketplace
  const pluginSource = getPluginSource(pluginName, manifestContent);
  if (!pluginSource) {
    const available = getAvailablePlugins(manifestContent).map((p) => p.name);
    throw new Error(
      `Plugin "${pluginName}" not found in marketplace.json. ` +
        `Available plugins: ${available.join(", ")}`
    );
  }
  const pluginVersion = getPluginVersion(pluginName, manifestContent) || "0.0.0";
  const pluginPath = pluginSource.replace(/^\.\//, "");

  // Discover skills via GitHub Contents API
  const discoverSpin = spinner(`Discovering skills in ${pluginName}`);
  interface GHEntry { name: string; type: string; download_url?: string }

  let skillEntries: GHEntry[] = [];
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${pluginPath}/skills`,
      { headers: { "User-Agent": "vskill-cli" } },
    );
    if (res.ok) {
      skillEntries = ((await res.json()) as GHEntry[]).filter((e) => e.type === "dir");
    }
  } catch { /* skills dir might not exist */ }

  let cmdEntries: GHEntry[] = [];
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${pluginPath}/commands`,
      { headers: { "User-Agent": "vskill-cli" } },
    );
    if (res.ok) {
      cmdEntries = ((await res.json()) as GHEntry[]).filter((e) => e.name.endsWith(".md"));
    }
  } catch { /* commands dir might not exist */ }

  discoverSpin.stop(green(`Found ${skillEntries.length} skills, ${cmdEntries.length} commands`));

  if (skillEntries.length === 0 && cmdEntries.length === 0) {
    throw new Error(`No skills or commands found in plugin "${pluginName}"`);
  }

  // Fetch all skill and command content
  const allContent: string[] = [];
  const skills: Array<{ name: string; content: string }> = [];
  for (const entry of skillEntries) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${pluginPath}/skills/${entry.name}/SKILL.md`;
    try {
      const res = await fetch(rawUrl);
      if (res.ok) {
        const content = await res.text();
        skills.push({ name: entry.name, content });
        allContent.push(content);
      }
    } catch { /* skip unavailable skills */ }
  }

  const commands: Array<{ name: string; content: string }> = [];
  for (const entry of cmdEntries) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${pluginPath}/commands/${entry.name}`;
    try {
      const res = await fetch(rawUrl);
      if (res.ok) {
        const content = await res.text();
        commands.push({ name: entry.name, content });
        allContent.push(content);
      }
    } catch { /* skip unavailable */ }
  }

  // Blocklist + rejection check
  const safety = await checkInstallSafety(pluginName);
  if (safety.blocked) {
    printBlockedError(safety.entry!);
    throw new Error(`Plugin "${pluginName}" is on the blocklist`);
  }
  if (safety.rejected) {
    printRejectedWarning(safety.rejection!);
  }

  // Tier 1 scan on all content combined
  console.log(dim("\nRunning security scan..."));
  const combined = allContent.join("\n---\n");
  const scanResult = runTier1Scan(combined);

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
    throw new Error(`Scan ${scanResult.verdict}. Refusing to install. Use --force to install anyway.`);
  }

  // Detect agents
  let agents = await detectInstalledAgents();
  if (agents.length === 0) {
    throw new Error("No AI agents detected. Install Claude Code, Cursor, or another supported agent and try again.");
  }
  try {
    agents = filterAgents(agents, opts.agent);
  } catch (e) {
    throw new Error((e as Error).message);
  }

  const selections = await promptInstallOptions(agents, opts);
  const selectedAgents = selections.agents;
  if (selections.global) opts.global = true;
  if (!selections.symlink) opts.copy = true;

  // Native Claude Code plugin install is only available for local plugins.
  // Remote plugins require marketplace registration with a local path.
  const hasClaude = selectedAgents.some((a) => a.id === "claude-code");
  if (hasClaude && !opts.copy) {
    console.log(
      dim("\n  Note: Native Claude Code plugin install requires a local path.") +
        dim("\n  Use --plugin-dir for native install. Extracting skills for Claude Code.\n")
    );
  }

  // Compute project root for consistent lockfile + skill locations
  const projectRoot = opts.cwd
    ? process.cwd()
    : (findProjectRoot(process.cwd()) || process.cwd());

  // Install skills and commands with namespace prefix
  const sha = createHash("sha256").update(combined).digest("hex").slice(0, 12);
  const locations: string[] = [];

  for (const agent of selectedAgents) {
    const baseDir = resolveInstallBase(opts, agent);
    const plugDir = join(baseDir, pluginName);

    try {
      // Skills: {agent-dir}/{plugin-name}/{skill-name}/SKILL.md
      for (const skill of skills) {
        const skillDir = join(plugDir, skill.name);
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(join(skillDir, "SKILL.md"), skill.content, "utf-8");
      }
      // Commands: {agent-dir}/{plugin-name}/{command-name}.md
      for (const cmd of commands) {
        mkdirSync(plugDir, { recursive: true });
        writeFileSync(join(plugDir, cmd.name), cmd.content, "utf-8");
      }
      locations.push(`${agent.displayName}: ${plugDir}`);
    } catch (err) {
      console.error(
        yellow(`Failed to install to ${agent.displayName}: `) +
          dim((err as Error).message)
      );
    }
  }

  // Update lockfile (same projectRoot as skills)
  const lock = ensureLockfile(projectRoot);
  lock.skills[pluginName] = {
    version: pluginVersion,
    sha,
    tier: "SCANNED",
    installedAt: new Date().toISOString(),
    source: `github:${owner}/${repo}#plugin:${pluginName}`,
  };
  lock.agents = [...new Set([...(lock.agents || []), ...selectedAgents.map((a: { id: string }) => a.id)])];
  writeLockfile(lock, projectRoot);

  // Summary
  console.log(
    green(
      `\nInstalled ${bold(pluginName)} (${skills.length} skills, ${commands.length} commands) ` +
        `to ${locations.length} agent${locations.length === 1 ? "" : "s"}:\n`
    )
  );
  for (const loc of locations) {
    console.log(`  ${dim(">")} ${loc}`);
  }
  console.log(dim(`\nSHA: ${sha} | Version: ${pluginVersion}`));
  if (skills.length > 0) {
    console.log(dim(`Skills: ${skills.map((s) => `${pluginName}:${s.name}`).join(", ")}`));
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function addCommand(
  source: string | undefined,
  opts: AddOptions
): Promise<void> {
  // Bulk repo mode: --repo with --all
  if (opts.repo && opts.all) {
    return installAllRepoPlugins(opts.repo, opts);
  }

  // Remote plugin mode: GitHub repo with --plugin
  if (opts.repo && opts.plugin) {
    try {
      return await installRepoPlugin(opts.repo, opts.plugin, opts);
    } catch (err) {
      console.error(red((err as Error).message));
      process.exit(1);
    }
  }

  // Plugin directory mode: local path with --plugin
  if (opts.pluginDir && opts.plugin) {
    return installPluginDir(opts.pluginDir, opts.plugin, opts);
  }

  // All other modes require source
  if (!source) {
    console.error(red("Please provide a source (owner/repo, URL, or local path)"));
    process.exit(1);
    return;
  }

  // Skills.sh URL resolver — handle marketplace browse URLs
  if (source.includes("://")) {
    const skillsShResult = parseSkillsShUrl(source);
    if (isIncompleteParsed(skillsShResult)) {
      console.error(
        red("Incomplete skills.sh URL — expected /owner/toolkit/skill")
      );
      process.exit(1);
      return;
    }
    if (isCompleteParsed(skillsShResult)) {
      console.log(dim("Resolving skills.sh URL..."));
      // Resolve to owner/toolkit and install the specific skill
      source = `${skillsShResult.owner}/${skillsShResult.toolkit}`;
      opts.skill = skillsShResult.skill;
    }
  }

  // Normalize full GitHub URLs to owner/repo shorthand
  const parsed = parseGitHubSource(source);
  if (parsed) {
    source = `${parsed.owner}/${parsed.repo}`;
  }

  // GitHub mode: owner/repo or owner/repo/skill
  const parts = source.split("/");

  // 3-part format: owner/repo/skill-name → single skill install
  if (parts.length === 3) {
    const [threeOwner, threeRepo, threeSkill] = parts;
    return installSingleSkillLegacy(threeOwner, threeRepo, threeSkill, opts);
  }

  if (parts.length !== 2) {
    // No slash → try registry lookup by skill name
    console.log(
      yellow("Tip: Prefer owner/repo or owner/repo/skill format for direct GitHub installs.")
    );
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

  // Interactive agent/scope/method selection
  const selections = await promptInstallOptions(agents, opts);
  const selectedAgents = selections.agents;
  if (selections.global) opts.global = true;
  if (!selections.symlink) opts.copy = true;

  // Compute project root ONCE for consistent lockfile + skill locations
  const projectRoot = opts.cwd
    ? process.cwd()
    : (findProjectRoot(process.cwd()) || process.cwd());

  // Skill selection (multi-skill repos, when interactive)
  let selectedSkills = discovered;

  // Auto-filter when coming from registry with a known target skill name
  if (opts._targetSkill) {
    const target = opts._targetSkill.toLowerCase();
    const match = discovered.filter((s) => s.name.toLowerCase() === target);
    if (match.length > 0) {
      selectedSkills = match;
      console.log(dim(`Auto-selected skill: ${match[0].name}`));
    } else if (!isTTY() && discovered.length > 1) {
      // Non-TTY + multi-skill repo: don't silently install all — the user asked for a specific skill
      console.error(
        red(`Skill "${opts._targetSkill}" not found among ${discovered.length} skills in this repo.`) + "\n" +
        dim(`Available: ${discovered.map((s) => s.name).join(", ")}`) + "\n" +
        dim(`Use the exact name: vskill add ${owner}/${repo}/<skill-name>`)
      );
      process.exit(1);
    }
    // TTY + no match: falls through to interactive prompt (correct)
    delete opts._targetSkill;
  }

  if (selectedSkills.length > 1 && isTTY() && !opts.yes) {
    const prompter = createPrompter();
    const skillIndices = await prompter.promptCheckboxList(
      selectedSkills.map((s) => ({ label: s.name, description: s.description, checked: true })),
      { title: "Select skills to install" },
    );
    selectedSkills = skillIndices.map((i) => selectedSkills[i]);

    if (selectedSkills.length === 0) {
      console.log(dim("No skills selected. Aborting."));
      return process.exit(0);
    }
  }

  // Install selected skills
  const results: SkillInstallResult[] = [];
  for (const skill of selectedSkills) {
    console.log(dim(`\nInstalling skill: ${bold(skill.name)}...`));
    try {
      const result = await installOneGitHubSkill(owner, repo, skill.name, skill.rawUrl, opts, selectedAgents, projectRoot);
      results.push(result);
    } catch (err) {
      console.error(red(`  Unexpected error installing "${skill.name}": ${(err as Error).message}`));
      results.push({ skillName: skill.name, installed: false, verdict: "ERROR" });
    }
  }

  // Update lockfile with all installed skills (same projectRoot as skills)
  const lock = ensureLockfile(projectRoot);
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
  writeLockfile(lock, projectRoot);

  // Summary
  const installedCount = results.filter((r) => r.installed).length;
  console.log(green(`\nInstalled ${bold(String(installedCount))} of ${results.length} skills:\n`));
  for (const r of results) {
    const icon = r.installed ? green("✓") : red("✗");
    const scoreTag = r.score != null ? ` ${r.score}/100` : "";
    const detail = r.installed
      ? dim(`(${r.verdict}${scoreTag})`)
      : red(`(${r.verdict}${scoreTag})`);
    console.log(`  ${icon} ${r.skillName} ${detail}`);
    if (r.installed) reportInstall(r.skillName).catch(() => {});
  }
  const forceRecoverable = results.some(
    (r) => !r.installed && ["FAIL", "CONCERNS", "BLOCKED", "REJECTED", "SECURITY_FAIL"].includes(r.verdict),
  );
  if (forceRecoverable) {
    console.log(dim("\nUse --force to install skills that failed security checks."));
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
    console.log(yellow(`Tip: Next time use: vskill add ${ownerRepo}/${detail.name}`));
    return addCommand(ownerRepo, { ...opts, _targetSkill: detail.name });
  }

  const content = detail.content;

  // Blocklist + rejection check
  const safety = await checkInstallSafety(skillName);
  if (safety.blocked) {
    printBlockedError(safety.entry!);
    process.exit(1);
  }
  if (safety.rejected) {
    printRejectedWarning(safety.rejection!);
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

  // Interactive agent/scope selection
  const selections = await promptInstallOptions(agents, opts);
  const selectedAgents = selections.agents;
  if (selections.global) opts.global = true;

  // Compute project root for consistent lockfile + skill locations
  const projectRoot = opts.cwd
    ? process.cwd()
    : (findProjectRoot(process.cwd()) || process.cwd());

  // Install to each agent
  const sha = createHash("sha256").update(content).digest("hex").slice(0, 12);
  const locations: string[] = [];

  for (const agent of selectedAgents) {
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

  // Update lockfile (same projectRoot as skills)
  const lock = ensureLockfile(projectRoot);
  lock.skills[skillName] = {
    version: detail.version || "0.0.0",
    sha,
    tier: "SCANNED",
    installedAt: new Date().toISOString(),
    source: `registry:${skillName}`,
  };
  lock.agents = [...new Set([...(lock.agents || []), ...selectedAgents.map((a: { id: string }) => a.id)])];
  writeLockfile(lock, projectRoot);

  console.log(green(`\nInstalled ${bold(skillName)} to ${locations.length} agent${locations.length === 1 ? "" : "s"}:\n`));
  for (const loc of locations) {
    console.log(`  ${dim(">")} ${loc}`);
  }
  console.log(dim(`\nSHA: ${sha} | Version: ${detail.version || "0.0.0"}`));
  reportInstall(skillName).catch(() => {});
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

  // Blocklist + rejection check (before scanning)
  const skillName = skill || repo;
  const safety = await checkInstallSafety(skillName);
  if (safety.blocked) {
    printBlockedError(safety.entry!);
    process.exit(1);
  }
  if (safety.rejected) {
    printRejectedWarning(safety.rejection!);
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

  // Interactive agent/scope selection
  const selections = await promptInstallOptions(agents, opts);
  const selectedAgents = selections.agents;
  if (selections.global) opts.global = true;
  if (!selections.symlink) opts.copy = true;

  // Install to each agent using canonical installer
  const sha = createHash("sha256").update(content).digest("hex").slice(0, 12);
  const projectRoot = opts.cwd
    ? process.cwd()
    : (findProjectRoot(process.cwd()) || process.cwd());
  const installOpts = { global: !!opts.global, projectRoot };

  const locations = opts.copy
    ? installCopy(skillName, content, selectedAgents, installOpts)
    : installSymlink(skillName, content, selectedAgents, installOpts);

  // Update lockfile (same projectRoot as skills)
  const lock = ensureLockfile(projectRoot);
  lock.skills[skillName] = {
    version: "0.0.0",
    sha,
    tier: "SCANNED",
    installedAt: new Date().toISOString(),
    source: `github:${owner}/${repo}`,
  };
  lock.agents = [...new Set([...(lock.agents || []), ...selectedAgents.map((a: { id: string }) => a.id)])];
  writeLockfile(lock, projectRoot);

  // Phone home (fire-and-forget)
  reportInstall(skillName).catch(() => {});

  // Print summary
  const method = opts.copy ? "copied" : "symlinked";
  console.log(green(`\nInstalled ${bold(skillName)} (${method}) to ${locations.length} agent${locations.length === 1 ? "" : "s"}:\n`));
  for (const loc of locations) {
    console.log(`  ${dim(">")} ${loc}`);
  }
  console.log(dim(`\nSHA: ${sha}`));
}
