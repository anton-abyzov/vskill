import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
const yaml = createRequire(import.meta.url)("js-yaml");
const mocks = vi.hoisted(() => ({ installed: "", generate: vi.fn() }));
vi.mock("../platform-proxy.js", () => ({ submitSkillUpdateEvent: vi.fn(async () => ({ success: true })) }));
vi.mock("../../eval/llm.js", () => ({ createLlmClient: () => ({ generate: mocks.generate }) }));
vi.mock("../../utils/skill-creator-detection.js", () => ({ isSkillCreatorInstalled: () => !!mocks.installed, findSkillCreatorPath: () => mocks.installed || null }));
import { registerSkillCreateRoutes } from "../skill-create-routes.js";
import { generateWithSkillCreator } from "../skill-authoring-engine.js";
const native = '---\nname: existing\ndescription: Existing\nmetadata:\n  version: 1.0.0\n  engine: none\n---\nPRESERVE';
const parse = (text: string) => yaml.load(text.match(/^---\r?\n([\s\S]*?)\r?\n---/)![1]);
const post = "/api/skills/create", get = "/api/skills/:plugin/:skill/authoring";
let fixture: string;
beforeEach(() => { fixture = mkdtempSync(join(tmpdir(), "native-integrity-")); mocks.installed = ""; mocks.generate.mockReset(); });
afterEach(() => rmSync(fixture, { recursive: true, force: true }));
function setup(layout = 3) {
  const root = join(fixture, "Project"); mkdirSync(root);
  const plugin = layout === 3 ? "" : "fixture-plugin";
  const dir = layout === 1 ? join(root, plugin, "skills/existing") : layout === 2 ? join(root, "plugins", plugin, "skills/existing") : join(root, "skills/existing");
  mkdirSync(dir, { recursive: true }); const file = join(dir, "SKILL.md"); writeFileSync(file, native);
  const handlers: Record<string, any> = {};
  registerSkillCreateRoutes({ get: (p: string, h: any) => handlers[p] = h, post: (p: string, h: any) => handlers[p] = h } as any, root);
  const base = { name: "existing", description: "Reviewed", body: "Reviewed body", layout, plugin, mode: "update", engine: "none", version: "1.0.1" };
  async function call(route: string, body?: unknown, params = { plugin: plugin || basename(root), skill: "existing" }) {
    const req: any = new EventEmitter(); req.headers = {};
    const res: any = { status: 0, result: null, writeHead(status: number) { this.status = status; }, end(text: string) { this.result = JSON.parse(text); } };
    const pending = handlers[route](req, res, params);
    if (body !== undefined) { req.emit("data", Buffer.from(JSON.stringify(body))); req.emit("end"); }
    await pending; return res;
  }
  return { root, dir, file, base, call };
}

it.each([
  'description: "First\n  second"\ncontext: fork\nmetadata:\n  version: 1.0.0\n  engine: none',
  "description: 'First\n  second'\n# retain root note\nmetadata:\n    version: 1.0.0\n    custom: [\n      first, # retain flow note\n      second\n    ]\n    engine: none",
  '"description": Existing\nmetadata:\n  "version": 1.0.0\n  custom: {nested: [one, two]}\n  engine: none',
])("edits YAML structure and retains unrelated values and comments: %s", async (fields) => {
  const f = setup(); const before = `---\nname: existing\n${fields}\n---\nPRESERVE`; writeFileSync(f.file, before);
  const original = parse(before); const response = await f.call(post, f.base); expect(response.status).toBe(200);
  const after = readFileSync(f.file, "utf8"); const result = parse(after);
  expect(result.description).toBe("Reviewed"); expect(result.metadata.version).toBe("1.0.1");
  expect(result.metadata.custom).toEqual(original.metadata.custom); expect(result.context).toEqual(original.context);
  if (fields.includes("retain")) { expect(after).toContain("# retain root note"); expect(after).toContain("first, # retain flow note"); }
  expect(after.endsWith("Reviewed body")).toBe(true);
});
it.each(["allowedTools", "model"])("refuses clearing or changing referenced %s anchors without writing", async (field) => {
  const f = setup(); const key = field === "model" ? "model" : "allowed-tools";
  const before = `---\nname: existing\ndescription: Existing\n${key}: &value ${field === "model" ? "opus" : "[Read, Bash]"}\nmetadata:\n  version: 1.0.0\n  custom: *value\n---\nPRESERVE`;
  writeFileSync(f.file, before);
  for (const value of ["", "changed"]) { const response = await f.call(post, { ...f.base, [field]: value }); expect(response.status).toBe(400); expect(response.result.error).toMatch(/alias/); expect(readFileSync(f.file, "utf8")).toBe(before); }
});
it("keeps untouched anchors and aliases while editing independent fields", async () => {
  const f = setup(); const before = native.replace("metadata:", "allowed-tools: &tools [Read, Bash]\nmetadata:").replace("  engine: none", "  engine: none\n  custom: *tools"); writeFileSync(f.file, before);
  expect((await f.call(post, f.base)).status).toBe(200); const after = readFileSync(f.file, "utf8");
  expect(after).toContain("allowed-tools: &tools [Read, Bash]"); expect(after).toContain("custom: *tools"); expect(parse(after).metadata.custom).toEqual(["Read", "Bash"]);
});
it.each([
  'description: "First\nsecond"\nmetadata:\n  engine: none',
  "description: Existing\nmetadata:\n  version: 1.0.0\n  custom: [\nfirst,\nsecond\n]\n  engine: none",
  "description: Existing\ncontext: [unclosed\nmetadata:\n  version: 1.0.0",
  "description: Existing\nmetadata:\n  custom: *missing",
  "description: Existing\ndescription: Duplicate",
  "description: Existing\nmetadata: 42",
  "description: Existing\nmetadata:\n  engine: unknown",
  "description: Existing\nmetadata:\n  version: 42",
  "description: 42",
  "description: Existing\nmodel: [opus]",
  "description: Existing\nallowed-tools: [Read, 42]",
])("rejects invalid source and generated/saved metadata without writes: %s", async (fields) => {
  const f = setup(); const bad = `---\nname: existing\n${fields}\n---\nPRESERVE`; writeFileSync(f.file, bad);
  expect((await f.call(post, f.base)).status).toBe(400); expect(readFileSync(f.file, "utf8")).toBe(bad);
  mocks.installed = join(fixture, "engine"); mkdirSync(mocks.installed); writeFileSync(join(mocks.installed, "SKILL.md"), "Fixture instructions"); mocks.generate.mockResolvedValue({ text: bad });
  await expect(generateWithSkillCreator({ prompt: "Fixture only" }, { root: f.root })).rejects.toThrow();
  for (const route of [post, "/api/skills/save-draft"]) {
    const res = await f.call(route, { ...f.base, mode: "create", name: "created", engine: "anthropic-skill-creator", nativeSkillMd: bad, aiMeta: { prompt: "fixture", provider: "fixture", model: "fixture", reasoning: "fixture" } });
    expect(res.status).toBe(400); expect(existsSync(join(f.root, "skills/created"))).toBe(false);
  }
});
it.each([undefined, null, {}, [], 42, false])("rejects malformed body %j before changing files", async (body) => {
  const f = setup(); for (const route of [post, "/api/skills/save-draft"]) {
    const response = await f.call(route, { ...f.base, body }); expect(response.status).toBe(400); expect(readFileSync(f.file, "utf8")).toBe(native);
  }
});
it.each([{description:42}, {model:{}}, {allowedTools:[]}, {nativeSkillMd:{}}, {version:42}, {version:"bad"}, {engine:42}, {mode:"other"}, {aiMeta:{}}, {aiMeta:42}, {targetAgents:[42]}, {secrets:"secret"}, {plugin:42}])("rejects malformed request metadata %j", async (fields) => {
  const f = setup(); expect((await f.call(post, { ...f.base, ...fields })).status).toBe(400); expect(readFileSync(f.file, "utf8")).toBe(native);
});
it.each([1,2,3])("handles internal case aliases according to filesystem identity in layout %s", async (layout) => {
  const f = setup(layout); const aliasTarget = f.dir.replace("/Project/", "/project/"); const targetExists = existsSync(aliasTarget);
  symlinkSync(aliasTarget, join(dirname(f.dir), "linked"), "dir");
  const loaded = await f.call(get, undefined, { plugin: f.base.plugin || basename(f.root), skill: "linked" });
  const saved = await f.call(post, { ...f.base, name: "linked" });
  expect(loaded.status).toBe(targetExists ? 200 : 404); expect(saved.status).toBe(targetExists ? 200 : 404);
  if (!targetExists) expect(readFileSync(f.file, "utf8")).toBe(native);
});
it.each([1,2,3])("rejects external aliases even when their targets use another case in layout %s", async (layout) => {
  const f = setup(layout); const outside = join(fixture, "Outside"); mkdirSync(outside); writeFileSync(join(outside, "SKILL.md"), native);
  const aliasTarget = outside.toUpperCase(); symlinkSync(aliasTarget, join(dirname(f.dir), "linked"), "dir");
  const loaded = await f.call(get, undefined, { plugin: f.base.plugin || basename(f.root), skill: "linked" });
  const saved = await f.call(post, { ...f.base, name: "linked" });
  expect(loaded.status).toBe(existsSync(aliasTarget) ? 403 : 404); expect(saved.status).toBe(existsSync(aliasTarget) ? 403 : 404); expect(readFileSync(join(outside, "SKILL.md"), "utf8")).toBe(native);
});

it("uses structural version reads for quoted keys on load, auto-bump and native generation", async () => {
  const f = setup(); const document = native.replace("version: 1.0.0", '\"version\": 4.2.3'); writeFileSync(f.file, document);
  const loaded = await f.call(get); expect(loaded.result.version).toBe("4.2.3");
  const saved = await f.call(post, { ...f.base, version: undefined }); expect(saved.status).toBe(200); expect(saved.result.version).toBe("4.2.4"); expect(parse(readFileSync(f.file, "utf8")).metadata.version).toBe("4.2.4");
  mocks.installed = join(fixture, "engine"); mkdirSync(mocks.installed); writeFileSync(join(mocks.installed, "SKILL.md"), "Fixture instructions"); mocks.generate.mockResolvedValue({ text: document });
  const generated = await generateWithSkillCreator({ prompt: "Fixture only" }, { root: f.root }); expect(parse(generated.nativeSkillMd!).metadata.version).toBe("4.2.3");
});
