#!/usr/bin/env node

/**
 * vskill preuninstall lifecycle script
 * Warns about remaining global skill directories when running npm uninstall -g vskill
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const home = os.homedir();

// Subset of universal agents with their global skill directories
const AGENT_DIRS = [
  { name: "Claude Code", dir: path.join(home, ".claude", "commands") },
  { name: "Cursor", dir: path.join(home, ".cursor", "skills") },
  { name: "GitHub Copilot", dir: path.join(home, ".config", "github-copilot", "skills") },
  { name: "Windsurf", dir: path.join(home, ".windsurf", "skills") },
  { name: "Cline", dir: path.join(home, ".cline", "skills") },
];

const remaining = [];

for (const agent of AGENT_DIRS) {
  try {
    if (fs.existsSync(agent.dir)) {
      const entries = fs.readdirSync(agent.dir);
      if (entries.length > 0) {
        remaining.push(`  ${agent.name}: ${agent.dir} (${entries.length} skill${entries.length === 1 ? "" : "s"})`);
      }
    }
  } catch {
    // Skip inaccessible directories
  }
}

if (remaining.length > 0) {
  console.log("\nvskill: The following global skill directories still contain files:\n");
  for (const line of remaining) {
    console.log(line);
  }
  console.log("\nTo remove them, run: vskill remove <skill-name> --global");
  console.log("Or manually delete the directories listed above.\n");
}

// Clean plugin cache if it exists
const cacheDir = path.join(home, ".claude", "plugins", "cache");
try {
  if (fs.existsSync(cacheDir)) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    console.log("vskill: Cleaned plugin cache at " + cacheDir);
  }
} catch {
  // Ignore cleanup errors
}
