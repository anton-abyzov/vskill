import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, renameSync } from "node:fs";
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
  it.each(([1, 2, 3] as const).flatMap((layout) => ["directory", "file", "parent", "ancestor"].map((kind) => ({ layout, kind }))))("refuses $kind escapes for layout $layout before loading or updating", async ({ layout, kind }) => {
    const outside = mkdtempSync(join(tmpdir(), "outside-authoring-update-"));
    const parts = layout === 1 ? ["fixture-plugin", "skills", "linked"] : layout === 2 ? ["plugins", "fixture-plugin", "skills", "linked"] : ["skills", "linked"];
    const dir = join(root, ...parts);
    const prefix = kind === "ancestor" ? 1 : kind === "parent" ? parts.length - 1 : parts.length;
    const externalFile = join(outside, ...parts.slice(prefix), "SKILL.md");
    const original = "---\nname: linked\ndescription: External\nmetadata:\n  version: 1.0.0\n  engine: none\n---\nPRESERVE EXTERNAL";
    try {
      mkdirSync(join(externalFile, ".."), { recursive: true }); writeFileSync(externalFile, original);
      if (kind === "file") {
        mkdirSync(dir, { recursive: true }); symlinkSync(externalFile, join(dir, "SKILL.md"));
      } else {
        const link = join(root, ...parts.slice(0, prefix));
        // The existing layout-3 fixture owns root/skills. A distinct root for
        // this case avoids deleting or replacing any pre-existing fixture.
        const routeRoot = kind === "ancestor" && layout === 3 || kind === "parent" && layout === 3 ? join(root, "alternate") : root;
        mkdirSync(join(routeRoot, ...parts.slice(0, prefix), ".."), { recursive: true });
        symlinkSync(outside, routeRoot === root ? link : join(routeRoot, ...parts.slice(0, prefix)), "dir");
        if (routeRoot !== root) registerSkillCreateRoutes({ get: (p: string, h: any) => { handlers[p] = h; }, post: (p: string, h: any) => { handlers[p] = h; } } as any, routeRoot);
      }
      const params = { plugin: layout === 3 ? "project" : "fixture-plugin", skill: "linked" };
      const load = await call("/api/skills/:plugin/:skill/authoring", undefined, params);
      expect(load.status).toBe(403);
      const update = await call("/api/skills/create", { name: "linked", plugin: layout === 3 ? "" : "fixture-plugin", layout, mode: "update", description: "Changed", body: "Changed body", engine: "none", version: "1.0.1" });
      expect(update.status).toBe(403);
      expect(readFileSync(externalFile, "utf8")).toBe(original);
      expect(readFileSync(join(root, "skills/existing/SKILL.md"), "utf8")).toContain("Original");
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });
  it.each([1, 2, 3] as const)("loads and updates layout %s while retaining neighboring files", async (layout) => {
    const dir = layout === 1 ? join(root, "fixture-plugin/skills/valid") : layout === 2 ? join(root, "plugins/fixture-plugin/skills/valid") : join(root, "skills/valid");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: valid\ndescription: Before\nmetadata:\n  version: 1.0.0\n  engine: none\n---\nBefore");
    writeFileSync(join(dir, "notes.txt"), "PRESERVE NEIGHBOR");
    const loaded = await call("/api/skills/:plugin/:skill/authoring", undefined, { plugin: layout === 3 ? basename(root) : "fixture-plugin", skill: "valid" });
    expect(loaded.status).toBe(200); expect(loaded.result.layout).toBe(layout);
    const saved = await call("/api/skills/create", { ...loaded.result, mode: "update", description: "After", body: "Reviewed", version: "1.0.1" });
    expect(saved.status).toBe(200); expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toContain("Reviewed");
    expect(readFileSync(join(dir, "notes.txt"), "utf8")).toBe("PRESERVE NEIGHBOR");
  });
  it("rechecks the boundary when a loaded skill is replaced by an external alias before save", async () => {
    const loaded = await call("/api/skills/:plugin/:skill/authoring"); expect(loaded.status).toBe(200);
    const outside = mkdtempSync(join(tmpdir(), "moved-authoring-update-"));
    try {
      writeFileSync(join(outside, "SKILL.md"), "PRESERVE EXTERNAL");
      renameSync(join(root, "skills/existing"), join(root, "skills/retained-original"));
      symlinkSync(outside, join(root, "skills/existing"), "dir");
      const saved = await call("/api/skills/create", { ...loaded.result, engine: "none", mode: "update", body: "Changed" });
      expect(saved.status).toBe(403);
      expect(readFileSync(join(outside, "SKILL.md"), "utf8")).toBe("PRESERVE EXTERNAL");
      expect(readFileSync(join(root, "skills/retained-original/SKILL.md"), "utf8")).toContain("Original");
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });
  it.each(["directory", "file"])("allows a %s alias whose target remains inside the authoring workspace", async (kind) => {
    const target = join(root, "internal"); mkdirSync(target);
    writeFileSync(join(target, "SKILL.md"), "---\nname: linked\ndescription: Before\nmetadata:\n  version: 1.0.0\n  engine: none\n---\nBefore");
    const dir = join(root, "skills/linked");
    if (kind === "directory") symlinkSync(target, dir, "dir");
    else { mkdirSync(dir); symlinkSync(join(target, "SKILL.md"), join(dir, "SKILL.md")); }
    const loaded = await call("/api/skills/:plugin/:skill/authoring", undefined, { plugin: basename(root), skill: "linked" });
    expect(loaded.status).toBe(200);
    const saved = await call("/api/skills/create", { ...loaded.result, mode: "update", body: "Reviewed" });
    expect(saved.status).toBe(200); expect(readFileSync(join(target, "SKILL.md"), "utf8")).toContain("Reviewed");
  });
});
