import { mergeNativeSkillDocument, readNativeSkillDocument } from "../shared/skill-authoring-document.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createLlmClient } from "../eval/llm.js";
import { findSkillCreatorPath, isSkillCreatorInstalled } from "../utils/skill-creator-detection.js";
import type { GenerateSkillOptions } from "../core/skill-generator.js";
import type { GenerateSkillRequest, GenerateSkillResult, CreateSkillRequest } from "./skill-create-routes.js";

/** Read a direct metadata.engine child without assuming a YAML indent width. */
export function readAuthoringEngine(document: string): NonNullable<CreateSkillRequest["engine"]> {
  const metadata = readNativeSkillDocument(document).fields.metadata as Record<string, unknown> | undefined;
  const engine = metadata?.engine;
  return engine === "none" || engine === "anthropic-skill-creator" ? engine : "vskill";
}

/** Only inspect the detected skill's own directory and plugin version entries. */
export function readSkillCreatorInstructions(root: string): string {
  if (!isSkillCreatorInstalled(root)) throw new Error("skill-creator-not-installed");
  const installed = findSkillCreatorPath(root);
  if (!installed) throw new Error("skill-creator-not-installed");
  const candidates = [join(installed, "SKILL.md"), join(installed, "skills", "skill-creator", "SKILL.md")];
  for (const child of readdirSync(installed, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
    candidates.push(join(installed, child.name, "skills", "skill-creator", "SKILL.md"));
    candidates.push(join(installed, child.name, "SKILL.md"));
  }
  const skill = candidates.find((file) => existsSync(file));
  if (!skill) throw new Error("Installed skill-creator has no readable SKILL.md; reinstall the engine");
  return readFileSync(skill, "utf8");
}

/** Execute the installed authoring instructions, retaining its native document. */
export async function generateWithSkillCreator(request: GenerateSkillRequest, options: GenerateSkillOptions): Promise<GenerateSkillResult> {
  const instructions = readSkillCreatorInstructions(options.root);
  options.abortSignal?.throwIfAborted();
  options.onProgress?.({ phase: "generating-body", message: "Running installed Anthropic skill-creator instructions…" });
  // The safe Claude adapter cannot read/write the host project or load hooks.
  // Supply the explicitly selected installed skill as instructions instead.
  const client = createLlmClient({ provider: "claude-cli", model: request.model || "sonnet" });
  const result = await client.generate(
    `${instructions}\n\nStudio authoring contract: execute the skill creation instructions above for Claude Code. Return only a complete SKILL.md with YAML frontmatter and its body. Keep the full Claude-native schema (including allowed-tools, context, agent and custom metadata where appropriate). Use a block mapping for metadata. Do not run tests, install anything, or write files; Studio will preview and save the result.`,
    request.prompt,
  );
  options.abortSignal?.throwIfAborted();
  const nativeSkillMd = result.text.trim().replace(/^```(?:markdown|md)?\s*\n/i, "").replace(/\n```\s*$/, "") + "\n";
  const { fields: fm, body, version } = readNativeSkillDocument(nativeSkillMd);
  const document = mergeNativeSkillMd(nativeSkillMd, {
    name: fm.name as string, description: fm.description as string, body,
    version: version ?? "1.0.0",
    engine: "anthropic-skill-creator",
  });
  return {
    name: fm.name as string, description: fm.description as string,
    model: typeof fm.model === "string" ? fm.model : "",
    allowedTools: Array.isArray(fm["allowed-tools"]) ? fm["allowed-tools"].join(", ") : typeof fm["allowed-tools"] === "string" ? fm["allowed-tools"] : "",
    body, nativeSkillMd: document, engine: "anthropic-skill-creator", emittedTargets: ["claude-code"],
    evals: [], reasoning: "Authored with the installed Anthropic skill-creator instructions.",
  };
}

/** Shared with the browser preview; parsing never rewrites native YAML. */
export function mergeNativeSkillMd(native: string, data: Pick<CreateSkillRequest, "name" | "description" | "body" | "version" | "allowedTools" | "model" | "engine">): string {
  return mergeNativeSkillDocument(native, data);
}
