#!/usr/bin/env tsx
/**
 * 0693 — Generate agents.json from canonical AGENTS_REGISTRY.
 *
 * Single source of truth: vskill/src/agents/agents-registry.ts
 *
 * Output: vskill/agents.json
 *   {
 *     version: 1,
 *     generatedAt: ISO timestamp,
 *     agentPrefixes: deduped first-segments of every agent's localSkillsDir,
 *     nonAgentConfigDirs: NON_AGENT_CONFIG_DIRS (editor/IDE/CI dirs)
 *   }
 *
 * Consumed by:
 *  - vskill-platform/src/lib/skill-path-validation.ts (TS, resolveJsonModule)
 *  - vskill-platform/crawl-worker/sources/queue-processor.js (CJS require)
 *  - vskill-platform/crawl-worker/lib/repo-files.js (CJS require)
 *
 * vskill-platform copies this file in via its prebuild step
 * (scripts/sync-agents-json.cjs).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENTS_REGISTRY,
  NON_AGENT_CONFIG_DIRS,
} from "../src/agents/agents-registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AgentsManifest {
  version: 1;
  generatedAt: string;
  /** First-segment dirs only (e.g. ".claude", ".cursor"). Used for
   *  origin classification and skill-scanner prefix matching. */
  agentPrefixes: string[];
  /** Trailing-slash path prefixes derived from localSkillsDir minus the
   *  final "/skills" (or similar) segment — preserves multi-segment
   *  prefixes like ".github/copilot/". Used by validators that need
   *  more-specific matching to avoid over-rejecting (e.g. ".github/workflows"). */
  agentPathPrefixes: string[];
  /** Non-agent editor/IDE/CI dirs (e.g. ".vscode", ".idea"). */
  nonAgentConfigDirs: string[];
}

/** Derive the "config dir" portion of an agent's localSkillsDir by stripping
 *  the trailing "/skills" segment if present. E.g.:
 *   ".claude/skills"          -> ".claude/"
 *   ".github/copilot/skills"  -> ".github/copilot/"
 *   ".agent/skills"           -> ".agent/"
 * Returns null if the dir doesn't end in "/skills" (defensive — shouldn't
 *  happen in current registry but guards future shape drift). */
function agentPathPrefix(localSkillsDir: string): string | null {
  if (!localSkillsDir.endsWith("/skills")) return null;
  const dir = localSkillsDir.slice(0, -"/skills".length);
  return dir.length > 0 ? dir + "/" : null;
}

export function buildAgentsManifest(): AgentsManifest {
  const firstSegments = new Set<string>();
  const pathPrefixes = new Set<string>();
  for (const agent of AGENTS_REGISTRY) {
    const first = agent.localSkillsDir.split("/")[0];
    if (first) firstSegments.add(first);
    const fullPrefix = agentPathPrefix(agent.localSkillsDir);
    if (fullPrefix) pathPrefixes.add(fullPrefix);
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    agentPrefixes: [...firstSegments].sort(),
    agentPathPrefixes: [...pathPrefixes].sort(),
    nonAgentConfigDirs: [...NON_AGENT_CONFIG_DIRS],
  };
}

function main(): void {
  const manifest = buildAgentsManifest();
  const outPath = path.resolve(__dirname, "..", "agents.json");
  writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  // eslint-disable-next-line no-console
  console.log(
    `[generate-agents-json] wrote ${outPath} ` +
      `(${manifest.agentPrefixes.length} agent prefixes, ` +
      `${manifest.nonAgentConfigDirs.length} non-agent dirs)`,
  );
}

const isEntry =
  process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isEntry) main();
