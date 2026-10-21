import { Composer, CST, isAlias, isMap, isNode, isScalar, Parser, visit, type Document, type YAMLMap } from "yaml";
import { isValidSemver } from "../utils/semver.js";

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const ENGINES = ["vskill", "anthropic-skill-creator", "none"];
export class AuthoringValidationError extends Error {}
export interface NativeSkillFields {
  name: string; description: string; body: string;
  version?: string; allowedTools?: string; model?: string;
  engine?: "vskill" | "anthropic-skill-creator" | "none";
}
export interface NativeSkillOriginalFields { model?: unknown; "allowed-tools"?: unknown; }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string");

/** Validate external form data before filesystem reads, generation, or writes. */
export function authoringRequestError(value: unknown, draft = false): string | undefined {
  if (!object(value)) return "Authoring request must be an object";
  if (typeof value.name !== "string" || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(value.name)) return "Name must be kebab-case (lowercase letters, numbers, hyphens)";
  if (typeof value.description !== "string" || !value.description.trim()) return "Description is required and must be a string";
  if (typeof value.body !== "string") return "Body is required and must be a string";
  if (![1, 2, 3].includes(value.layout as number)) return "Layout must be 1, 2, or 3";
  if (value.layout !== 3 && (typeof value.plugin !== "string" || !value.plugin.trim())) return "Plugin name is required for this layout";
  if (value.plugin !== undefined && (typeof value.plugin !== "string" || value.plugin && !/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i.test(value.plugin))) return "Plugin name contains invalid characters";
  for (const key of ["model", "allowedTools", "nativeSkillMd", "version", "draftDir"])
    if (value[key] !== undefined && typeof value[key] !== "string") return `${key} must be a string`;
  if (value.nativeSkillMd === "") return "Native skill must contain valid SKILL.md YAML frontmatter";
  if (typeof value.version === "string" && value.version.trim() && !isValidSemver(value.version.trim())) return "Invalid version: expected semantic version";
  if (value.engine !== undefined && !ENGINES.includes(value.engine as string)) return "Invalid engine";
  if (value.mode !== undefined && value.mode !== "create" && value.mode !== "update") return "Invalid authoring mode";
  for (const key of ["tags", "targetAgents", "secrets"])
    if (value[key] !== undefined && !strings(value[key])) return `${key} must be an array of strings`;
  if (draft || value.aiMeta !== undefined) {
    if (!object(value.aiMeta)) return "aiMeta must be an object";
    for (const key of ["prompt", "provider", "model", "reasoning"])
      if (typeof value.aiMeta[key] !== "string") return `aiMeta.${key} must be a string`;
  }
}

/** Parse once into a document and its shared concrete tokens. Tokens retain the
 * exact source of fields we do not edit, including comments and whitespace. */
export function readNativeSkillDocument(native: string) {
  if (typeof native !== "string") throw new AuthoringValidationError("Native skill must be a string");
  const match = native.match(FRONTMATTER);
  if (!match) throw new AuthoringValidationError("Native skill must contain valid SKILL.md YAML frontmatter");
  const source = `${match[1]}\n`;
  const tokens = [...new Parser().parse(source)];
  const documents = [...new Composer({ keepSourceTokens: true, strict: true, uniqueKeys: true, stringKeys: true }).compose(tokens, true, source.length)];
  const doc = documents[0];
  if (documents.length !== 1 || !doc || doc.errors.length || !isMap(doc.contents))
    throw new AuthoringValidationError(`Invalid native YAML: ${doc?.errors[0]?.message ?? "expected one mapping"}`);
  let fields: Record<string, unknown>;
  try { fields = doc.toJS({ maxAliasCount: 100 }); }
  catch (error) { throw new AuthoringValidationError(`Invalid native YAML: ${(error as Error).message}`); }
  if (fields.metadata !== undefined && !object(fields.metadata)) throw new AuthoringValidationError("Native skill metadata must use a block mapping");
  if (typeof fields.name !== "string" || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(fields.name) || typeof fields.description !== "string" || !fields.description.trim())
    throw new AuthoringValidationError("Native skill must contain valid SKILL.md name/description frontmatter");
  if (fields.model !== undefined && typeof fields.model !== "string") throw new AuthoringValidationError("Native model must be a string");
  if (fields["allowed-tools"] !== undefined && typeof fields["allowed-tools"] !== "string" && !strings(fields["allowed-tools"]))
    throw new AuthoringValidationError("Native allowed-tools must be a string or string list");
  for (const value of [fields.version, (fields.metadata as Record<string, unknown> | undefined)?.version])
    if (value !== undefined && (typeof value !== "string" || !isValidSemver(value))) throw new AuthoringValidationError("Invalid native version");
  const engine = (fields.metadata as Record<string, unknown> | undefined)?.engine;
  if (engine !== undefined && !ENGINES.includes(engine as string)) throw new AuthoringValidationError("Invalid native engine");
  const version = (fields.version ?? (fields.metadata as Record<string, unknown> | undefined)?.version) as string | undefined;
  return { doc, tokens, fields, version, body: native.slice(match[0].length).replace(/^\r?\n/, "") };
}

/** Refuse edits that would change or remove the value used by an unrelated alias. */
function protectAliases(doc: Document, node: unknown, container: YAMLMap): void {
  const descendants = new Set<unknown>();
  if (isNode(node)) visit(node, (_, current) => { if (isNode(current)) descendants.add(current); });
  const affected = new Set(descendants);
  // Changing or inserting a child changes every ancestor container's value.
  // Include those exact nodes, not their unrelated descendant fields.
  visit(doc, (_, current, path) => {
    if (current === container) {
      affected.add(container);
      for (const ancestor of path) if (isNode(ancestor)) affected.add(ancestor);
    }
  });
  visit(doc, (_, current) => {
    if (isAlias(current) && !descendants.has(current) && affected.has(current.resolve(doc)))
      throw new AuthoringValidationError("Cannot edit a field referenced by a YAML alias; preserve or remove its dependent aliases first");
  });
}

/** Retain actual comment tokens from removed values, never scalar text that only
 * looks like a comment. Traversal is over the parser's CST, not line patterns. */
function comments(value: unknown): CST.SourceToken[] {
  if (!object(value) && !Array.isArray(value)) return [];
  if (object(value) && value.type === "comment") return [value as unknown as CST.SourceToken, { type: "newline", source: "\n", offset: -1, indent: 0 }];
  return Object.values(value).flatMap(comments);
}
function editField(doc: Document, map: YAMLMap, key: string, value: string | string[] | undefined, quoted = false): void {
  const token = map.srcToken;
  if (token?.type !== "block-map") throw new AuthoringValidationError("Native skill metadata must use a block mapping");
  const pair = map.items.find((item) => object(item.key) && item.key.value === key);
  if (!pair && value === undefined || isScalar(pair?.value) && pair.value.value === value) return;
  protectAliases(doc, pair?.value, map);
  const old = pair?.srcToken;
  const note = comments(old ? [old.sep, old.value] : []);
  const index = old ? token.items.indexOf(old as typeof token.items[number]) : token.items.length;
  const indent = token.indent;
  const fragment = value === undefined ? undefined : [...new Parser().parse(`${key}: ${Array.isArray(value) ? "[claude-code]" : quoted ? JSON.stringify(value) : value}\n`)][0] as CST.Document | undefined;
  const replacement = fragment?.value?.type === "block-map" ? fragment.value.items[0] : undefined;
  if (replacement?.key) {
    replacement.start = old?.start ?? [{ type: "space", source: " ".repeat(indent), indent, offset: -1 }];
    if (old?.key) replacement.key = old.key;
    if ("indent" in replacement.key) replacement.key.indent = indent;
    if (replacement.value && "end" in replacement.value) replacement.value.end = [...(replacement.value.end ?? []), ...note];
    token.items.splice(index, old ? 1 : 0, replacement);
  } else if (old) token.items.splice(index, 1, { start: [...old.start, ...note] });
}

export function mergeNativeSkillDocument(native: string, data: NativeSkillFields, _original?: NativeSkillOriginalFields): string {
  if (typeof data.body !== "string") throw new AuthoringValidationError("Body is required and must be a string");
  let parsed = readNativeSkillDocument(native);
  const newline = native.includes("\r\n") ? "\r\n" : "\n";
  // Reparse between structural edits so AST lookup and alias resolution always
  // describe the current CST. No unrelated node is reserialized.
  const edit = (path: string[], value: string | string[] | undefined, quoted = false) => {
    const parent = path.length === 1 ? parsed.doc.contents : parsed.doc.getIn(path.slice(0, -1), true);
    if (!isMap(parent)) throw new AuthoringValidationError("Native skill metadata must use a block mapping");
    editField(parsed.doc, parent, path[path.length - 1], value, quoted);
    const text = parsed.tokens.map(CST.stringify).join("");
    parsed = readNativeSkillDocument(`---\n${text}---\n${data.body}`);
  };
  edit(["name"], data.name, true); edit(["description"], data.description, true);
  for (const [key, value] of [["model", data.model], ["allowed-tools", data.allowedTools]] as const) {
    const original = parsed.fields[key];
    const displayed = Array.isArray(original) ? original.join(", ") : original;
    if (value !== undefined && (!value.trim() || value !== displayed)) edit([key], value.trim() ? value : undefined, true);
  }
  if (!parsed.doc.has("metadata")) {
    const token = parsed.doc.contents!.srcToken;
    if (token?.type !== "block-map") throw new AuthoringValidationError("Native skill metadata must use a block mapping");
    protectAliases(parsed.doc, undefined, parsed.doc.contents as YAMLMap);
    const fragment = [...new Parser().parse("metadata:\n  engine: vskill\n")][0] as CST.Document;
    token.items.push(...(fragment.value as CST.BlockMap).items);
    parsed = readNativeSkillDocument(`---\n${parsed.tokens.map(CST.stringify).join("")}---\n${data.body}`);
  }
  edit(parsed.doc.has("version") ? ["version"] : ["metadata", "version"], data.version || "1.0.0", true);
  edit(["metadata", "engine"], data.engine ?? "anthropic-skill-creator");
  if ((data.engine ?? "anthropic-skill-creator") === "anthropic-skill-creator") edit(["metadata", "target-agents"], ["claude-code"]);
  const frontmatter = parsed.tokens.map(CST.stringify).join("").replace(/\r?\n/g, newline);
  const output = `---${newline}${frontmatter}---${newline}${newline}${data.body}`;
  readNativeSkillDocument(output); // Full schema and alias check immediately before the caller writes.
  return output;
}
