#!/usr/bin/env node
/**
 * 0771 Track F (T-006) — Sync vskill README shields.io badge URLs to current
 * filesystem counts so the README never drifts.
 *
 * Counted fields:
 *   agentPlatforms — agents.json agentPrefixes.length
 *   plugins        — direct subdirectories of plugins/
 *   skills         — plugins/<plugin>/skills/<skill>/SKILL.md
 *
 * Wired into prepublishOnly (see package.json). The followup
 * `git diff --exit-code README.md` guard fails npm publish if any badge
 * regenerated to a value that wasn't already committed.
 *
 * CLI: `node scripts/sync-readme-badges.cjs [vskill-root]`
 *      defaults to the parent directory of this script.
 *
 * 0771 Fix Pass — also rewrites the `alt="<N> agents/plugins/skills"` text on
 * the same `<img>` tags so accessibility metadata never drifts (grill #6).
 * The unused `scanPatterns` count was dropped (grill #7) — no shields.io
 * pattern in the README consumes it.
 */
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ROOT = path.resolve(__dirname, "..");

function countAgentPlatforms(root) {
  const file = path.join(root, "agents.json");
  if (!fs.existsSync(file)) return 0;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(data.agentPrefixes) ? data.agentPrefixes.length : 0;
  } catch {
    return 0;
  }
}

function countPlugins(root) {
  const dir = path.join(root, "plugins");
  if (!fs.existsSync(dir)) return 0;
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .length;
}

function countSkills(root) {
  const pluginsDir = path.join(root, "plugins");
  if (!fs.existsSync(pluginsDir)) return 0;
  let total = 0;
  for (const plugin of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!plugin.isDirectory()) continue;
    const skillsDir = path.join(pluginsDir, plugin.name, "skills");
    if (!fs.existsSync(skillsDir)) continue;
    for (const skill of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!skill.isDirectory()) continue;
      if (fs.existsSync(path.join(skillsDir, skill.name, "SKILL.md"))) {
        total += 1;
      }
    }
  }
  return total;
}

function computeCounts(root) {
  return {
    agentPlatforms: countAgentPlatforms(root),
    plugins: countPlugins(root),
    skills: countSkills(root),
  };
}

/**
 * Rewrite badge URLs in README.md. Returns true if content changed.
 *
 * Targets:
 *   shields.io/badge/agents-<N>_platforms-<color>
 *   shields.io/badge/plugins-<N>-<color>
 *   shields.io/badge/skills-<N>-<color>
 *
 * The N segment is replaced with the current count; the color suffix stays
 * intact so authors can change badge colors without the script reverting them.
 */
function rewriteReadme(readmePath, counts) {
  const original = fs.readFileSync(readmePath, "utf8");

  let updated = original;
  // agents — `agents-<N>_platforms-<color>`
  updated = updated.replace(
    /shields\.io\/badge\/agents-\d+_platforms-/g,
    `shields.io/badge/agents-${counts.agentPlatforms}_platforms-`,
  );
  // plugins — `plugins-<N>-<color>`
  updated = updated.replace(
    /shields\.io\/badge\/plugins-\d+-/g,
    `shields.io/badge/plugins-${counts.plugins}-`,
  );
  // skills — `skills-<N>-<color>`
  updated = updated.replace(
    /shields\.io\/badge\/skills-\d+-/g,
    `shields.io/badge/skills-${counts.skills}-`,
  );

  // 0771 Fix Pass (grill #6) — also rewrite the alt-text counters on the same
  // <img> tags so a11y metadata stays in sync with the badge URL.
  // Patterns: alt="N agents", alt="N plugins", alt="N skills" (case-insensitive).
  updated = updated.replace(
    /alt="\d+\s+agents"/gi,
    `alt="${counts.agentPlatforms} agents"`,
  );
  updated = updated.replace(
    /alt="\d+\s+plugins"/gi,
    `alt="${counts.plugins} plugins"`,
  );
  updated = updated.replace(
    /alt="\d+\s+skills"/gi,
    `alt="${counts.skills} skills"`,
  );

  if (updated === original) return false;
  fs.writeFileSync(readmePath, updated);
  return true;
}

function main() {
  const root = process.argv[2]
    ? path.resolve(process.argv[2])
    : DEFAULT_ROOT;
  const readme = path.join(root, "README.md");
  if (!fs.existsSync(readme)) {
    console.error(`[sync-readme-badges] FATAL: README.md not found at ${readme}`);
    process.exit(1);
  }

  const counts = computeCounts(root);
  const changed = rewriteReadme(readme, counts);
  console.log(
    `[sync-readme-badges] ${changed ? "updated" : "no change to"} ${readme} ` +
      `(agents=${counts.agentPlatforms} plugins=${counts.plugins} ` +
      `skills=${counts.skills})`,
  );
}

if (require.main === module) main();

module.exports = {
  computeCounts,
  rewriteReadme,
  countAgentPlatforms,
  countPlugins,
  countSkills,
};
