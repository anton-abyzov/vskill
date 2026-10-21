import { setFrontmatterVersion } from "../utils/version.js";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
export interface NativeSkillFields {
  name: string; description: string; body: string;
  version?: string; allowedTools?: string; model?: string;
  engine?: "vskill" | "anthropic-skill-creator" | "none";
}
/** Parsed originals are used only to preserve unchanged native list/scalar shape. */
export interface NativeSkillOriginalFields { model?: unknown; "allowed-tools"?: unknown; }

/** Replace one mapping field without reserializing unknown native schema. */
function replaceField(lines: string[], key: string, value: string | undefined, indent: number, start = 0, end = lines.length): void {
  const pattern = new RegExp(`^ {${indent}}${key}:`);
  const index = lines.findIndex((line, i) => i >= start && i < end && pattern.test(line));
  const replacement = value === undefined ? [] : [`${" ".repeat(indent)}${key}: ${value}`];
  if (index < 0) { lines.splice(end, 0, ...replacement); return; }
  let stop = index + 1;
  const listItem = new RegExp(`^ {${indent}}-\\s`);
  while (stop < end && (!lines[stop].trim() || lines[stop].match(/^ */)![0].length > indent || listItem.test(lines[stop]))) stop++;
  lines.splice(index, stop - index, ...replacement);
}

export function mergeNativeSkillDocument(native: string, data: NativeSkillFields, original: NativeSkillOriginalFields): string {
  const versioned = setFrontmatterVersion(native, data.version || "1.0.0");
  const match = versioned.match(FRONTMATTER);
  if (!match) throw new Error("Native skill must contain YAML frontmatter");
  const lines = match[1].split(/\r?\n/);
  replaceField(lines, "name", JSON.stringify(data.name), 0);
  replaceField(lines, "description", JSON.stringify(data.description), 0);
  const originalTools = Array.isArray(original["allowed-tools"]) ? original["allowed-tools"].join(", ") : original["allowed-tools"] || "";
  // Omitted API fields preserve native schema; an explicit blank removes the
  // field (including a block-list continuation) to restore the agent default.
  if (data.allowedTools !== undefined && (!data.allowedTools.trim() || data.allowedTools !== originalTools)) replaceField(lines, "allowed-tools", data.allowedTools.trim() ? JSON.stringify(data.allowedTools) : undefined, 0);
  if (data.model !== undefined && (!data.model.trim() || data.model !== original.model)) replaceField(lines, "model", data.model.trim() ? JSON.stringify(data.model) : undefined, 0);
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
