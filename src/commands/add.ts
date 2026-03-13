// ---------------------------------------------------------------------------
// vskill install -- install a skill from GitHub or local plugin directory
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
import os from "node:os";
import { resolveTilde } from "../utils/paths.js";
import { findProjectRoot } from "../utils/project-root.js";
import { reportInstall, reportInstallBatch, submitSkill } from "../api/client.js";
import { filterAgents } from "../utils/agent-filter.js";
import { detectInstalledAgents, AGENTS_REGISTRY } from "../agents/agents-registry.js";
import type { AgentDefinition } from "../agents/agents-registry.js";
import { ensureLockfile, writeLockfile, readLockfile, removeSkillFromLock } from "../lockfile/index.js";
import { runTier1Scan } from "../scanner/index.js";
import { getAvailablePlugins, getPluginSource, getPluginVersion, hasPlugin, discoverUnregisteredPlugins } from "../marketplace/index.js";
import type { UnregisteredPlugin } from "../marketplace/index.js";
import { checkInstallSafety } from "../blocklist/blocklist.js";
import type { BlocklistEntry, RejectionInfo } from "../blocklist/types.js";
import { getSkill, searchSkills } from "../api/client.js";
import type { SkillSearchResult } from "../api/client.js";
import { checkPlatformSecurity } from "../security/index.js";
import { discoverSkills, getDefaultBranch, warnRateLimitOnce } from "../discovery/github-tree.js";
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
  link,
  formatInstalls,
} from "../utils/output.js";
import { isTTY, createPrompter } from "../utils/prompts.js";
import { installSymlink, installCopy } from "../installer/canonical.js";
import { getMarketplaceName } from "../marketplace/index.js";

// ---------------------------------------------------------------------------
// Marketplace detection — auto-detect Claude Code plugin marketplaces
// ---------------------------------------------------------------------------

interface MarketplaceDetectionResult {
  isMarketplace: boolean;
  manifestContent?: string;
}

/**
 * Try to parse marketplace manifest content from a GitHub Contents API response.
 * Returns the manifest string if valid, or null.
 */
function parseManifestFromContentsApi(
  data: { download_url?: string; content?: string; encoding?: string },
): Promise<string | null>;
async function parseManifestFromContentsApi(
  data: { download_url?: string; content?: string; encoding?: string },
): Promise<string | null> {
  // Prefer download_url for raw content
  if (data.download_url) {
    const rawRes = await fetch(data.download_url);
    if (rawRes.ok) {
      const content = await rawRes.text();
      if (getAvailablePlugins(content).length > 0) return content;
    }
  }
  // Fallback: decode base64 content from API response
  if (data.content && data.encoding === "base64") {
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    if (getAvailablePlugins(content).length > 0) return content;
  }
  return null;
}

/**
 * Check if a GitHub repo contains `.claude-plugin/marketplace.json`.
 *
 * Strategy: Contents API → retry once (1s) → raw fallback → give up.
 * On 404, returns immediately (not a marketplace repo — no retry needed).
 * On 403 rate limit, warns once and falls through to raw fallback.
 */
export async function detectMarketplaceRepo(
  owner: string,
  repo: string,
): Promise<MarketplaceDetectionResult> {
  const contentsUrl = `https://api.github.com/repos/${owner}/${repo}/contents/.claude-plugin/marketplace.json`;
  const headers = { Accept: "application/vnd.github.v3+json", "User-Agent": "vskill-cli" };

  // Attempt 1: Contents API
  try {
    const res = await fetch(contentsUrl, { headers });
    if (res.status === 404) return { isMarketplace: false };
    if (res.status === 403) warnRateLimitOnce(res);
    if (res.ok) {
      const data = (await res.json()) as { download_url?: string; content?: string; encoding?: string };
      const content = await parseManifestFromContentsApi(data);
      if (content) return { isMarketplace: true, manifestContent: content };
    }
  } catch {
    // network error — continue to retry
  }

  // Attempt 2: Retry Contents API after 1s delay
  try {
    await new Promise((r) => setTimeout(r, 1000));
    const res = await fetch(contentsUrl, { headers });
    if (res.status === 404) return { isMarketplace: false };
    if (res.status === 403) warnRateLimitOnce(res);
    if (res.ok) {
      const data = (await res.json()) as { download_url?: string; content?: string; encoding?: string };
      const content = await parseManifestFromContentsApi(data);
      if (content) return { isMarketplace: true, manifestContent: content };
    }
  } catch {
    // network error — continue to raw fallback
  }

  // Attempt 3: Raw fallback (bypasses API rate limits)
  try {
    const branch = await getDefaultBranch(owner, repo);
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/.claude-plugin/marketplace.json`;
    const res = await fetch(rawUrl);
    if (res.ok) {
      const content = await res.text();
      if (getAvailablePlugins(content).length > 0) {
        return { isMarketplace: true, manifestContent: content };
      }
    }
  } catch {
    // all attempts exhausted
  }

  return { isMarketplace: false };
}

/**
 * Install plugins from a Claude Code plugin marketplace repo.
 *
 * Shows a checkbox list of available plugins (all unchecked by default),
 * then installs each selected plugin via file-system extraction to agent skill dirs.
 */
async function installMarketplaceRepo(
  owner: string,
  repo: string,
  manifestContent: string,
  opts: AddOptions,
  preSelected?: string[],
): Promise<void> {
  const plugins = getAvailablePlugins(manifestContent);
  const marketplaceName = getMarketplaceName(manifestContent);

  if (plugins.length === 0) {
    console.error(red("No plugins found in marketplace.json"));
    process.exit(1);
  }

  // Discover plugin directories not yet in marketplace.json
  const discoveryResult = await discoverUnregisteredPlugins(owner, repo, manifestContent, warnRateLimitOnce);
  const unregistered = discoveryResult.plugins;

  const headerParts = [
    `\n${bold("Claude Code Plugin Marketplace")} detected: ${cyan(`${owner}/${repo}`)}\n`,
    dim(`Marketplace: ${marketplaceName || "unknown"} — ${plugins.length} registered plugin${plugins.length === 1 ? "" : "s"}`),
  ];
  if (unregistered.length > 0) {
    headerParts.push(dim(`, ${unregistered.length} unregistered`));
  }
  headerParts.push("\n");
  if (unregistered.length > 0) {
    headerParts.push(yellow(`  ${unregistered.length} new plugin${unregistered.length === 1 ? "" : "s"} not yet in marketplace.json\n`));
  }
  if (discoveryResult.failed && unregistered.length === 0) {
    headerParts.push(yellow("  Plugin list may be incomplete — could not fetch latest from GitHub\n"));
  }
  console.log(headerParts.join(""));

  // Check lockfile for already-installed plugins
  const lockDir = lockfileRoot(opts);
  const lock = readLockfile(lockDir);
  const installedSet = new Set<string>();
  if (lock) {
    for (const [name, entry] of Object.entries(lock.skills)) {
      if (entry.source?.includes(`${owner}/${repo}`)) {
        installedSet.add(name);
      }
    }
  }

  // Select plugins
  let selectedPlugins: typeof plugins;
  let selectedUnregistered: UnregisteredPlugin[] = [];
  let usedInteractiveCheckbox = false;

  // When a specific plugin is named (preSelected), skip the checkbox entirely
  if (preSelected && preSelected.length > 0) {
    const matched = plugins.filter((p) => preSelected.includes(p.name));
    if (matched.length > 0) {
      selectedPlugins = matched;
      console.log(dim(`Installing ${matched.length} plugin${matched.length === 1 ? "" : "s"}: ${matched.map((p) => p.name).join(", ")}`));
    } else {
      // Named plugin not in marketplace — try unregistered
      const matchedUnreg = unregistered.filter((u) => preSelected.includes(u.name));
      if (matchedUnreg.length > 0) {
        selectedPlugins = [];
        selectedUnregistered = matchedUnreg;
        console.log(dim(`Installing ${matchedUnreg.length} unregistered plugin${matchedUnreg.length === 1 ? "" : "s"}: ${matchedUnreg.map((u) => u.name).join(", ")}`));
      } else {
        console.error(red(`Plugin "${preSelected[0]}" not found in marketplace or repo.`));
        process.exit(1);
        return;
      }
    }
  } else if (!isTTY() && !opts.yes && !opts.all) {
    // Non-TTY: list plugins and exit with guidance
    console.log("Available plugins:\n");
    for (const p of plugins) {
      const installed = installedSet.has(p.name) ? dim(" (installed)") : "";
      console.log(`  ${bold(p.name)}${installed}${p.description ? dim(` — ${p.description}`) : ""}`);
    }
    if (unregistered.length > 0) {
      console.log("\nUnregistered plugins (not in marketplace.json):\n");
      for (const u of unregistered) {
        console.log(`  ${yellow(u.name)} ${dim("(new — not in marketplace.json)")}`);
      }
      console.log(dim("\nUse --force --plugin <name> to install unregistered plugins."));
    }
    console.error(red("\nNon-interactive mode. Use --plugin <name> or --yes to select all."));
    process.exit(1);
  } else if (opts.yes || opts.all) {
    selectedPlugins = plugins;
    console.log(dim(`Auto-selecting all ${plugins.length} plugins (--yes/--all)`));
    if (unregistered.length > 0) {
      if (opts.force) {
        selectedUnregistered = unregistered;
        console.log(dim(`  Including ${unregistered.length} unregistered plugin${unregistered.length === 1 ? "" : "s"} (--force): ${unregistered.map((u) => u.name).join(", ")}`));
      } else {
        console.log(
          dim(`  Skipping ${unregistered.length} unregistered plugin${unregistered.length === 1 ? "" : "s"}: `) +
            dim(unregistered.map((u) => u.name).join(", ")) +
            dim(" (use --force to include)"),
        );
      }
    }
  } else if (plugins.length === 1 && unregistered.length === 0) {
    // Single plugin, no unregistered — show details and ask for confirmation
    const p = plugins[0];
    const isInstalled = installedSet.has(p.name);
    const versionTag = p.version ? ` v${p.version}` : "";
    const descTag = p.description ? dim(` — ${p.description}`) : "";

    console.log(`\n  Plugin: ${bold(p.name)}${versionTag}${descTag}`);

    if (isInstalled) {
      const prompter = createPrompter();
      const reinstall = await prompter.promptConfirm(
        `${bold(p.name)} is already installed. Reinstall?`,
        true,
      );
      if (!reinstall) {
        console.log(dim("Aborted."));
        return;
      }
    } else {
      const prompter = createPrompter();
      const proceed = await prompter.promptConfirm(
        `Install ${bold(p.name)}${versionTag}?`,
        true,
      );
      if (!proceed) {
        console.log(dim("Aborted."));
        return;
      }
    }
    selectedPlugins = plugins;
  } else {
    // Build combined picker: registered plugins first, then unregistered (nothing pre-checked)
    const combinedItems = [
      ...plugins.map((p) => ({
        label: p.name + (installedSet.has(p.name) ? dim(" (installed)") : ""),
        description: p.description,
        checked: false,
      })),
      ...unregistered.map((u) => ({
        label: u.name + (installedSet.has(u.name) ? dim(" (installed)") : yellow(" (new — not in marketplace.json)")),
        description: undefined as string | undefined,
        checked: false,
      })),
    ];

    const prompter = createPrompter();
    const indices = await prompter.promptCheckboxList(
      combinedItems,
      { title: "Select plugins to install" },
    );

    if (indices.length === 0) {
      console.log(dim("No plugins selected. Aborting."));
      return;
    }

    // Partition selections into registered and unregistered
    selectedPlugins = [];
    selectedUnregistered = [];
    for (const i of indices) {
      if (i < plugins.length) {
        selectedPlugins.push(plugins[i]);
      } else {
        selectedUnregistered.push(unregistered[i - plugins.length]);
      }
    }
    usedInteractiveCheckbox = true;
  }

  // Uninstall plugins that were previously installed but now unchecked
  const selectedNames = new Set([
    ...selectedPlugins.map((p) => p.name),
    ...selectedUnregistered.map((p) => p.name),
  ]);
  const toUninstall = usedInteractiveCheckbox
    ? [...installedSet].filter((name) => !selectedNames.has(name))
    : [];

  if (toUninstall.length > 0) {
    console.log(dim(`\nUninstalling ${toUninstall.length} deselected plugin${toUninstall.length === 1 ? "" : "s"}...\n`));
    const agents = await detectInstalledAgents();

    for (const skillName of toUninstall) {
      // Remove skill directories from all agents
      let removedCount = 0;
      for (const agent of agents) {
        const localDir = join(process.cwd(), agent.localSkillsDir, skillName);
        const globalDir = resolveTilde(join(agent.globalSkillsDir, skillName));
        for (const dir of [localDir, globalDir]) {
          if (existsSync(dir)) {
            try {
              rmSync(dir, { recursive: true, force: true });
              removedCount++;
            } catch { /* ignore removal errors */ }
          }
        }
      }

      // Remove from lockfile
      removeSkillFromLock(skillName, lockDir);

      console.log(red(`  ✗ ${bold(skillName)} uninstalled`) + (removedCount > 0 ? dim(` (${removedCount} location${removedCount === 1 ? "" : "s"})`) : ""));
    }
  }

  // Gate: unregistered plugins — check verification, submit for scanning, warn if needed
  if (selectedUnregistered.length > 0 && !opts.force) {
    const names = selectedUnregistered.map((p) => p.name).join(", ");
    console.log(
      yellow(`\n  ⚠ ${selectedUnregistered.length} plugin${selectedUnregistered.length === 1 ? "" : "s"} not in marketplace.json: ${bold(names)}`) + "\n" +
        dim("  Checking verification status..."),
    );

    // Submit each skill for scanning and collect verification results
    const repoUrl = `https://github.com/${owner}/${repo}`;
    let verifiedCount = 0;
    let unverifiedCount = 0;
    let blockedCount = 0;
    for (const unreg of selectedUnregistered) {
      const pluginPath = unreg.source.replace(/^\.\//, "");
      try {
        // Discover skills: try nested {pluginPath}/skills/ first, fall back to flat {pluginPath}/SKILL.md
        const skillsToSubmit: Array<{ name: string; path: string }> = [];
        const skillsUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${pluginPath}/skills`;
        const skillsRes = await fetch(skillsUrl, { headers: { "User-Agent": "vskill-cli" } });
        if (skillsRes.ok) {
          const skillDirs = ((await skillsRes.json()) as Array<{ name: string; type: string }>)
            .filter((e) => e.type === "dir");
          for (const sd of skillDirs) {
            skillsToSubmit.push({ name: sd.name, path: `${pluginPath}/skills/${sd.name}/SKILL.md` });
          }
        } else {
          // Flat layout: SKILL.md at plugin root
          skillsToSubmit.push({ name: unreg.name, path: `${pluginPath}/SKILL.md` });
        }

        for (const skill of skillsToSubmit) {
          try {
            const sub = await submitSkill({ repoUrl, skillName: skill.name, skillPath: skill.path, source: "cli-auto" });
            if (sub.alreadyVerified) {
              verifiedCount++;
              const skillUrl = `https://verified-skill.com/skills/${skill.name}`;
              console.log(green(`  ${bold(skill.name)} is already verified.`));
              console.log(dim("  View: ") + link(skillUrl, skillUrl));
            } else if (sub.blocked) {
              blockedCount++;
              console.log(red(`  ${bold(skill.name)} is blocked.`));
            } else {
              unverifiedCount++;
              const subId = sub.id ?? sub.submissionId;
              const trackUrl = `https://verified-skill.com/submit/${subId}`;
              if (sub.duplicate) {
                console.log(yellow(`  ${bold(skill.name)} is already in the queue.`));
              } else {
                console.log(green(`  Submitted ${bold(skill.name)} for scanning.`));
              }
              console.log(dim("  Track: ") + link(trackUrl, trackUrl));
            }
          } catch {
            unverifiedCount++;
            const submitUrl = `https://verified-skill.com/submit`;
            console.log(yellow(`  Could not submit ${skill.name} automatically.`));
            console.log(dim("  Submit manually: ") + link(submitUrl, submitUrl));
          }
        }
      } catch { /* skip discovery errors */ }
    }
    console.log();

    // If all skills are already verified, skip the confirmation prompt
    if (unverifiedCount === 0 && blockedCount === 0 && verifiedCount > 0) {
      console.log(green(`  All ${verifiedCount} skill${verifiedCount === 1 ? "" : "s"} already verified — no confirmation needed.\n`));
    } else if (blockedCount > 0) {
      // Blocked skills — refuse installation
      console.log(red(`  ${blockedCount} blocked skill${blockedCount === 1 ? "" : "s"} — cannot install.\n`));
      selectedUnregistered = [];
    } else if (isTTY()) {
      const prompter = createPrompter();
      const proceed = await prompter.promptConfirm(
        `Install ${unverifiedCount} unverified skill${unverifiedCount === 1 ? "" : "s"}? (may be insecure)`,
        false,
      );
      if (!proceed) {
        console.log(dim("  Skipping unverified plugins."));
        selectedUnregistered = [];
      }
    } else {
      // Non-interactive: require --force for unverified plugins
      console.log(dim("  Use --force to install unverified plugins in non-interactive mode."));
      selectedUnregistered = [];
    }
  }

  const results: { name: string; installed: boolean; method: string }[] = [];

  // ── Step 1: Agent selection + skill file install ──────────
  const branch = await getDefaultBranch(owner, repo);
  let agents = await detectInstalledAgents();
  const selections = await promptInstallOptions(agents, opts);
  agents = selections.agents;
  if (selections.global) opts.global = true;
  if (!selections.symlink) opts.copy = true;

  // Combine all selected plugins (registered + unregistered) for skill file install
  const allPluginsToInstall: Array<{ name: string; source: string; isUnregistered: boolean }> = [
    ...selectedPlugins.map((p) => ({
      name: p.name,
      source: getPluginSource(p.name, manifestContent || "") || "",
      isUnregistered: false,
    })),
    ...selectedUnregistered.map((u) => ({
      name: u.name,
      source: u.source,
      isUnregistered: true,
    })),
  ];

  for (const plugin of allPluginsToInstall) {
    const pluginPath = plugin.source.replace(/^\.\//, "");
    if (!pluginPath) {
      results.push({ name: plugin.name, installed: false, method: "failed" });
      continue;
    }
    const installSpin = spinner(`Installing skills: ${bold(plugin.name)}`);

    try {
      // Discover skills: try {pluginPath}/skills/ first, then fall back to {pluginPath}/SKILL.md
      const installedSkillNames: string[] = [];
      const skillsUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${pluginPath}/skills`;
      const skillsRes = await fetch(skillsUrl, { headers: { "User-Agent": "vskill-cli" } });

      if (skillsRes.ok) {
        // Nested layout: {pluginPath}/skills/{skillName}/SKILL.md
        const skillDirs = ((await skillsRes.json()) as Array<{ name: string; type: string }>)
          .filter((e) => e.type === "dir");
        for (const sd of skillDirs) {
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${pluginPath}/skills/${sd.name}/SKILL.md`;
          const contentRes = await fetch(rawUrl);
          if (!contentRes.ok) continue;
          const content = await contentRes.text();
          for (const agent of agents) {
            const baseDir = resolveInstallBase(opts, agent);
            const skillDir = join(baseDir, sd.name);
            mkdirSync(skillDir, { recursive: true });
            writeFileSync(join(skillDir, "SKILL.md"), content, "utf-8");
          }
          installedSkillNames.push(sd.name);
        }
      } else {
        // Flat layout: {pluginPath}/SKILL.md directly in the plugin root
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${pluginPath}/SKILL.md`;
        const contentRes = await fetch(rawUrl);
        if (contentRes.ok) {
          const content = await contentRes.text();
          for (const agent of agents) {
            const baseDir = resolveInstallBase(opts, agent);
            const skillDir = join(baseDir, plugin.name);
            mkdirSync(skillDir, { recursive: true });
            writeFileSync(join(skillDir, "SKILL.md"), content, "utf-8");
          }
          installedSkillNames.push(plugin.name);
        }
      }

      installSpin.stop();
      if (installedSkillNames.length > 0) {
        const tier = plugin.isUnregistered ? "unverified" : "verified";
        console.log(green(`  ✓ ${bold(plugin.name)}`) + dim(` (${installedSkillNames.join(", ")}) [${tier}]`));
        results.push({ name: plugin.name, installed: true, method: plugin.isUnregistered ? "extraction-unregistered" : "extraction" });
      } else {
        console.log(red(`  ✗ ${bold(plugin.name)}`) + dim(" — no SKILL.md found"));
        results.push({ name: plugin.name, installed: false, method: "failed" });
      }
    } catch (err) {
      installSpin.stop();
      console.error(red(`  ✗ ${plugin.name}: ${(err as Error).message}`));
      results.push({ name: plugin.name, installed: false, method: "failed" });
    }
  }

  // Update lockfile
  const lockForWrite = ensureLockfile(lockDir);
  for (const r of results) {
    if (r.installed) {
      const isUnregistered = r.method === "extraction-unregistered";
      const pluginVersion = isUnregistered ? "0.0.0" : (getPluginVersion(r.name, manifestContent) || "0.0.0");
      lockForWrite.skills[r.name] = {
        version: pluginVersion,
        sha: "",
        tier: isUnregistered ? "UNSCANNED" : "VERIFIED",
        installedAt: new Date().toISOString(),
        source: `marketplace:${owner}/${repo}#${r.name}`,
        marketplace: marketplaceName || undefined,
        pluginDir: true,
        scope: opts.global ? "user" : "project",
      };
    }
  }
  writeLockfile(lockForWrite, lockDir);

  // Telemetry — batch report for all installed plugins (awaited to prevent process exit race)
  const repoUrl = `${owner}/${repo}`;
  const installedSkills = results
    .filter((r) => r.installed)
    .map((r) => ({ skillName: r.name, repoUrl }));
  if (installedSkills.length > 0) {
    await reportInstallBatch(installedSkills).catch(() => {});
  }

  // Summary
  const installed = results.filter((r) => r.installed);
  const failed = results.filter((r) => !r.installed);
  const parts: string[] = [];
  if (installed.length > 0 || results.length > 0) {
    parts.push(`${green(bold(`${installed.length} installed`))}`);
  }
  if (failed.length > 0) {
    parts.push(`${red(bold(`${failed.length} failed`))}`);
  }
  if (toUninstall.length > 0) {
    parts.push(`${red(bold(`${toUninstall.length} uninstalled`))}`);
  }
  if (parts.length > 0) {
    console.log(`\n${parts.join(", ")} of ${results.length + toUninstall.length} plugins`);
  } else {
    console.log(dim("\nNo changes made."));
  }
}

// ---------------------------------------------------------------------------
// Command file filter (prevents plugin internals leaking as slash commands)
// ---------------------------------------------------------------------------

/**
 * Returns true for .md files that should NOT be installed into an agent's
 * commands directory. Claude Code (and similar agents) register every .md
 * file they find recursively as a slash command, so plugin-internal files
 * must be excluded.
 */
export function shouldSkipFromCommands(relPath: string): boolean {
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

  if (parts[0] === "skills" && parts.length > 2 && filename !== "SKILL.md") {
    // Allow agents/*.md files inside skill directories (skills/{name}/agents/*.md)
    if (parts[2] === "agents" && filename.endsWith(".md")) return false;
    return true;
  }

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
 * Remove stale plugin cache from ~/.claude/plugins/cache/.
 * Previous native installs may have left cached files that leak as ghost slash commands.
 */
function cleanPluginCache(pluginName: string, marketplace: string): void {
  const cacheDir = join(resolveTilde("~/.claude/plugins/cache"), marketplace, pluginName);
  try {
    if (existsSync(cacheDir)) {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  } catch { /* ignore - cache dir might not exist */ }
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
  /** Filter which skills to install from a plugin (comma-separated names) */
  onlySkills?: string;
}

/**
 * Resolve the project root for skill installation, with a HOME-directory guard.
 *
 * When `--cwd` is set, uses process.cwd() directly.
 * Otherwise walks up looking for project markers (.git, package.json, etc.).
 * If the resolved root IS the home directory (or none found), falls back to
 * process.cwd() to avoid polluting $HOME with skill files.
 */
function safeProjectRoot(opts: { cwd?: boolean }): string {
  if (opts.cwd) return process.cwd();
  const resolved = findProjectRoot(process.cwd());
  if (resolved === null || resolved === os.homedir()) return process.cwd();
  return resolved;
}

/**
 * Resolve the directory for the lockfile based on scope.
 *
 * Global scope  → ~/.agents/ (canonical global directory)
 * Project scope → safeProjectRoot(opts) (same as before)
 */
function lockfileRoot(opts: AddOptions): string {
  if (opts.global) {
    return join(os.homedir(), ".agents");
  }
  return safeProjectRoot(opts);
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
 * 3. default   -> process.cwd() + agent's localSkillsDir
 */
function resolveInstallBase(
  opts: AddOptions,
  agent: { globalSkillsDir: string; localSkillsDir: string },
): string {
  if (opts.global) {
    return resolveTilde(agent.globalSkillsDir);
  }
  return resolveSkillsPath(safeProjectRoot(opts), agent.localSkillsDir);
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
      checked: false,
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

  // Scope: always project unless --global flag was explicitly passed
  useGlobal = !!opts.global;

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
      : resolveSkillsPath(safeProjectRoot(opts), agent.localSkillsDir);
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
            dim("Make sure the repo exists and has a SKILL.md on the default branch.")
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
  console.error(dim(`  Details: https://verified-skill.com/skills/${entry.skillName}`));
  console.error(dim("\n  Use --force to override (NOT recommended)"));
}

function printBlockedWarning(entry: BlocklistEntry): void {
  console.error(yellow(bold("\n  WARNING: Installing known-malicious skill with --force")));
  console.error(yellow(`  Skill: "${entry.skillName}"`));
  console.error(yellow(`  Threat: ${entry.threatType} (${entry.severity})`));
  console.error(yellow(`  Reason: ${entry.reason}`));
  console.error(dim(`  Details: https://verified-skill.com/skills/${entry.skillName}`));
  console.error("");
}

function printRejectedWarning(rejection: RejectionInfo): void {
  console.error(yellow(bold("\n  WARNING: Skill failed platform verification")));
  console.error(yellow(`  Skill: "${rejection.skillName}"`));
  if (rejection.score != null) {
    console.error(yellow(`  Score: ${rejection.score}/100`));
  }
  console.error(yellow(`  Reason: ${rejection.reason}`));
  console.error(dim(`  Details: https://verified-skill.com/skills/${rejection.skillName}`));
  console.error("");
}

function printTaintedWarning(skillName: string, reason?: string): void {
  console.error(yellow(bold("\n  TAINTED: Author has blocked skills")));
  console.error(yellow(`  Another skill from this author was blocked for malicious behavior.`));
  if (reason) console.error(yellow(`  Reason: ${reason}`));
  console.error(dim(`  Details: https://verified-skill.com/skills/${skillName}`));
  console.error(dim("  Exercise caution — review the source code before using."));
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
    const mktPath = join(basePath, ".claude-plugin", "marketplace.json");
    let available = "";
    if (existsSync(mktPath)) {
      const mktJson = readFileSync(mktPath, "utf-8");
      const allPlugins = getAvailablePlugins(mktJson);
      if (allPlugins.length > 0) {
        available = `\nAvailable plugins: ${allPlugins.map((p) => bold(p.name)).join(", ")}`;
      }
    }
    console.error(
      red(`Plugin "${pluginName}" not found in marketplace.json\n`) +
        dim(`Checked: ${mktPath}`) +
        available
    );
    process.exit(1);
  }

  // Blocklist + rejection check (before scanning)
  const safety = await checkInstallSafety(pluginName);
  if (safety.blocked && !opts.force) {
    printBlockedError(safety.entry!);
    process.exit(1);
  }
  if (safety.blocked && opts.force) {
    printBlockedWarning(safety.entry!);
  }
  if (safety.rejected) {
    printRejectedWarning(safety.rejection!);
  }
  if (safety.tainted) {
    printTaintedWarning(pluginName, safety.taintReason);
  }

  // Pre-install overview
  console.log(`\n${bold("Install Preview")}`);
  console.log(dim("  ─────────────────────────────────────────────────"));
  console.log(`  Plugin: ${bold(pluginName)}`);
  console.log(`  Source: ${dim(pluginDir)}`);
  console.log(dim("  ─────────────────────────────────────────────────\n"));

  // Collect all file content for scanning
  console.log(dim("Collecting plugin files for security scan..."));
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

  // Extract git remote URL for install tracking
  let gitUrl: string | undefined;
  try {
    gitUrl = execSync("git remote get-url origin", { cwd: resolve(basePath), stdio: ["pipe", "pipe", "ignore"], timeout: 5_000 })
      .toString().trim() || undefined;
  } catch { /* not a git repo or no remote — use local path */ }

  // Clean stale plugin cache
  try {
    const marketplaceName = JSON.parse(mktContent).name;
    if (marketplaceName) {
      cleanPluginCache(pluginName, marketplaceName);
    }
  } catch { /* ignore parse errors */ }

  // Install: recursively copy plugin directory to each agent
  const sha = createHash("sha256").update(content).digest("hex").slice(0, 12);
  const locations: string[] = [];

  for (const agent of selectedAgents) {
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

  // Compute lockfile directory (global → ~/.agents/, project → project root)
  const lockDir = lockfileRoot(opts);

  // Update lockfile
  const lock = ensureLockfile(lockDir);
  lock.skills[pluginName] = {
    version,
    sha,
    tier: "VERIFIED",
    installedAt: new Date().toISOString(),
    source: `local:${basePath}`,
    scope: opts.global ? "user" : "project",
  };
  lock.agents = [...new Set([...(lock.agents || []), ...selectedAgents.map((a: { id: string }) => a.id)])];
  writeLockfile(lock, lockDir);

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

  // Report skill installs in a single batch (fire-and-forget)
  // Derive owner/repo from gitUrl (e.g. "https://github.com/org/repo.git" → "org/repo")
  try {
    const ownerRepo = gitUrl
      ? gitUrl.replace(/\.git$/, "").replace(/.*github\.com[/:]/, "")
      : undefined;
    const skillDirs = readdirSync(pluginDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(pluginDir, d.name, "SKILL.md")));
    const batch = skillDirs.map((d) => ({
      skillName: d.name,
      ...(ownerRepo ? { repoUrl: ownerRepo } : {}),
    }));
    if (batch.length > 0) await reportInstallBatch(batch).catch(() => {});
  } catch { /* best-effort */ }
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
  agentRawUrls?: Record<string, string>,
): Promise<SkillInstallResult> {
  // Blocklist + rejection check BEFORE fetching (prevents misleading 404)
  const safety = await checkInstallSafety(skillName);
  if (safety.blocked && !opts.force) {
    printBlockedError(safety.entry!);
    return { skillName, installed: false, verdict: "BLOCKED" };
  }
  if (safety.blocked && opts.force) {
    printBlockedWarning(safety.entry!);
  }
  if (safety.rejected) {
    printRejectedWarning(safety.rejection!);
  }
  if (safety.tainted) {
    printTaintedWarning(skillName, safety.taintReason);
  }

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

  // Fetch agent files (agents/*.md) if discovered
  let agentFiles: Record<string, string> | undefined;
  if (agentRawUrls && Object.keys(agentRawUrls).length > 0) {
    agentFiles = {};
    const fetches = Object.entries(agentRawUrls).map(async ([relPath, url]) => {
      try {
        const res = await fetch(url);
        if (res.ok) agentFiles![relPath] = await res.text();
      } catch { /* skip failed agent file fetches */ }
    });
    await Promise.allSettled(fetches);
    if (Object.keys(agentFiles).length === 0) agentFiles = undefined;
  }

  // Install to each agent using canonical installer
  const sha = createHash("sha256").update(content).digest("hex").slice(0, 12);
  const installOpts = { global: !!opts.global, projectRoot };

  try {
    if (opts.copy) {
      installCopy(skillName, content, agents as AgentDefinition[], installOpts, agentFiles);
    } else {
      installSymlink(skillName, content, agents as AgentDefinition[], installOpts, agentFiles);
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
  const branch = await getDefaultBranch(owner, repo);
  const manifestUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/.claude-plugin/marketplace.json`;
  const manifestSpin = spinner("Fetching marketplace.json");
  let manifestContent: string;
  try {
    const res = await fetch(manifestUrl);
    if (!res.ok) {
      manifestSpin.stop();
      console.error(
        red(`marketplace.json not found at ${owner}/${repo}\n`) +
          dim("Ensure the repo has .claude-plugin/marketplace.json on the default branch.")
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
  overrideSource?: string,
): Promise<void> {
  const [owner, repo] = ownerRepo.split("/");
  if (!owner || !repo) {
    throw new Error("--repo must be in owner/repo format (e.g. anton-abyzov/vskill)");
  }

  // Fetch marketplace.json from GitHub
  const branch = await getDefaultBranch(owner, repo);
  const manifestUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/.claude-plugin/marketplace.json`;
  const manifestSpin = spinner("Fetching marketplace.json");
  let manifestContent: string;
  try {
    const res = await fetch(manifestUrl);
    if (!res.ok) {
      manifestSpin.stop();
      throw new Error(
        `marketplace.json not found at ${owner}/${repo}. ` +
          "Ensure the repo has .claude-plugin/marketplace.json on the default branch."
      );
    }
    manifestContent = await res.text();
    manifestSpin.stop(green("Found marketplace.json"));
  } catch (err) {
    manifestSpin.stop();
    if (err instanceof Error && err.message.startsWith("marketplace.json not found")) throw err;
    throw new Error(`Network error: ${(err as Error).message}`);
  }

  // Find the plugin in the marketplace (or use override for unregistered plugins)
  const pluginSource = overrideSource || getPluginSource(pluginName, manifestContent);
  if (!pluginSource) {
    const available = getAvailablePlugins(manifestContent).map((p) => p.name);
    throw new Error(
      `Plugin "${pluginName}" not found in marketplace.json. ` +
        `Available plugins: ${available.join(", ")}`
    );
  }
  const pluginVersion = overrideSource ? "0.0.0" : (getPluginVersion(pluginName, manifestContent) || "0.0.0");
  const pluginPath = pluginSource.replace(/^\.\//, "");

  // Blocklist + rejection check BEFORE fetching content
  const safety = await checkInstallSafety(pluginName);
  if (safety.blocked && !opts.force) {
    printBlockedError(safety.entry!);
    throw new Error(`Plugin "${pluginName}" is on the blocklist`);
  }
  if (safety.blocked && opts.force) {
    printBlockedWarning(safety.entry!);
  }
  if (safety.rejected) {
    printRejectedWarning(safety.rejection!);
  }
  if (safety.tainted) {
    printTaintedWarning(pluginName, safety.taintReason);
  }

  // Discover skills via GitHub Contents API
  const discoverSpin = spinner(`Discovering skills in ${pluginName}`);
  interface GHEntry { name: string; type: string; download_url?: string }

  let skillEntries: GHEntry[] = [];
  let flatLayout = false;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${pluginPath}/skills`,
      { headers: { "User-Agent": "vskill-cli" } },
    );
    if (res.ok) {
      skillEntries = ((await res.json()) as GHEntry[]).filter((e) => e.type === "dir");
    }
  } catch { /* skills dir might not exist */ }

  // Flat layout fallback: check for SKILL.md directly at plugin root
  if (skillEntries.length === 0) {
    try {
      const res = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${pluginPath}/SKILL.md`,
      );
      if (res.ok) {
        flatLayout = true;
        skillEntries = [{ name: pluginName, type: "dir" }];
      }
    } catch { /* flat layout not available */ }
  }

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

  // Filter skills by --only-skills if provided
  if (opts.onlySkills) {
    const allowed = new Set(opts.onlySkills.split(",").map((s) => s.trim().toLowerCase()));
    const before = skillEntries.length;
    skillEntries = skillEntries.filter((e) => allowed.has(e.name.toLowerCase()));
    if (skillEntries.length < before) {
      console.log(
        dim(`  Filtered skills: ${before} → ${skillEntries.length} (--only-skills: ${opts.onlySkills})`)
      );
    }
  }

  // Fetch all skill and command content
  const allContent: string[] = [];
  const skills: Array<{ name: string; content: string }> = [];
  for (const entry of skillEntries) {
    const rawUrl = flatLayout
      ? `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${pluginPath}/SKILL.md`
      : `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${pluginPath}/skills/${entry.name}/SKILL.md`;
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
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${pluginPath}/commands/${entry.name}`;
    try {
      const res = await fetch(rawUrl);
      if (res.ok) {
        const content = await res.text();
        commands.push({ name: entry.name, content });
        allContent.push(content);
      }
    } catch { /* skip unavailable */ }
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

  // Compute project root for consistent lockfile + skill locations
  const projectRoot = safeProjectRoot(opts);

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

  // Update lockfile (global → ~/.agents/, project → project root)
  const lockDir = lockfileRoot(opts);
  const lock = ensureLockfile(lockDir);
  lock.skills[pluginName] = {
    version: pluginVersion,
    sha,
    tier: "VERIFIED",
    installedAt: new Date().toISOString(),
    source: `github:${owner}/${repo}#plugin:${pluginName}`,
    scope: opts.global ? "user" : "project",
  };
  lock.agents = [...new Set([...(lock.agents || []), ...selectedAgents.map((a: { id: string }) => a.id)])];
  writeLockfile(lock, lockDir);

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

  // Report skill installs in a single batch (awaited to prevent process exit race)
  const batch = skills.map((s) => ({ skillName: s.name, repoUrl: ownerRepo }));
  if (batch.length > 0) await reportInstallBatch(batch).catch(() => {});
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

  // Source + --plugin: treat source as repo, route to plugin install
  if (opts.plugin && source && !source.includes("://")) {
    const srcParts = source.split("/");
    if (srcParts.length === 2) {
      try {
        return await installRepoPlugin(source, opts.plugin, opts);
      } catch (err) {
        console.error(red((err as Error).message));
        process.exit(1);
      }
    }
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

  // 3-part format: owner/repo/skill-name → check marketplace first, then legacy
  if (parts.length === 3) {
    const [threeOwner, threeRepo, threeSkill] = parts;
    const detection = await detectMarketplaceRepo(threeOwner, threeRepo);
    if (detection.isMarketplace && detection.manifestContent && hasPlugin(threeSkill, detection.manifestContent)) {
      return installMarketplaceRepo(threeOwner, threeRepo, detection.manifestContent, opts, [threeSkill]);
    }
    return installSingleSkillLegacy(threeOwner, threeRepo, threeSkill, opts);
  }

  if (parts.length !== 2) {
    // No slash → try registry lookup by skill name
    console.log(
      yellow("Tip: Prefer owner/repo format for direct GitHub installs.")
    );
    return installFromRegistry(source, opts);
  }

  const [owner, repo] = parts;

  // --skill flag: check marketplace first, then legacy single-skill mode
  if (opts.skill) {
    const detection = await detectMarketplaceRepo(owner, repo);
    if (detection.isMarketplace && detection.manifestContent && hasPlugin(opts.skill, detection.manifestContent)) {
      return installMarketplaceRepo(owner, repo, detection.manifestContent, opts, [opts.skill]);
    }
    return installSingleSkillLegacy(owner, repo, opts.skill, opts);
  }

  // Marketplace detection: check for .claude-plugin/marketplace.json
  // before running skill discovery (avoids unnecessary API calls)
  if (!opts.plugin) {
    const detection = await detectMarketplaceRepo(owner, repo);
    if (detection.isMarketplace && detection.manifestContent) {
      return installMarketplaceRepo(owner, repo, detection.manifestContent, opts);
    }
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
  const projectRoot = safeProjectRoot(opts);

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
        dim(`Use the exact name: vskill install ${owner}/${repo}/<skill-name>`)
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
      const result = await installOneGitHubSkill(owner, repo, skill.name, skill.rawUrl, opts, selectedAgents, projectRoot, skill.agentRawUrls);
      results.push(result);
    } catch (err) {
      console.error(red(`  Unexpected error installing "${skill.name}": ${(err as Error).message}`));
      results.push({ skillName: skill.name, installed: false, verdict: "ERROR" });
    }
  }

  // Update lockfile (global → ~/.agents/, project → project root)
  const lockDir = lockfileRoot(opts);
  const lock = ensureLockfile(lockDir);
  for (const r of results) {
    if (r.installed && r.sha) {
      lock.skills[r.skillName] = {
        version: "0.0.0",
        sha: r.sha,
        tier: "VERIFIED",
        installedAt: new Date().toISOString(),
        source: `github:${owner}/${repo}`,
        scope: opts.global ? "user" : "project",
      };
    }
  }
  lock.agents = [...new Set([...(lock.agents || []), ...selectedAgents.map((a: { id: string }) => a.id)])];
  writeLockfile(lock, lockDir);

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
  }
  // Batch report all installed skills (awaited to prevent process exit race)
  const discoveredBatch = results
    .filter((r) => r.installed)
    .map((r) => ({ skillName: r.skillName, repoUrl: `${owner}/${repo}` }));
  if (discoveredBatch.length > 0) await reportInstallBatch(discoveredBatch).catch(() => {});
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
    case "T2": return "Basic";
    case "T3": return "Verified";
    case "T4": return "Certified";
    default: return "Unknown";
  }
}

// ---------------------------------------------------------------------------
// Search result display helpers (used by install recommendation fallback)
// ---------------------------------------------------------------------------

function formatSearchResultId(r: SkillSearchResult): string {
  const displayName = r.skillSlug || r.name.split("/").pop() || r.name;
  const publisher = r.ownerSlug && r.repoSlug
    ? `${r.ownerSlug}/${r.repoSlug}`
    : extractSearchBaseRepo(r.repoUrl);
  return publisher ? `${publisher}/${displayName}` : displayName;
}

function formatSearchUrl(r: SkillSearchResult): string {
  if (r.ownerSlug && r.repoSlug && r.skillSlug) {
    return `https://verified-skill.com/skills/${encodeURIComponent(r.ownerSlug)}/${encodeURIComponent(r.repoSlug)}/${encodeURIComponent(r.skillSlug)}`;
  }
  const parts = r.name.split("/");
  if (parts.length === 3) {
    return `https://verified-skill.com/skills/${parts.map(encodeURIComponent).join("/")}`;
  }
  const base = extractSearchBaseRepo(r.repoUrl);
  if (base) {
    const sn = r.name.split("/").pop() || r.name;
    return `https://verified-skill.com/skills/${base.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(sn)}`;
  }
  return `https://verified-skill.com/skills/${encodeURIComponent(r.name)}`;
}

function formatSearchBadge(certTier: string | undefined, trustTier: string | undefined): string {
  if (certTier === "CERTIFIED") return green("\u2713 certified");
  if (certTier === "VERIFIED") return cyan("\u2713 verified");
  switch (trustTier) {
    case "T4": return green("\u2713 certified");
    case "T3": return cyan("\u2713 verified");
    case "T2": return yellow("~ pending");
    case "T1": return dim("~ unreviewed");
    default: return dim("~ unreviewed");
  }
}

function extractSearchBaseRepo(repoUrl: string | undefined): string | null {
  if (!repoUrl) return null;
  const match = repoUrl.match(/([^/]+\/[^/]+?)(?:\/tree\/|\.git|$)/);
  return match ? match[1] : null;
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
    // Skill not in registry — check blocklist before showing generic "not found"
    const safety = await checkInstallSafety(skillName);
    if (safety.blocked) {
      printBlockedError(safety.entry!);
      process.exit(1);
    }

    // Search for matching skills and show recommendations
    try {
      const response = await searchSkills(skillName, { limit: 5 });
      const results = response.results
        .filter((r) => !r.isBlocked)
        .sort((a, b) => {
          const certRank = (t: string | undefined) => t === "CERTIFIED" ? 0 : t === "VERIFIED" ? 1 : 2;
          const certDiff = certRank(a.certTier) - certRank(b.certTier);
          if (certDiff !== 0) return certDiff;
          return (b.githubStars ?? 0) - (a.githubStars ?? 0);
        });

      if (results.length > 0) {
        console.error(
          red(`Skill "${skillName}" not found as an exact registry name.\n`)
        );
        console.log(bold("Did you mean:\n"));
        for (const r of results) {
          const skillId = formatSearchResultId(r);
          const stars = r.githubStars ?? 0;
          const starsStr = `\u2605${formatInstalls(stars)}`;
          const badge = formatSearchBadge(r.certTier, r.trustTier);
          console.log(`  ${bold(skillId)}  ${dim(starsStr)}${badge ? "  " + badge : ""}`);
          const url = formatSearchUrl(r);
          console.log(`  ${link(url, cyan(url))}`);
          console.log();
        }
        const top = results[0];
        const topId = formatSearchResultId(top);
        console.log(dim("Install with exact name:"));
        console.log(cyan(`  npx vskill install ${topId}\n`));
        process.exit(1);
        return;
      }
    } catch {
      // Search also failed — fall through to generic error
    }

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

    // If registry knows the plugin name, use plugin install path
    if (detail.pluginName && ownerRepo) {
      console.log(dim(`Registry has no inline content — installing plugin ${detail.pluginName} from GitHub (${ownerRepo})...`));
      try {
        return await installRepoPlugin(ownerRepo, detail.pluginName, opts);
      } catch (err) {
        console.error(red((err as Error).message));
        process.exit(1);
      }
    }

    console.log(dim(`Registry has no inline content — installing from GitHub (${ownerRepo})...`));
    const tipCmd = detail.pluginName
      ? `vskill install ${ownerRepo} --plugin ${detail.pluginName}`
      : `vskill install ${ownerRepo}`;
    console.log(yellow(`Tip: Next time use: ${tipCmd}`));
    return addCommand(ownerRepo, { ...opts, _targetSkill: detail.name });
  }

  const content = detail.content;

  // Blocklist + rejection check
  const safety = await checkInstallSafety(skillName);
  if (safety.blocked && !opts.force) {
    printBlockedError(safety.entry!);
    process.exit(1);
  }
  if (safety.blocked && opts.force) {
    printBlockedWarning(safety.entry!);
  }
  if (safety.rejected) {
    printRejectedWarning(safety.rejection!);
  }
  if (safety.tainted) {
    printTaintedWarning(skillName, safety.taintReason);
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
  const projectRoot = safeProjectRoot(opts);

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

  // Update lockfile (global → ~/.agents/, project → project root)
  const lockDir = lockfileRoot(opts);
  const lock = ensureLockfile(lockDir);
  lock.skills[skillName] = {
    version: detail.version || "0.0.0",
    sha,
    tier: "VERIFIED",
    installedAt: new Date().toISOString(),
    source: `registry:${skillName}`,
    scope: opts.global ? "user" : "project",
  };
  lock.agents = [...new Set([...(lock.agents || []), ...selectedAgents.map((a: { id: string }) => a.id)])];
  writeLockfile(lock, lockDir);

  console.log(green(`\nInstalled ${bold(skillName)} to ${locations.length} agent${locations.length === 1 ? "" : "s"}:\n`));
  for (const loc of locations) {
    console.log(`  ${dim(">")} ${loc}`);
  }
  console.log(dim(`\nSHA: ${sha} | Version: ${detail.version || "0.0.0"}`));
  await reportInstall(detail.name || skillName, detail.repoUrl).catch(() => {});
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
  // Blocklist + rejection check BEFORE fetching (prevents misleading 404)
  const skillName = skill || repo;
  const safety = await checkInstallSafety(skillName);
  if (safety.blocked && !opts.force) {
    printBlockedError(safety.entry!);
    process.exit(1);
  }
  if (safety.blocked && opts.force) {
    printBlockedWarning(safety.entry!);
  }
  if (safety.rejected) {
    printRejectedWarning(safety.rejection!);
  }
  if (safety.tainted) {
    printTaintedWarning(skillName, safety.taintReason);
  }

  const branch = await getDefaultBranch(owner, repo);
  const skillSubpath = skill ? `skills/${skill}/SKILL.md` : "SKILL.md";
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${skillSubpath}`;

  // Fetch SKILL.md
  const content = await fetchSkillContent(url);

  // Fetch agents/*.md if skill is in a subdirectory (skills/{name}/)
  let legacyAgentFiles: Record<string, string> | undefined;
  if (skill) {
    try {
      const agentsDirUrl = `https://api.github.com/repos/${owner}/${repo}/contents/skills/${skill}/agents`;
      const dirRes = await fetch(agentsDirUrl, { headers: { Accept: "application/vnd.github.v3+json" } });
      if (dirRes.ok) {
        const entries = (await dirRes.json()) as Array<{ name: string; download_url?: string }>;
        const mdEntries = entries.filter((e) => e.name.endsWith(".md") && e.download_url);
        if (mdEntries.length > 0) {
          legacyAgentFiles = {};
          const fetches = mdEntries.map(async (entry) => {
            try {
              const res = await fetch(entry.download_url!);
              if (res.ok) legacyAgentFiles![`agents/${entry.name}`] = await res.text();
            } catch { /* skip */ }
          });
          await Promise.allSettled(fetches);
          if (Object.keys(legacyAgentFiles).length === 0) legacyAgentFiles = undefined;
        }
      }
    } catch { /* agents/ dir doesn't exist or API error — fine */ }
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
  const projectRoot = safeProjectRoot(opts);
  const installOpts = { global: !!opts.global, projectRoot };

  const locations = opts.copy
    ? installCopy(skillName, content, selectedAgents, installOpts, legacyAgentFiles)
    : installSymlink(skillName, content, selectedAgents, installOpts, legacyAgentFiles);

  // Update lockfile (global → ~/.agents/, project → project root)
  const lockDir = lockfileRoot(opts);
  const lock = ensureLockfile(lockDir);
  lock.skills[skillName] = {
    version: "0.0.0",
    sha,
    tier: "VERIFIED",
    installedAt: new Date().toISOString(),
    source: `github:${owner}/${repo}`,
    scope: opts.global ? "user" : "project",
  };
  lock.agents = [...new Set([...(lock.agents || []), ...selectedAgents.map((a: { id: string }) => a.id)])];
  writeLockfile(lock, lockDir);

  // Phone home (awaited to prevent process exit race)
  await reportInstall(skillName, `${owner}/${repo}`).catch(() => {});

  // Print summary
  const method = opts.copy ? "copied" : "symlinked";
  console.log(green(`\nInstalled ${bold(skillName)} (${method}) to ${locations.length} agent${locations.length === 1 ? "" : "s"}:\n`));
  for (const loc of locations) {
    console.log(`  ${dim(">")} ${loc}`);
  }
  console.log(dim(`\nSHA: ${sha}`));
}
