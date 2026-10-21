import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createRequire } from "node:module";
import { Router } from "../router.js";
import { registerSkillCreateRoutes } from "../skill-create-routes.js";
import { parseSkillFrontmatter } from "../api-routes.js";
import { studioTokenHeaders } from "./helpers/studio-token-test-helpers.js";
const parseYaml = createRequire(import.meta.url)("js-yaml").load as (text: string) => Record<string, unknown>;

vi.mock("../platform-proxy.js", () => ({ submitSkillUpdateEvent: vi.fn(async () => ({ success: true })) }));
vi.mock("../../eval/llm.js", () => ({ createLlmClient: () => { throw new Error("Editor updates must not call a model"); } }));

describe("authoring load/edit/save over HTTP", () => {
  let root: string, file: string, url: string, server: Server;
  const headers = { "content-type": "application/json", ...studioTokenHeaders() };
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "vskill-authoring-lifecycle-"));
    mkdirSync(join(root, "skills", "existing"), { recursive: true });
    file = join(root, "skills", "existing", "SKILL.md");
    const router = new Router();
    registerSkillCreateRoutes(router, root);
    server = createServer((req, res) => { void router.handle(req, res); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(root, { recursive: true, force: true });
  });

  async function update(fields: Record<string, string>, checkInitialTools = true) {
    const loaded = await fetch(`${url}/api/skills/${basename(root)}/existing/authoring`, { headers });
    expect(loaded.status).toBe(200);
    const context = await loaded.json() as Record<string, unknown>;
    expect(context).toMatchObject({ model: "opus", engine: "vskill", version: "1.0.0" });
    if (checkInitialTools) expect(context.allowedTools).toBe("Read, Bash");
    const saved = await fetch(`${url}/api/skills/create`, {
      method: "POST", headers,
      body: JSON.stringify({ name: context.name, plugin: context.plugin, layout: context.layout, mode: "update", nativeSkillMd: context.nativeSkillMd, description: "Reviewed description", body: "\nReviewed body  \n", version: "1.0.1", ...fields }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ engine: "vskill", skill: "existing" });
    const document = readFileSync(file, "utf8");
    expect(parseYaml(document.match(/^---\n([\s\S]*?)\n---/)![1])).toMatchObject({ context: "fork", agent: "Explore" });
    expect(document).toContain("context: fork\nagent: Explore\nhooks:\n  Stop:\n    - matcher: \"\"\n      command: echo fixture");
    expect(document).toContain("  custom:\n    nested: retained");
    expect(document).toContain("  engine: vskill");
    expect(document).toContain('  version: "1.0.1"');
    expect(document.endsWith("\nReviewed body  \n")).toBe(true);
    const reloaded = await fetch(`${url}/api/skills/${basename(root)}/existing/authoring`, { headers });
    expect(reloaded.status).toBe(200);
    const contextAfterSave = await reloaded.json() as Record<string, unknown>;
    expect(contextAfterSave).toMatchObject({ version: "1.0.1", nativeSkillMd: document });
    return { document, contextAfterSave };
  }

  function seed(tools: string) {
    writeFileSync(file, `---\nname: existing\ndescription: Existing\nmodel: opus\n${tools}\ncontext: fork\nagent: Explore\nhooks:\n  Stop:\n    - matcher: ""\n      command: echo fixture\nmetadata:\n  version: "1.0.0"\n  engine: vskill\n  custom:\n    nested: retained\n---\nOriginal body\n`);
  }

  it.each([
    "allowed-tools: Read, Bash", "allowed-tools:\n  - Read\n  - Bash", "allowed-tools:\n- Read\n- Bash",
    "allowed-tools:\n- Read\n# preserve permission note\n- Bash",
    "allowed-tools:\n  - Read\n# preserve permission note\n  - Bash",
    "allowed-tools:\n    - Read\n\n  # preserve permission note\n\n    - Bash",
    "allowed-tools: [\n  Read,\n# preserve permission note\n  Bash\n]",
    "allowed-tools:\n  [Read,\n# preserve permission note\nBash\n]",
    "allowed-tools: [\n'Read]',\n# preserve permission note\n\"Bash[\"\n]",
  ])("removes explicitly cleared optional fields with %s", async (tools) => {
    seed(tools);
    expect(parseYaml(readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---/)![1])).toHaveProperty("allowed-tools");
    if (tools.includes("\nBash") || tools.includes("\n'Read]")) {
      const before = readFileSync(file, "utf8");
      const res = await post("/api/skills/create", { name: "existing", mode: "update", allowedTools: "" });
      expect(res.status).toBe(400); expect((await res.json() as any).error).toMatch(/Invalid native YAML/);
      expect(readFileSync(file, "utf8")).toBe(before); return;
    }
    const { document, contextAfterSave } = await update({ model: "", allowedTools: "" }, !tools.includes("# preserve permission note"));
    expect(document).not.toMatch(/^(model|allowed-tools):/m);
    expect(parseSkillFrontmatter(document)).not.toHaveProperty("model");
    expect(parseSkillFrontmatter(document)).not.toHaveProperty("allowed-tools");
    expect(document).not.toMatch(/^\s*- (Read|Bash)$/m);
    expect(contextAfterSave).toMatchObject({ model: "", allowedTools: "" });
    if (tools.includes("# preserve permission note")) expect(document).toContain("# preserve permission note");
  });

  it("preserves omitted optional fields and the original array shape", async () => {
    seed("allowed-tools:\n  - Read\n  - Bash");
    const { document, contextAfterSave } = await update({});
    expect(document).toContain("model: opus\nallowed-tools:\n  - Read\n  - Bash");
    expect(contextAfterSave).toMatchObject({ model: "opus", allowedTools: "Read, Bash" });
  });
  it.each(["allowed-tools:\n    - Read\n    - Bash", "allowed-tools: [\nRead,\nBash\n]"])("preserves an untouched richer native field: %s", async (tools) => {
    seed(tools);
    if (tools.includes("\nRead,")) {
      const before = readFileSync(file, "utf8");
      const res = await post("/api/skills/create", { name: "existing", mode: "update" });
      expect(res.status).toBe(400); expect((await res.json() as any).error).toMatch(/Invalid native YAML/);
      expect(readFileSync(file, "utf8")).toBe(before); return;
    }
    const { document } = await update({}, false);
    expect(document).toContain(tools);
    expect(parseYaml(document.match(/^---\n([\s\S]*?)\n---/)![1])).toMatchObject({model: "opus", "allowed-tools": ["Read", "Bash"]});
  });

  it("replaces explicitly edited optional fields without reserializing custom schema", async () => {
    seed("allowed-tools:\n  - Read\n  - Bash");
    const { document, contextAfterSave } = await update({ model: "sonnet", allowedTools: "Read, Write" });
    expect(parseSkillFrontmatter(document)).toMatchObject({ model: "sonnet", "allowed-tools": "Read, Write" });
    expect(document).not.toMatch(/^  - (Read|Bash)$/m);
    expect(contextAfterSave).toMatchObject({ model: "sonnet", allowedTools: "Read, Write" });
  });

  async function post(route: string, overrides: Record<string, unknown> = {}) {
    return fetch(`${url}${route}`, { method: "POST", headers, body: JSON.stringify({
      name: "created", description: "Fixture", layout: 3, plugin: "", body: "Body", engine: "none", ...overrides,
    }) });
  }
  it.each([
    [{name: "../outside"}, /kebab-case/], [{description: " "}, /Description/],
    [{layout: 4}, /Layout/], [{layout: 1}, /Plugin name is required/],
    [{layout: 2, plugin: "../outside"}, /invalid characters/],
  ])("rejects invalid authoring input before writing: %j", async (fields, error) => {
    const res = await post("/api/skills/create", fields as Record<string, unknown>);
    expect(res.status).toBe(400); expect((await res.json() as {error: string}).error).toMatch(error as RegExp);
    expect(existsSync(join(root, "skills", "created"))).toBe(false);
  });
  it.each([{name: "Bad Name"}, {description: ""}, {layout: 9}])("rejects invalid drafts: %j", async (fields) => {
    const res = await post("/api/skills/save-draft", fields);
    expect(res.status).toBe(400); await res.text();
    expect(existsSync(join(root, "skills", "created"))).toBe(false);
  });
  it("exposes actual workspace layout and available authoring status", async () => {
    seed("allowed-tools: Read, Bash");
    writeFileSync(join(root, "SKILL.md"), "---\nname: root\n---\nRoot");
    for (const path of [join(root, "direct", "skills", "alpha"), join(root, "plugins", "nested", "skills", "beta")]) {
      mkdirSync(path, {recursive: true}); writeFileSync(join(path, "SKILL.md"), "---\nname: fixture\n---\nBody");
    }
    const res = await fetch(`${url}/api/project-layout`, {headers});
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.suggestedLayout).toBe(2);
    expect(data.detectedLayouts.map((entry: any) => entry.layout).sort()).toEqual([1, 2, 3, 4]);
    expect(data.existingSkills).toEqual(expect.arrayContaining([{plugin: "direct", skill: "alpha"}, {plugin: "nested", skill: "beta"}]));
    const github = await fetch(`${url}/api/project/github-status`, {headers});
    expect(await github.json()).toMatchObject({status: "no-git", hasGit: false});
  });
  it("creates auxiliary files, evaluation cases and secret placeholders together", async () => {
    const evals = [{id: 1, name: "fixture", prompt: "Fixture", expected_output: "Fixture", assertions: []}];
    const response = await post("/api/skills/create", { files: {"scripts/helper.py": "print('fixture')", "references/usage.md": "# Usage"}, secrets: ["FIXTURE_API_KEY"], evals });
    expect(response.status).toBe(201);
    const result = await response.json() as {dir: string};
    expect(readFileSync(join(result.dir, "scripts/helper.py"), "utf8")).toBe("print('fixture')");
    expect(readFileSync(join(result.dir, "references/usage.md"), "utf8")).toBe("# Usage");
    expect(readFileSync(join(result.dir, ".env.example"), "utf8")).toContain("FIXTURE_API_KEY=");
    expect(JSON.parse(readFileSync(join(result.dir, "evals/evals.json"), "utf8"))).toEqual({skill_name: "created", evals});
  });
  it("refuses an escaping auxiliary file and preserves neighboring skills", async () => {
    seed("allowed-tools: Read, Bash"); const neighbor = readFileSync(file, "utf8");
    const response = await post("/api/skills/create", {files: {"../outside.txt": "escape"}});
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({code: "multi-file-write-failed"});
    expect(existsSync(join(root, "skills", "created"))).toBe(false);
    expect(existsSync(join(root, "skills", "outside.txt"))).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(neighbor);
  });
  it("keeps an update skill after a malformed auxiliary-file payload", async () => {
    seed("allowed-tools: Read, Bash");
    const response = await post("/api/skills/create", {name: "existing", mode: "update", files: {"bad.txt": 7}});
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({code: "multi-file-write-failed"});
    expect(readFileSync(file, "utf8")).toContain("custom:");
  });
  it("preserves reviewed work when a native draft cannot be merged", async () => {
    seed("allowed-tools: Read, Bash"); const before = readFileSync(file, "utf8");
    const res = await post("/api/skills/save-draft", {name: "existing", engine: "anthropic-skill-creator", nativeSkillMd: "---\nmetadata: invalid-scalar\n---\nBody", aiMeta: {prompt: "fixture", provider: "fixture", model: "fixture", reasoning: "fixture"}});
    expect(res.status).toBe(400); expect((await res.json() as any).error).toMatch(/block mapping/);
    expect(readFileSync(file, "utf8")).toBe(before);
  });
  it("finalizes a generated draft and moves it to the selected plugin with its evals", async () => {
    const aiMeta = {prompt: "fixture", provider: "fixture", model: "fixture", reasoning: "fixture"};
    const evals = [{id: 1, name: "fixture", prompt: "Fixture", expected_output: "Fixture", assertions: []}];
    const draft = await post("/api/skills/save-draft", {aiMeta, evals});
    expect(draft.status).toBe(201); const draftResult = await draft.json() as any;
    expect(draftResult.files).toContain("evals/evals.json");
    expect(existsSync(join(draftResult.dir, "draft.json"))).toBe(true);
    const result = await post("/api/skills/create", {layout: 2, plugin: "chosen", draftDir: draftResult.dir, aiMeta, evals});
    expect(result.status).toBe(201); const final = await result.json() as any;
    expect(final.plugin).toBe("chosen"); expect(existsSync(draftResult.dir)).toBe(false);
    expect(JSON.parse(readFileSync(join(final.dir, "evals/evals.json"), "utf8"))).toEqual({skill_name: "created", evals});
  });
});
