// 0845 T-015 — Clipboard export for Tier-3 agents (ChatGPT, v0, bolt.new).
//
// Returns a paste-ready text blob without writing to disk. The Studio
// renders the blob in `ClipboardExportDialog` and lets the user trigger
// `navigator.clipboard.writeText` from a click handler (user gesture
// required, per AC-US5-05).
//
// Tier 1/2 agents and unknown ids throw — the caller should already have
// dispatched to the canonical or transformer path for those.

import type { ParsedSkill } from "./transformers/index.js";
import { getAgent } from "../agents/agents-registry.js";
import { sanitizeSkillBundleFiles } from "./bundle-files.js";

export interface ClipboardBlob {
  /** The text the user will paste into the cloud tool. */
  blob: string;
  /** URL of the tool's docs page explaining where to paste. */
  pasteInstructionsUrl: string;
  /** Optional landing page for the tool itself. */
  docsUrl?: string;
}

/**
 * Build a clipboard-ready blob for a Tier-3 agent.
 *
 * The blob is a self-contained text payload: skill name, description, and
 * full body separated by horizontal rules. ChatGPT-style cloud tools all
 * accept arbitrary markdown into their custom-instruction boxes, so the
 * same shape works for all current Tier-3 destinations. If a future
 * destination needs a different shape, branch on `agentId` here.
 */
export function buildClipboardBlob(
  skill: ParsedSkill,
  agentId: string,
): ClipboardBlob {
  const agent = getAgent(agentId);
  if (!agent) {
    throw new Error(`Unknown agentId: ${agentId}`);
  }
  if (agent.installMode !== "clipboard") {
    throw new Error(
      `Agent "${agentId}" is not a Tier-3 clipboard target (installMode=${agent.installMode ?? "filesystem"})`,
    );
  }

  const blob = renderClipboardSkillBlob(skill);

  const result: ClipboardBlob = {
    blob,
    pasteInstructionsUrl: agent.pasteInstructionsUrl ?? "",
  };
  if (agent.docsUrl) result.docsUrl = agent.docsUrl;
  return result;
}

function renderClipboardSkillBlob(skill: ParsedSkill): string {
  const sections: string[] = [
    `# ${skill.name}`,
    skill.description,
    "---",
    skill.body.trimEnd(),
  ];

  if (skill.originalFrontmatter.trim().length > 0) {
    sections.push(
      "## Skill frontmatter",
      fenceBlock("yaml", skill.originalFrontmatter.trimEnd()),
    );
  }

  const bundleFiles = sanitizeSkillBundleFiles(skill.files);
  const openAiMetadata = bundleFiles["agents/openai.yaml"];
  if (openAiMetadata !== undefined) {
    sections.push(
      "## OpenAI agent metadata (`agents/openai.yaml`)",
      fenceBlock("yaml", openAiMetadata.trimEnd()),
    );
  }

  const resourceEntries = Object.entries(bundleFiles)
    .filter(([path]) => path !== "agents/openai.yaml")
    .sort(([a], [b]) => a.localeCompare(b));
  if (resourceEntries.length > 0) {
    sections.push("## Bundled resources");
    for (const [path, content] of resourceEntries) {
      sections.push(`### ${path}`, fenceBlock(languageForPath(path), content.trimEnd()));
    }
  }

  return sections.filter((section) => section.length > 0).join("\n\n") + "\n";
}

function fenceBlock(language: string, content: string): string {
  const tickRuns = content.match(/`{3,}/g) ?? [];
  const fenceLength = Math.max(3, ...tickRuns.map((ticks) => ticks.length + 1));
  const fence = "`".repeat(fenceLength);
  return `${fence}${language}\n${content}\n${fence}`;
}

function languageForPath(path: string): string {
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return "yaml";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".mjs") || path.endsWith(".js") || path.endsWith(".ts")) {
    return "javascript";
  }
  if (path.endsWith(".py")) return "python";
  if (path.endsWith(".svg") || path.endsWith(".xml")) return "xml";
  if (path.endsWith(".sh")) return "bash";
  return "text";
}
