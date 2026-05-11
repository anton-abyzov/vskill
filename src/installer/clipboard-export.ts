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

  const blob =
    `# ${skill.name}\n\n` +
    `${skill.description}\n\n` +
    `---\n\n` +
    skill.body.trimEnd() +
    "\n";

  const result: ClipboardBlob = {
    blob,
    pasteInstructionsUrl: agent.pasteInstructionsUrl ?? "",
  };
  if (agent.docsUrl) result.docsUrl = agent.docsUrl;
  return result;
}
