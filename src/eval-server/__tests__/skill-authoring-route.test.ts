import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";

vi.mock("../../utils/skill-creator-detection.js", () => ({ isSkillCreatorInstalled: () => true, findSkillCreatorPath: () => null }));
vi.mock("../platform-proxy.js", () => ({ submitSkillUpdateEvent: vi.fn(async () => ({ success: true })) }));
vi.mock("../../eval/llm.js", () => ({ createLlmClient: vi.fn(() => { throw new Error("An update must not call a model"); }) }));
import { registerSkillCreateRoutes } from "../skill-create-routes.js";

describe("existing-skill authoring", () => {
  let root: string;
  const handlers: Record<string, any> = {};
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "skill-authoring-"));
    mkdirSync(join(root, "skills", "existing"), { recursive: true });
    writeFileSync(join(root, "skills", "existing", "SKILL.md"), '---\nname: existing\ndescription: Existing\ncontext: fork\nmetadata:\n  version: "2.3.4-beta.1"\n  engine: anthropic-skill-creator\n  custom: preserved\n---\n\nOriginal\n');
    registerSkillCreateRoutes({ get: (path: string, handler: any) => { handlers[path] = handler; }, post: (path: string, handler: any) => { handlers[path] = handler; } } as any, root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  async function call(route: string, body?: unknown, params = { plugin: basename(root), skill: "existing" }) {
    const req = new EventEmitter() as any;
    req.headers = {};
    const res: any = { status: 0, result: null, writeHead(code: number) { this.status = code; }, end(text: string) { this.result = JSON.parse(text); } };
    const pending = handlers[route](req, res, params);
    if (body) { req.emit("data", Buffer.from(JSON.stringify(body))); req.emit("end"); }
    await pending;
    return res;
  }
  it("loads the current prerelease version, engine and native document", async () => {
    const res = await call("/api/skills/:plugin/:skill/authoring");
    expect(res.status).toBe(200);
    expect(res.result).toMatchObject({ layout: 3, plugin: "", version: "2.3.4-beta.1", engine: "anthropic-skill-creator", nativeSkillMd: expect.stringContaining("context: fork") });
  });
  it("preserves omitted update engine and rich metadata without another model call", async () => {
    const res = await call("/api/skills/create", { name: "existing", plugin: "", layout: 3, mode: "update", version: "2.3.4", description: "Updated", body: "Updated body\n" });
    expect(res.status).toBe(200);
    expect(res.result.engine).toBe("anthropic-skill-creator");
    const saved = readFileSync(join(root, "skills", "existing", "SKILL.md"), "utf8");
    expect(saved).toContain("context: fork");
    expect(saved).toContain("custom: preserved");
    expect(saved).toContain('version: "2.3.4"');
    expect(saved).toContain("Updated body");
  });
  it("defaults older metadata without an engine to vskill", async () => {
    writeFileSync(join(root, "skills", "existing", "SKILL.md"), "---\nname: existing\ndescription: Existing\nmetadata:\n  version: 1.2.3\n---\nBody");
    const res = await call("/api/skills/:plugin/:skill/authoring");
    expect(res.result.engine).toBe("vskill");
    expect(res.result.version).toBe("1.2.3");
  });
  it("keeps engine provenance in CRLF and four-space metadata on load and update", async () => {
    writeFileSync(join(root, "skills", "existing", "SKILL.md"), "---\r\nname: existing\r\ndescription: Existing\r\nmetadata:\r\n    version: 3.0.0\r\n    engine: none\r\n---\r\nBody");
    const loaded = await call("/api/skills/:plugin/:skill/authoring");
    expect(loaded.result).toMatchObject({ description: "Existing", version: "3.0.0", engine: "none" });
    const saved = await call("/api/skills/create", { name: "existing", plugin: "", layout: 3, mode: "update", version: "3.0.1", description: "Updated", body: "Body" });
    expect(saved.status).toBe(200);
    expect(saved.result.engine).toBe("none");
    expect(readFileSync(join(root, "skills", "existing", "SKILL.md"), "utf8")).toContain("    engine: none");
  });
  it("rejects traversal and workspace symlinks pointing to external skills", async () => {
    const outside = mkdtempSync(join(tmpdir(), "external-authoring-"));
    try {
      writeFileSync(join(outside, "SKILL.md"), "---\nname: external\ndescription: external\n---\nPrivate body");
      symlinkSync(outside, join(root, "skills", "external"), "dir");
      const linked = await call("/api/skills/:plugin/:skill/authoring", undefined, { plugin: basename(root), skill: "external" });
      expect(linked.status).toBe(403);
      expect(linked.result.nativeSkillMd).toBeUndefined();
      const traversal = await call("/api/skills/:plugin/:skill/authoring", undefined, { plugin: "../elsewhere", skill: "existing" });
      expect(traversal.status).toBe(400);
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });
});
