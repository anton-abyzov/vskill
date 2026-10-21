import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createLlmClient } from "../eval/llm.js";
import { findSkillCreatorPath, isSkillCreatorInstalled } from "../utils/skill-creator-detection.js";
import { readFrontmatterVersion, setFrontmatterVersion } from "../utils/version.js";
import { isValidSemver } from "../utils/semver.js";
import { parseSkillFrontmatter } from "./api-routes.js";
import type { GenerateSkillOptions } from "../core/skill-generator.js";
import type { GenerateSkillRequest, GenerateSkillResult, CreateSkillRequest } from "./skill-create-routes.js";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Read a direct metadata.engine child without assuming a YAML indent width. */
export function readAuthoringEngine(document: string): NonNullable<CreateSkillRequest["engine"]> {
  const lines = document.match(FRONTMATTER)?.[1].split(/\r?\n/) ?? [];
  const metadata = lines.findIndex((line) => /^metadata:\s*(?:#.*)?$/.test(line));
  if (metadata < 0) return "vskill";
  const next = lines.findIndex((line, i) => i > metadata && /^[^\s#]/.test(line));
  const children = lines.slice(metadata + 1, next < 0 ? lines.length : next);
  const indents = children.filter((line) => /^ +[^ #]/.test(line)).map((line) => line.length - line.trimStart().length);
  const indent = indents.length ? Math.min(...indents) : 2;
  const value = children.find((line) => new RegExp(`^ {${indent}}engine\\s*:`).test(line))?.split(":").slice(1).join(":").trim();
  const match = value?.match(/^(?:"([^"]*)"|'([^']*)'|([^#]*))/);
  const engine = (match?.[1] ?? match?.[2] ?? match?.[3])?.trim();
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
  const fm = parseSkillFrontmatter(nativeSkillMd.replace(/\r\n/g, "\n"));
  if (!FRONTMATTER.test(nativeSkillMd) || typeof fm.name !== "string" || typeof fm.description !== "string") {
    throw new Error("skill-creator returned no valid SKILL.md name/description frontmatter");
  }
  const body = nativeSkillMd.replace(FRONTMATTER, "").replace(/^\r?\n/, "");
  const generatedVersion = readFrontmatterVersion(nativeSkillMd);
  const document = mergeNativeSkillMd(nativeSkillMd, {
    name: fm.name, description: fm.description, body,
    version: generatedVersion && isValidSemver(generatedVersion) ? generatedVersion : "1.0.0",
    engine: "anthropic-skill-creator",
  });
  return {
    name: fm.name, description: fm.description,
    model: typeof fm.model === "string" ? fm.model : "",
    allowedTools: Array.isArray(fm["allowed-tools"]) ? fm["allowed-tools"].join(", ") : typeof fm["allowed-tools"] === "string" ? fm["allowed-tools"] : "",
    body, nativeSkillMd: document, engine: "anthropic-skill-creator", emittedTargets: ["claude-code"],
    evals: [], reasoning: "Authored with the installed Anthropic skill-creator instructions.",
  };
}

/** Replace one mapping field without reserializing unknown native schema. */
function replaceField(lines: string[], key: string, value: string, indent: number, start = 0, end = lines.length): void {
  const pattern = new RegExp(`^ {${indent}}${key}:`);
  const index = lines.findIndex((line, i) => i >= start && i < end && pattern.test(line));
  const replacement = `${" ".repeat(indent)}${key}: ${value}`;
  if (index < 0) { lines.splice(end, 0, replacement); return; }
  let stop = index + 1;
  while (stop < end && (!lines[stop].trim() || lines[stop].match(/^ */)![0].length > indent)) stop++;
  lines.splice(index, stop - index, replacement);
}

export function mergeNativeSkillMd(native: string, data: Pick<CreateSkillRequest, "name" | "description" | "body" | "version" | "allowedTools" | "model" | "engine">): string {
  const versioned = setFrontmatterVersion(native, data.version || "1.0.0");
  const match = versioned.match(FRONTMATTER);
  if (!match) throw new Error("Native skill must contain YAML frontmatter");
  const original = parseSkillFrontmatter(native.replace(/\r\n/g, "\n"));
  const lines = match[1].split(/\r?\n/);
  replaceField(lines, "name", JSON.stringify(data.name), 0);
  replaceField(lines, "description", JSON.stringify(data.description), 0);
  const originalTools = Array.isArray(original["allowed-tools"]) ? original["allowed-tools"].join(", ") : original["allowed-tools"] || "";
  if (data.allowedTools !== undefined && data.allowedTools !== originalTools) replaceField(lines, "allowed-tools", JSON.stringify(data.allowedTools), 0);
  if (data.model !== undefined && data.model !== original.model) replaceField(lines, "model", JSON.stringify(data.model), 0);
  let metadata = lines.findIndex((line) => /^metadata:\s*(?:#.*)?$/.test(line));
  if (metadata < 0) {
    if (lines.some((line) => /^metadata\s*:/.test(line))) throw new Error("Native skill metadata must use a block mapping");
    metadata = lines.length;
    lines.push("metadata:");
  }
  const end = () => {
    const next = lines.findIndex((line, index) => index > metadata && /^[^\s#]/.test(line));
    return next < 0 ? lines.length : next;
  };
  const indents = lines.slice(metadata + 1, end()).filter((line) => /^ +[^ #]/.test(line))
    .map((line) => line.length - line.trimStart().length);
  const indent = indents.length ? Math.min(...indents) : 2;
  const engine = data.engine ?? "anthropic-skill-creator";
  replaceField(lines, "engine", engine, indent, metadata + 1, end());
  if (engine === "anthropic-skill-creator") replaceField(lines, "target-agents", "[claude-code]", indent, metadata + 1, end());
  // The body is the user's reviewed/edited preview, never the generic emitter.
  return `---\n${lines.join("\n")}\n---\n\n${data.body}`;
}
