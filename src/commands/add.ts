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
import { execSync } from "node:child_process";
import os from "node:os";
import { resolveTilde } from "../utils/paths.js";
import { reportInstall, reportInstallBatch, submitSkill } from "../api/client.js";
import { filterAgents } from "../utils/agent-filter.js";
import { detectInstalledAgents, AGENTS_REGISTRY } from "../agents/agents-registry.js";
import type { AgentDefinition } from "../agents/agents-registry.js";
import { ensureLockfile, writeLockfile, readLockfile, removeSkillFromLock } from "../lockfile/index.js";
import { buildGitHubInstallLockEntry } from "./add-lockfile.js";
import { runTier1Scan } from "../scanner/index.js";
import { getAvailablePlugins, getPluginSource, getPluginVersion, hasPlugin, discoverUnregisteredPlugins } from "../marketplace/index.js";
import type { UnregisteredPlugin } from "../marketplace/index.js";
import { checkInstallSafety } from "../blocklist/blocklist.js";
import type { BlocklistEntry, RejectionInfo } from "../blocklist/types.js";
import { getSkill, searchSkills } from "../api/client.js";
import type { SkillSearchResult } from "../api/client.js";
import { checkPlatformSecurity } from "../security/index.js";
import { discoverSkills, getDefaultBranch, checkRepoExists, warnRateLimitOnce } from "../discovery/github-tree.js";
import { githubFetch, GitHubFetchError } from "../lib/github-fetch.js";
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
import { ensureFrontmatter } from "../installer/frontmatter.js";
import { ensureSkillMdNaming, cleanStaleNesting } from "../installer/migrate.js";
import { getMarketplaceName } from "../marketplace/index.js";
import { rankSearchResults, formatSkillId, getSkillUrl, getTrustBadge, formatResultLine } from "../utils/skill-display.js";
import { computeSha } from "../updater/source-fetcher.js";
import { extractFrontmatterVersion } from "../utils/version.js";
// 0724 T-006: enable-after-install path. We delegate every enabledPlugins
// mutation to the claude CLI (ADR 0724-01), and we honour the --no-enable
// flag to skip it. Uninstall is imported for F-003 rollback of earlier
// already-enabled plugins on a partway failure.
import {
  claudePluginInstall,
  claudePluginUninstall,
  claudePluginMarketplaceAdd,
  claudePluginMarketplaceList,
} from "../utils/claude-plugin.js";
import {
  buildPerAgentReport,
  resolvePluginId,
} from "../lib/skill-lifecycle.js";

// ---------------------------------------------------------------------------
/** Validate that a download_url from GitHub Contents API points to a trusted GitHub domain. */
function isGitHubDownloadUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && (hostname === "raw.githubusercontent.com" || hostname === "api.github.com");
  } catch {
    return false;
  }
}

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
  // Prefer download_url for raw content — validate URL before fetching (SSRF prevention)
  if (data.download_url && isGitHubDownloadUrl(data.download_url)) {
    const rawRes = await githubFetch(data.download_url);
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
    const res = await githubFetch(contentsUrl, { headers });
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
    const res = await githubFetch(contentsUrl, { headers });
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
    const res = await githubFetch(rawUrl);
    if (res.ok) {
      const content = await res.text();
      if (getAvailablePlugins(content).length > 0) {
        return { isMarketplace: true, manifestContent: content };
      }
    }
  } catch (err) {
    // All attempts exhausted — log so network failures are diagnosable
    console.warn(`[vskill] Marketplace detection failed for ${owner}/${repo}: ${err instanceof Error ? err.message : String(err)}`);
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
        // Not in marketplace or unregistered list — probe plugins/<name>/ folder directly
        let probeSource: string | null = null;
        try {
          const probeRes = await githubFetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/plugins/${preSelected[0]}`,
            { headers: { "User-Agent": "vskill-cli" } },
          );
          if (probeRes.ok) {
            const data = await probeRes.json();
            if (Array.isArray(data)) {
              probeSource = `./plugins/${preSelected[0]}`;
            }
          }
        } catch { /* fall through */ }
        if (!probeSource) {
          console.error(red(`"${preSelected[0]}" not found in marketplace, unregistered plugins, or as a folder in the repo.`));
          process.exit(1);
          return;
        }
        selectedPlugins = [];
        selectedUnregistered = [{ name: preSelected[0], source: probeSource }];
        console.log(yellow(`"${preSelected[0]}" not in marketplace.json — found as folder at plugins/${preSelected[0]}/`));
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
            } catch (err) {
              console.warn(`[vskill] Could not remove ${dir}: ${err instanceof Error ? err.message : String(err)}`);
            }
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
        const skillsRes = await githubFetch(skillsUrl, { headers: { "User-Agent": "vskill-cli" } });
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
          } catch (err) {
            unverifiedCount++;
            const submitUrl = `https://verified-skill.com/submit`;
            console.log(yellow(`  Could not submit ${skill.name} automatically.`));
            console.warn(`[vskill] Submission failed for ${skill.name}: ${err instanceof Error ? err.message : String(err)}`);
            console.log(dim("  Submit manually: ") + link(submitUrl, submitUrl));
          }
        }
      } catch (err) {
        console.warn(`[vskill] Discovery error for ${unreg.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
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
    // 0826: a marketplace plugin whose `source` is `"./"` lives at the repo
    // root — the previous guard (`if (!pluginPath) … failed`) short-circuited
    // those installs. Keep the path normalization but allow an empty value to
    // mean "repo root" instead of treating it as a hard failure. Build URL
    // segments with a leading-slash prefix only when there's a real path so
    // we don't emit `//` between the contents-API base and `skills`.
    const pluginPath = plugin.source.replace(/^\.\//, "").replace(/\/$/, "");
    const pathSegment = pluginPath ? `/${pluginPath}` : "";
    const installSpin = spinner(`Installing skills: ${bold(plugin.name)}`);

    try {
      // Discover skills: try {pluginPath}/skills/ first, then fall back to {pluginPath}/SKILL.md
      const installedSkillNames: string[] = [];
      const skillsUrl = `https://api.github.com/repos/${owner}/${repo}/contents${pathSegment}/skills`;
      const skillsRes = await githubFetch(skillsUrl, { headers: { "User-Agent": "vskill-cli" } });

      if (skillsRes.ok) {
        // Nested layout: {pluginPath}/skills/{skillName}/SKILL.md
        const skillDirs = ((await skillsRes.json()) as Array<{ name: string; type: string }>)
          .filter((e) => e.type === "dir");
        for (const sd of skillDirs) {
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}${pathSegment}/skills/${sd.name}/SKILL.md`;
          const contentRes = await githubFetch(rawUrl);
          if (!contentRes.ok) continue;
          const content = await contentRes.text();
          const namespacedName = sd.name === plugin.name ? plugin.name : `${plugin.name}/${sd.name}`;
          // forceName only when actually namespacing — otherwise installs must
          // not mutate already-valid frontmatter (no-touch principle).
          const isRenaming = sd.name !== plugin.name;
          const processedContent = ensureFrontmatter(content, namespacedName, isRenaming);
          for (const agent of agents) {
            const baseDir = resolveInstallBase(opts, agent);
            const skillDir = join(baseDir, sd.name);
            mkdirSync(skillDir, { recursive: true });
            writeFileSync(join(skillDir, "SKILL.md"), processedContent, "utf-8");
            cleanStaleNesting(skillDir);
          }
          installedSkillNames.push(sd.name);
        }
      } else {
        // Flat layout: {pluginPath}/SKILL.md directly in the plugin root
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}${pathSegment}/SKILL.md`;
        const contentRes = await githubFetch(rawUrl);
        if (contentRes.ok) {
          const content = await contentRes.text();
          const processedContent = ensureFrontmatter(content, plugin.name);
          for (const agent of agents) {
            const baseDir = resolveInstallBase(opts, agent);
            const skillDir = join(baseDir, plugin.name);
            mkdirSync(skillDir, { recursive: true });
            writeFileSync(join(skillDir, "SKILL.md"), processedContent, "utf-8");
            cleanStaleNesting(skillDir);
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
        // 0737 — Source-repo provenance for the Studio detail header's
        // clickable GitHub anchor. `repoUrl` is the canonical GitHub root;
        // `sourceSkillPath` is intentionally NOT set here for plugin-level
        // entries since a single plugin may hold multiple skills under
        // skills/<name>/SKILL.md. resolveSourceLink() falls back to
        // "SKILL.md" (correct for flat-layout plugins) and the per-skill
        // case is covered by the explicit-field path documented in 0737.
        sourceRepoUrl: `https://github.com/${owner}/${repo}`,
      };
    }
  }
  writeLockfile(lockForWrite, lockDir);

  // 0724 T-006 (AC-US1-01..05): claude-plugin enable hook + rollback on failure.
  // Per-agent report is emitted for each successfully-installed plugin so users
  // see exactly which agent surfaces received the registration.
  //
  // Backward-compat (NFR-005): the hook only fires when the user opts into
  // the new surface — i.e., they pass --scope, --no-enable, or --dry-run.
  // Without an opt-in, vskill install behaves exactly as before so existing
  // tests, scripts, and CI pipelines see no behaviour change. AC-US1-01 is
  // read as "when the install flow performs the enable, it does so via
  // claudePluginInstall(<id>, <scope>) exactly once per scope chosen" —
  // i.e., it constrains *how* we enable, not *whether* we always enable.
  // A future major bump will flip this gate to always-on once distribution
  // can also surface --no-enable as the off-switch.
  //
  // When the gate fires, we track every successful enable in
  // `enabledSoFar` so that a later failure rolls back all earlier
  // already-enabled plugins (otherwise we'd leave exactly the stale
  // `enabledPlugins` entries that `vskill cleanup` is meant to fix).
  // 0826: include `opts.global` here. Previously a Studio "Global" install
  // (or CLI `vskill install … --global`) wrote the SKILL.md stub to disk
  // but never invoked `claude plugin install` — leaving the plugin
  // unenabled. The user saw the skill on disk but Claude Code didn't load
  // it. Treat --global as opt-in to the enable hook (scope = user, since
  // --global is per-machine, not per-repo).
  const userOptedIn =
    opts.scope !== undefined ||
    opts.global === true ||
    opts.dryRun === true ||
    opts.enable === false;
  if (userOptedIn) {
    const enabledSoFar: Array<{ name: string; pluginId: string; scope: "user" | "project" }> = [];
    for (const r of results) {
      if (!r.installed) continue;
      const entry = lockForWrite.skills[r.name];
      if (!entry) continue;
      try {
        const enableResult = enableAfterInstall(r.name, entry, opts);
        if (enableResult.invoked && enableResult.pluginId) {
          enabledSoFar.push({
            name: r.name,
            pluginId: enableResult.pluginId,
            scope: enableResult.scope,
          });
        }
        const action = enableResult.invoked ? "enabled" : "not-applicable";
        const report = buildPerAgentReport({
          skill: r.name,
          scope: enableResult.scope,
          action,
          agents,
        });
        for (const line of report) console.log(`  ${dim(">")} ${line.line}`);
      } catch (err) {
        // AC-US1-05: rollback on failure (filesystem + lockfile + earlier
        // already-enabled plugins to avoid leaving stale enabledPlugins).
        const failedScope: "user" | "project" =
          opts.scope ?? (opts.global ? "user" : "project");
        console.error(
          red(
            `Failed to enable ${r.name} in ${failedScope} scope: ${(err as Error).message}`,
          ),
        );
        rollbackInstall(r.name, agents, opts);
        // F-003: undo earlier successful enables to keep settings.json
        // clean. Static import — see top of file.
        //
        // Invariant: every plugin in `enabledSoFar` was installed in this
        // single addCommand invocation, so they all share the same `opts`
        // (and therefore the same effective install base resolved by
        // resolveInstallBase). The captured `prev.scope` is what the enable
        // hook actually used, which equals what add.ts computes today from
        // the shared opts. If a future change introduces per-plugin scope
        // override during a batch install, this loop must capture and
        // replay each prev's installBase too — otherwise on-disk rollback
        // would target the wrong path.
        for (const prev of enabledSoFar) {
          try {
            claudePluginUninstall(
              prev.pluginId,
              prev.scope,
              prev.scope === "project" ? { cwd: process.cwd() } : undefined,
            );
          } catch {
            /* best-effort */
          }
          rollbackInstall(prev.name, agents, opts);
        }
        process.exit(1);
        return;
      }
    }
  }

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

import {
  copyPluginFiltered,
  isSkillMdCandidate,
  shouldSkipFromCommands,
} from "../shared/copy-plugin-filtered.js";
export { copyPluginFiltered, isSkillMdCandidate, shouldSkipFromCommands };

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
  // 0724 T-006: enable / scope / dry-run.
  // Commander generates `enable: false` from `--no-enable`. Default true.
  /** When false (--no-enable), skip the post-install `claude plugin install` step. */
  enable?: boolean;
  /** Explicit settings.json scope for the enable step. Falls back to `global ? "user" : "project"`. */
  scope?: "user" | "project";
  /** Print what enable / lockfile mutations would happen, no side effects. */
  dryRun?: boolean;
  /**
   * 0839 T-010 / ADR-002 — explicit tenant slug for private-skill resolution.
   * Highest priority in the resolution chain (flag > env > config > auto).
   * When set, the value is propagated to the API client via the
   * `X-Vskill-Tenant` header on every outbound request in this run.
   */
  tenant?: string;
}

/**
 * 0724 T-006: post-install claude-plugin enable hook.
 *
 * @internal exported for unit tests in __tests__/add-no-enable.test.ts —
 * driving the helper directly is much cheaper than threading the entire
 * addCommand() through fake GitHub fetches and tarball extraction.
 *
 * Called once per just-installed marketplace plugin entry, after the
 * lockfile has been written. Honours `opts.enable === false` (--no-enable)
 * and `opts.dryRun`. Resolves the plugin id via shared helper. Throws on
 * failure so the caller can roll back the filesystem extraction
 * (AC-US1-05).
 */
export function enableAfterInstall(
  skillName: string,
  entry: { marketplace?: string },
  opts: AddOptions,
): { invoked: boolean; pluginId: string | null; scope: "user" | "project" } {
  const scope: "user" | "project" =
    opts.scope ?? (opts.global ? "user" : "project");
  const pluginId = resolvePluginId(skillName, entry);
  if (pluginId === null) {
    if (!opts.dryRun) {
      console.log(
        dim(
          `Auto-discovered by agents from skills dir — no enable step needed.`,
        ),
      );
    }
    return { invoked: false, pluginId: null, scope };
  }
  if (opts.enable === false) {
    if (!opts.dryRun) {
      console.log(
        dim(`--no-enable: skipped claude plugin install for ${pluginId}.`),
      );
    }
    return { invoked: false, pluginId, scope };
  }
  if (opts.dryRun) {
    console.log(
      dim(
        `Dry-run: would invoke ${cyan(`claude plugin install --scope ${scope} -- ${pluginId}`)}`,
      ),
    );
    return { invoked: false, pluginId, scope };
  }
  // 0826: when the source repo is a Claude Code plugin marketplace that
  // hasn't been registered yet, `claude plugin install foo@bar` fails with
  // "Plugin foo not found in marketplace bar" — and the rollback then
  // wipes the on-disk extraction we just succeeded at. Detect that case
  // up-front from the lockfile entry's marketplace metadata and register
  // the marketplace via `claude plugin marketplace add` before delegating
  // the install. Best-effort — if the add fails (network, invalid source)
  // we still attempt the install so the original error is surfaced.
  ensureMarketplaceRegistered(entry, pluginId, scope);
  claudePluginInstall(
    pluginId,
    scope,
    scope === "project" ? { cwd: process.cwd() } : undefined,
  );
  return { invoked: true, pluginId, scope };
}

/**
 * 0826: Ensure the marketplace referenced by `entry` is registered with the
 * claude CLI before we try to enable the plugin. The lockfile entry shape
 * stores the marketplace name (e.g. `postiz-agent`) plus the originating
 * `sourceRepoUrl` — we derive `<owner>/<repo>` from the URL and run
 * `claude plugin marketplace add` if the name is missing from the current
 * `claude plugin marketplace list`.
 *
 * Pure best-effort: any failure (network, parse) falls through silently and
 * lets the subsequent `claudePluginInstall` surface the real error.
 */
function ensureMarketplaceRegistered(
  entry: { marketplace?: string; sourceRepoUrl?: string },
  pluginId: string,
  scope: "user" | "project",
): void {
  const marketplaceName = entry.marketplace;
  if (!marketplaceName) return;
  // Already registered — nothing to do.
  let registered: string[] = [];
  try {
    registered = claudePluginMarketplaceList();
  } catch {
    return;
  }
  if (registered.includes(marketplaceName)) return;
  // Derive a `claude plugin marketplace add` source from the lockfile.
  // GitHub URL → `owner/repo`; falls back to `marketplace@<id>` form which
  // claude rejects with a clear message.
  const repoSource = entry.sourceRepoUrl?.match(
    /github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/,
  );
  const source = repoSource ? repoSource[1] : "";
  if (!source) {
    console.error(
      dim(
        `  marketplace "${marketplaceName}" not registered and no source repo URL available — skipping auto-add (claude plugin install will likely fail).`,
      ),
    );
    return;
  }
  console.log(
    dim(`  Registering marketplace "${marketplaceName}" (${source}) — required for ${pluginId}`),
  );
  try {
    claudePluginMarketplaceAdd(source, scope);
  } catch (err) {
    // Surface the underlying error but keep going — claudePluginInstall
    // will still throw a clearer "not found in marketplace" if needed.
    console.error(
      dim(
        `  Failed to auto-register marketplace "${marketplaceName}": ${(err as Error).message.split("\n")[0]}`,
      ),
    );
  }
}

/**
 * 0724 T-006: rollback the on-disk extraction + lockfile entry when
 * `claudePluginInstall` throws (AC-US1-05). Best-effort — wraps each rm in
 * try/catch so a partial filesystem state doesn't suppress the underlying
 * diagnostic.
 *
 * @internal exported for unit tests; see `enableAfterInstall` note above.
 */
export function rollbackInstall(
  skillName: string,
  agents: AgentDefinition[],
  opts: AddOptions,
): void {
  for (const agent of agents) {
    const baseDir = resolveInstallBase(opts, agent);
    const skillDir = join(baseDir, skillName);
    try {
      if (existsSync(skillDir)) {
        rmSync(skillDir, { recursive: true, force: true });
      }
    } catch {
      // best-effort
    }
  }
  try {
    removeSkillFromLock(skillName);
  } catch {
    // best-effort
  }
}

/** Returns process.cwd() as the project root for skill installation. */
function safeProjectRoot(): string {
  return process.cwd();
}

/**
 * Resolve the directory for the lockfile based on scope.
 *
 * Global scope  → ~/.agents/ (canonical global directory)
 * Project scope → safeProjectRoot() (same as before)
 */
function lockfileRoot(opts: AddOptions): string {
  if (opts.global) {
    return join(os.homedir(), ".agents");
  }
  return safeProjectRoot();
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
 * 2. default   -> process.cwd() + agent's localSkillsDir
 */
function resolveInstallBase(
  opts: AddOptions,
  agent: { globalSkillsDir: string; localSkillsDir: string },
): string {
  if (opts.global) {
    return resolveTilde(agent.globalSkillsDir);
  }
  return resolveSkillsPath(safeProjectRoot(), agent.localSkillsDir);
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
 * Prompt the user for agent selection and install method.
 *
 * Interactive by default when TTY is available. Skipped when:
 * - `--yes` flag is passed
 * - Not a TTY (CI/piped)
 * - `--agent` flag narrows to specific agents (skip agent prompt only)
 * Scope is determined by `--global` flag (default: project = cwd).
 */
async function promptInstallOptions(
  agents: AgentDefinition[],
  opts: AddOptions,
): Promise<InstallSelections> {
  const shouldPrompt = isTTY() && !opts.yes;
  let selectedAgents = agents;
  let useGlobal = !!opts.global;

  if (!shouldPrompt) {
    // 0742: non-TTY runs (piped, npx subprocess, Claude Code's bash tool, etc.)
    // historically fanned out to every detected agent, leaving stray symlinks
    // for tools the user never opted into. When the user did NOT pass --yes
    // (CI opt-in) and did NOT scope with --agent, narrow to claude-code only
    // (or the first detected agent if claude-code isn't present). --yes still
    // means "fan out to everything" so existing CI scripts keep working.
    if (!opts.yes && !opts.agent?.length && selectedAgents.length > 1) {
      const claudeCode = selectedAgents.find((a) => a.id === "claude-code");
      const target = claudeCode ?? selectedAgents[0];
      console.log(
        dim(
          `Non-interactive: installing to ${target.displayName} only ` +
            `(${selectedAgents.length} agents detected). ` +
            `Use --agent <id> to override or --yes to install to all detected agents.`,
        ),
      );
      selectedAgents = [target];
    }
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

  // Scope: skip prompt if --global or --cwd already set
  if (!opts.global && !opts.cwd) {
    const prompter2 = createPrompter();
    const scopeIdx = await prompter2.promptChoice("Installation scope:", [
      { label: "Project", hint: "install in current project root" },
      { label: "Global", hint: "install in user home directory" },
    ]);
    useGlobal = scopeIdx === 1;
  } else {
    useGlobal = !!opts.global;
  }

  // Installation method — only meaningful with 2+ agents. With one agent there
  // is no source-of-truth dedup to gain, and for `claude-code` the symlink path
  // falls through to a direct copy via COPY_FALLBACK_AGENTS regardless of the
  // user's choice. Skip the prompt and use the existing default.
  let useSymlink = !opts.copy;
  if (!opts.copy && selectedAgents.length > 1) {
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
      : resolveSkillsPath(safeProjectRoot(), agent.localSkillsDir);
    console.log(dim(`    ${agent.displayName}: ${base}/`));
  }
  console.log(dim("  ─────────────────────────────────────────────────"));

  return { agents: selectedAgents, global: useGlobal, symlink: useSymlink };
}

async function fetchSkillContent(url: string): Promise<string> {
  const spin = spinner("Fetching skill");
  try {
    const res = await githubFetch(url);
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
 * Resolve the plugin subdirectory from marketplace.json or plugins/ folder.
 * Returns the absolute path to the plugin's source directory.
 */
function resolvePluginDir(
  basePath: string,
  pluginName: string,
): string | null {
  const marketplacePath = join(basePath, ".claude-plugin", "marketplace.json");
  if (existsSync(marketplacePath)) {
    const content = readFileSync(marketplacePath, "utf-8");
    const source = getPluginSource(pluginName, content);
    if (source) return resolve(basePath, source);
  }

  // Fallback: check if plugins/<name> exists as a directory
  const pluginDir = resolve(basePath, "plugins", pluginName);
  if (existsSync(pluginDir) && statSync(pluginDir).isDirectory()) {
    return pluginDir;
  }

  return null;
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
  repoUrl?: string,
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
      red(`"${pluginName}" not found in marketplace.json or as a plugins/ folder.\n`) +
        dim(`Checked: ${mktPath} and plugins/${pluginName}/`) +
        available
    );
    process.exit(1);
  }

  // Blocklist + rejection check (before scanning)
  const safety = await checkInstallSafety(pluginName, undefined, repoUrl);
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

  // Install: recursively copy plugin directory to each agent
  const sha = computeSha(content);
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
      ensureSkillMdNaming(cacheDir);
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
    files: ["SKILL.md"],
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
  version?: string;
  /**
   * 0743 — repo-relative path to the SKILL.md (e.g.
   * "plugins/sw/skills/greet-anton/SKILL.md"). Threaded from
   * `DiscoveredSkill.path` so the lockfile-write loop can persist
   * `sourceSkillPath` for the studio detail-header anchor.
   */
  sourceSkillPath?: string;
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
  /**
   * 0743 — repo-relative SKILL.md path from `DiscoveredSkill.path`. Threaded
   * through to the lockfile so the studio detail-header anchor resolves to
   * the actual file (not /blob/HEAD/SKILL.md at the repo root).
   */
  sourceSkillPath?: string,
): Promise<SkillInstallResult> {
  // Blocklist + rejection check BEFORE fetching (prevents misleading 404)
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const safety = await checkInstallSafety(skillName, undefined, repoUrl);
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
    const res = await githubFetch(rawUrl);
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
        const res = await githubFetch(url);
        if (res.ok) agentFiles![relPath] = await res.text();
      } catch { /* skip failed agent file fetches */ }
    });
    await Promise.allSettled(fetches);
    if (Object.keys(agentFiles).length === 0) agentFiles = undefined;
  }

  // Install to each agent using canonical installer
  const sha = computeSha(content);
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

  const skillVersion = extractFrontmatterVersion(content) || "1.0.0";
  return { skillName, installed: true, verdict: scanResult.verdict, score: scanResult.score, sha, version: skillVersion, sourceSkillPath };
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
    const res = await githubFetch(manifestUrl);
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
    const res = await githubFetch(manifestUrl);
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
  let pluginSource = overrideSource || getPluginSource(pluginName, manifestContent);
  if (!pluginSource) {
    // Not in marketplace.json — probe plugins/<name>/ folder in the repo
    const probeSpin = spinner(`Looking for "${pluginName}" folder in repo`);
    try {
      const probeRes = await githubFetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/plugins/${pluginName}`,
        { headers: { "User-Agent": "vskill-cli" } },
      );
      if (probeRes.ok) {
        const data = await probeRes.json();
        if (Array.isArray(data)) {
          pluginSource = `./plugins/${pluginName}`;
          probeSpin.stop(yellow(`"${pluginName}" not in marketplace.json — found as folder at plugins/${pluginName}/`));
        }
      }
    } catch { /* network error — fall through */ }
    if (!pluginSource) {
      probeSpin.stop();
      const available = getAvailablePlugins(manifestContent).map((p) => p.name);
      throw new Error(
        `"${pluginName}" not found in marketplace.json or as a folder in the repo.\n` +
          `Available plugins: ${available.join(", ")}`
      );
    }
  }
  const pluginVersion = overrideSource ? "0.0.0" : (getPluginVersion(pluginName, manifestContent) || "0.0.0");
  const pluginPath = pluginSource.replace(/^\.\//, "");

  // Blocklist + rejection check BEFORE fetching content
  const repoUrl = `https://github.com/${ownerRepo}`;
  const safety = await checkInstallSafety(pluginName, undefined, repoUrl);
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
    const res = await githubFetch(
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
      const res = await githubFetch(
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
    const res = await githubFetch(
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
      const res = await githubFetch(rawUrl);
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
      const res = await githubFetch(rawUrl);
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
  const projectRoot = safeProjectRoot();

  // Install skills and commands with namespace prefix
  const sha = computeSha(combined);
  const skillFileNames = skills.map((s) =>
    s.name === pluginName ? "SKILL.md" : `${s.name}/SKILL.md`
  ).sort();
  const locations: string[] = [];

  for (const agent of selectedAgents) {
    const baseDir = resolveInstallBase(opts, agent);
    const plugDir = basename(baseDir) === pluginName ? baseDir : join(baseDir, pluginName);

    try {
      // Skills: {agent-dir}/{plugin-name}/{skill-name}/SKILL.md
      for (const skill of skills) {
        // Prevent double-nesting when plugin has a single skill with same name
        // (e.g., frontend-design plugin containing frontend-design skill)
        const skillDir = skill.name === pluginName
          ? plugDir
          : join(plugDir, skill.name);
        mkdirSync(skillDir, { recursive: true });
        const namespacedSkillName = skill.name === pluginName ? pluginName : `${pluginName}/${skill.name}`;
        const isRenamingSkill = skill.name !== pluginName;
        writeFileSync(join(skillDir, "SKILL.md"), ensureFrontmatter(skill.content, namespacedSkillName, isRenamingSkill), "utf-8");
        cleanStaleNesting(skillDir);
      }
      // Commands: {agent-dir}/{plugin-name}/{command-name}.md
      for (const cmd of commands) {
        mkdirSync(plugDir, { recursive: true });
        writeFileSync(join(plugDir, cmd.name), cmd.content, "utf-8");
      }
      ensureSkillMdNaming(plugDir);
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
    files: skillFileNames,
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
  // 0839 T-010 / ADR-002 / F-001 — apply explicit `--tenant` to the process
  // env so every downstream API call (apiRequest -> buildRequestHeaders)
  // sees it, then ALWAYS restore the prior value on exit. The flag wins
  // over VSKILL_TENANT and config.json by virtue of being applied last;
  // `invalidateAuthCache` is called so the read-once-per-process cache
  // refreshes against the new env value. Tenant resolution beyond the
  // flag (env > config > auto-pick) is handled at the API layer + by
  // error surfacing on the response side (401/402 below).
  //
  // The try/finally is critical: process.env mutation MUST NOT leak across
  // in-process re-invocations (test harness, future composite command,
  // install-all loop). The finally arm restores the prior value
  // (or `delete`s if no value existed) so the next caller sees a clean
  // env, exactly as documented in ADR-002 ("flag is per-call, env var is
  // for CI").
  const priorTenantEnv = process.env.VSKILL_TENANT;
  const priorTenantHadValue = "VSKILL_TENANT" in process.env;
  const tenantOverrideApplied = !!(opts.tenant && opts.tenant.length > 0);
  if (tenantOverrideApplied) {
    process.env.VSKILL_TENANT = opts.tenant;
    // The API client may have cached a previous (null) tenant on import.
    // Invalidate so the new override takes effect on the very next call.
    try {
      const mod = await import("../api/client.js");
      mod.invalidateAuthCache();
    } catch {
      /* non-fatal — fresh CLI run hasn't cached anything yet */
    }
  }

  try {
    return await addCommandInner(source, opts);
  } finally {
    // 0839 F-001 — always restore the prior process.env.VSKILL_TENANT so
    // `--tenant` does not leak. Run unconditionally so any path that
    // mutated env (whether explicitly via opts.tenant or via a nested
    // helper, present or future) is also cleaned up. Skip when nothing
    // changed to avoid cache thrash.
    if (tenantOverrideApplied) {
      if (priorTenantHadValue) {
        process.env.VSKILL_TENANT = priorTenantEnv as string;
      } else {
        delete process.env.VSKILL_TENANT;
      }
      // Invalidate the cache once more so any subsequent in-process call
      // re-reads the (now-restored) env state instead of the override.
      try {
        const mod = await import("../api/client.js");
        mod.invalidateAuthCache();
      } catch {
        /* non-fatal */
      }
    }
  }
}

async function addCommandInner(
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
    if (detection.isMarketplace && detection.manifestContent) {
      // Direct plugin name match (e.g. owner/repo/pluginName)
      if (hasPlugin(threeSkill, detection.manifestContent)) {
        return installMarketplaceRepo(threeOwner, threeRepo, detection.manifestContent, opts, [threeSkill]);
      }
      // Skill-inside-plugin: search all plugins for a skill with this name
      const branch = await getDefaultBranch(threeOwner, threeRepo);
      const mktPlugins = getAvailablePlugins(detection.manifestContent);
      for (const plugin of mktPlugins) {
        const pluginPath = plugin.source.replace(/^\.\//, "");
        const subpath = `${pluginPath}/skills/${threeSkill}/SKILL.md`;
        const probeUrl = `https://raw.githubusercontent.com/${threeOwner}/${threeRepo}/${branch}/${subpath}`;
        const probeRes = await githubFetch(probeUrl);
        if (probeRes.ok) {
          return installSingleSkillLegacy(threeOwner, threeRepo, threeSkill, opts, subpath, plugin.name);
        }
      }
    }

    // Try discovery to find actual skill path before falling back to hardcoded pattern
    const discovered = await discoverSkills(threeOwner, threeRepo);
    const discoveredMatch = discovered.find(s => s.name === threeSkill);
    if (discoveredMatch) {
      return installSingleSkillLegacy(threeOwner, threeRepo, threeSkill, opts, discoveredMatch.path);
    }

    // Fallback: discovery didn't find the skill — try hardcoded skills/{name}/SKILL.md
    return installSingleSkillLegacy(threeOwner, threeRepo, threeSkill, opts);
  }

  if (parts.length !== 2) {
    // No slash → search registry and disambiguate
    return resolveViaSearch(source, opts);
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
  const projectRoot = safeProjectRoot();

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
      const result = await installOneGitHubSkill(owner, repo, skill.name, skill.rawUrl, opts, selectedAgents, projectRoot, skill.agentRawUrls, skill.path);
      results.push(result);
    } catch (err) {
      console.error(red(`  Unexpected error installing "${skill.name}": ${(err as Error).message}`));
      results.push({ skillName: skill.name, installed: false, verdict: "ERROR" });
    }
  }

  // Update lockfile (global → ~/.agents/, project → project root).
  // 0743: delegated to buildGitHubInstallLockEntry so `sourceRepoUrl` and
  // `sourceSkillPath` are persisted alongside the legacy `source` string.
  const lockDir = lockfileRoot(opts);
  const lock = ensureLockfile(lockDir);
  for (const r of results) {
    if (r.installed && r.sha) {
      lock.skills[r.skillName] = buildGitHubInstallLockEntry({
        version: r.version || "1.0.0",
        sha: r.sha,
        owner,
        repo,
        sourceSkillPath: r.sourceSkillPath ?? null,
        global: !!opts.global,
      });
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

  // Post-install hint: check if other installed skills have updates (T-011/T-012/T-013)
  const { postInstallHint } = await import("./outdated.js");
  await postInstallHint(lock, lockDir, results.map((r) => r.skillName));
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
// Search-first disambiguation — resolve flat name via search API
// ---------------------------------------------------------------------------

async function resolveViaSearch(
  flatName: string,
  opts: AddOptions,
): Promise<void> {
  let results: import("../api/client.js").SkillSearchResult[];
  try {
    const response = await searchSkills(flatName);
    results = response.results;
  } catch (err) {
    // Search API failed — fall back to existing direct lookup behavior
    console.warn(`[vskill] Search API unavailable: ${err instanceof Error ? err.message : String(err)}`);
    console.log(
      yellow("Tip: Prefer owner/repo format for direct GitHub installs.")
    );
    return installFromRegistry(flatName, opts);
  }

  const ranked = rankSearchResults(results, flatName);
  const installable = ranked.filter(
    (r) => !r.isBlocked && r.ownerSlug && r.repoSlug && r.skillSlug,
  );

  // Zero installable results
  if (installable.length === 0) {
    // Display whatever results we have (blocked with labels)
    if (ranked.length > 0) {
      console.log(bold(`\nSearch results for "${flatName}":\n`));
      for (const r of ranked) {
        console.log(formatResultLine(r));
        console.log();
      }
    }
    console.error(
      red(`No installable skills found matching "${flatName}".\n`) +
        dim(`Try ${cyan(`vskill find ${flatName}`)} for a broader search, or `) +
        dim(`use ${cyan("owner/repo/skill")} for exact installs.`)
    );
    process.exit(1);
    return;
  }

  // Single installable result — auto-install
  if (installable.length === 1) {
    const r = installable[0];
    const fullPath = `${r.ownerSlug}/${r.repoSlug}/${r.skillSlug}`;
    console.log(dim(`Found: ${formatSkillId(r)}`));
    return addCommand(fullPath, opts);
  }

  // Multiple installable results — check --yes flag first
  if (opts.yes) {
    const r = installable[0];
    const fullPath = `${r.ownerSlug}/${r.repoSlug}/${r.skillSlug}`;
    console.log(dim(`Auto-selecting first result: ${formatSkillId(r)}`));
    return addCommand(fullPath, opts);
  }

  // Multiple results — display them
  console.log(bold(`\nMultiple skills match "${flatName}":\n`));
  for (const r of ranked) {
    console.log(formatResultLine(r));
    console.log();
  }

  // Non-TTY: print list and exit
  if (!isTTY()) {
    console.error(
      red("Ambiguous match. ") +
        dim(`Specify the exact skill: ${cyan(`vskill install owner/repo/skill`)}`)
    );
    process.exit(1);
    return;
  }

  // TTY: interactive prompt — only installable results are selectable
  const choices = installable.map((r) => ({
    label: formatSkillId(r),
    hint: getTrustBadge(r.certTier, r.trustTier).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "") || undefined,
  }));

  const prompter = createPrompter();
  const selected = await prompter.promptChoice("Select a skill to install:", choices);
  const chosen = installable[selected];
  const fullPath = `${chosen.ownerSlug}/${chosen.repoSlug}/${chosen.skillSlug}`;
  return addCommand(fullPath, opts);
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
  } catch (lookupErr) {
    spin.stop();

    // 0839 T-010 — surface auth + entitlement failures from the platform
    // (apiRequest annotates errors with .status and .parsedBody). These
    // are NOT "skill not found" misses; we must NOT swallow them into the
    // search-suggestion fallback.
    const e = lookupErr as Error & {
      status?: number;
      parsedBody?: { upgradeUrl?: string; message?: string };
    };

    if (e.status === 401) {
      // AC-US1-04 — anonymous or expired token. Do NOT clear the keychain
      // (only `auth logout` does that); the token may simply have expired
      // server-side, and the user should refresh, not lose their config.
      console.error(
        red(`Authentication required for "${skillName}".`) +
          "\n" +
          dim("Run `vskill auth login` to sign in."),
      );
      process.exit(1);
    }
    if (e.status === 402) {
      // AC-US1-05 / AC-US2-04 — entitlement gate; the platform returns 402
      // with `{ upgradeUrl, message }` so the CLI can deep-link the user
      // straight to the right purchase page.
      const upgradeUrl = e.parsedBody?.upgradeUrl;
      const message =
        e.parsedBody?.message ?? "This skill requires a paid plan.";
      console.error(red(`${message}`));
      if (upgradeUrl) {
        console.error(dim(`Upgrade: ${cyan(upgradeUrl)}`));
      }
      process.exit(1);
    }
    if (e.status === 403) {
      // Membership/scope failure — different from 401. Print verbatim so
      // the platform's message reaches the user (e.g. "skill found in 2
      // tenants — pass --tenant <slug>").
      const msg = e.parsedBody?.message ?? e.message;
      console.error(red(msg));
      process.exit(1);
    }

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
    } catch (err) {
      // Search also failed — fall through to generic error
      console.warn(`[vskill] Could not fetch suggestions for "${skillName}": ${err instanceof Error ? err.message : String(err)}`);
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
  const safety = await checkInstallSafety(skillName, undefined, detail.repoUrl);
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
  const projectRoot = safeProjectRoot();

  // Install to each agent
  const sha = computeSha(content);
  const locations: string[] = [];

  const processedContent = ensureFrontmatter(content, skillName);
  for (const agent of selectedAgents) {
    const baseDir = resolveInstallBase(opts, agent);
    const skillDir = join(baseDir, skillName);
    try {
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), processedContent, "utf-8");
      cleanStaleNesting(skillDir);
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
  const registryVersion = detail.version || extractFrontmatterVersion(content) || "1.0.0";
  lock.skills[skillName] = {
    version: registryVersion,
    sha,
    tier: "VERIFIED",
    installedAt: new Date().toISOString(),
    source: `registry:${skillName}`,
    scope: opts.global ? "user" : "project",
    files: ["SKILL.md"],
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
  skillSubpathOverride?: string,
  pluginNamespace?: string,
): Promise<void> {
  // Blocklist + rejection check BEFORE fetching (prevents misleading 404)
  const skillName = skill || repo;
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const safety = await checkInstallSafety(skillName, undefined, repoUrl);
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

  // Check if the repo exists before attempting to fetch SKILL.md
  const repoExists = await checkRepoExists(owner, repo);
  if (!repoExists) {
    console.error(
      red(`Repository ${owner}/${repo} does not exist on GitHub.`) + "\n" +
      dim(`Hint: To search by name, use: vskill install ${skill || repo}`)
    );
    return process.exit(1);
  }

  const branch = await getDefaultBranch(owner, repo);
  const skillSubpath = skillSubpathOverride || (skill ? `skills/${skill}/SKILL.md` : "SKILL.md");
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${skillSubpath}`;

  // Fetch SKILL.md
  const content = await fetchSkillContent(url);

  // Fetch agents/*.md if skill is in a subdirectory (skills/{name}/)
  let legacyAgentFiles: Record<string, string> | undefined;
  if (skill) {
    try {
      const agentsBasePath = skillSubpathOverride
        ? skillSubpathOverride.replace(/\/SKILL\.md$/, "/agents")
        : `skills/${skill}/agents`;
      const agentsDirUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${agentsBasePath}`;
      const dirRes = await githubFetch(agentsDirUrl, { headers: { Accept: "application/vnd.github.v3+json" } });
      if (dirRes.ok) {
        const entries = (await dirRes.json()) as Array<{ name: string; download_url?: string }>;
        const mdEntries = entries.filter((e) => e.name.endsWith(".md") && e.download_url && isGitHubDownloadUrl(e.download_url!));
        if (mdEntries.length > 0) {
          legacyAgentFiles = {};
          const fetches = mdEntries.map(async (entry) => {
            try {
              const res = await githubFetch(entry.download_url!);
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

  // Install to each agent using canonical installer (flat directory, namespaced frontmatter name)
  const namespacedName = pluginNamespace && skillName !== pluginNamespace
    ? `${pluginNamespace}/${skillName}`
    : skillName;
  // forceName only when the namespaced name actually differs from the source's
  // skill name — guarantees a no-touch install when no rename is needed.
  const isRenamingNamespace = !!pluginNamespace && namespacedName !== skillName;
  const namespacedContent = pluginNamespace
    ? ensureFrontmatter(content, namespacedName, isRenamingNamespace)
    : content;
  const sha = computeSha(content);
  const projectRoot = safeProjectRoot();
  const installOpts = { global: !!opts.global, projectRoot };

  const locations = opts.copy
    ? installCopy(skillName, namespacedContent, selectedAgents, installOpts, legacyAgentFiles)
    : installSymlink(skillName, namespacedContent, selectedAgents, installOpts, legacyAgentFiles);

  // Update lockfile (global → ~/.agents/, project → project root).
  // 0743: persist `sourceSkillPath` from the locally-derived `skillSubpath`
  // so the studio detail-header anchor opens the correct file on GitHub
  // (no more 404s on `/blob/HEAD/SKILL.md` for nested-layout repos).
  const lockDir = lockfileRoot(opts);
  const lock = ensureLockfile(lockDir);
  const ghVersion = extractFrontmatterVersion(content) || "1.0.0";
  lock.skills[skillName] = buildGitHubInstallLockEntry({
    version: ghVersion,
    sha,
    owner,
    repo,
    sourceSkillPath: skillSubpath,
    global: !!opts.global,
  });
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
