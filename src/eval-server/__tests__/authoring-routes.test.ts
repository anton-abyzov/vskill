// ---------------------------------------------------------------------------
// 0698 — authoring-routes tests: file-scaffolding for Create Skill modal.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { makeCreateSkillHandler, makeSkillExistsHandler } from "../authoring-routes.js";

class FakeReq extends EventEmitter {
  headers: Record<string, string> = {};
  method = "POST";
  url = "/api/authoring/create-skill";
  constructor(body: unknown) {
    super();
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    process.nextTick(() => {
      this.emit("data", Buffer.from(raw));
      this.emit("end");
    });
  }
}

class FakeRes {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = "";
  writeHead(status: number, headers?: Record<string, string>) {
    this.statusCode = status;
    if (headers) Object.assign(this.headers, headers);
  }
  setHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  end(data?: string) {
    if (data !== undefined) this.body += data;
  }
  get json(): unknown {
    return JSON.parse(this.body);
  }
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vskill-authoring-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("POST /api/authoring/create-skill — standalone", () => {
  it("creates <root>/skills/<name>/SKILL.md with frontmatter", async () => {
    const h = makeCreateSkillHandler(root);
    const req = new FakeReq({
      mode: "standalone",
      skillName: "my-new-skill",
      description: "Does a thing",
    });
    const res = new FakeRes();
    await h(req as any, res as any);
    expect(res.statusCode).toBe(201);
    const body = res.json as { skillMdPath: string; mode: string };
    expect(body.mode).toBe("standalone");
    expect(existsSync(body.skillMdPath)).toBe(true);
    const contents = readFileSync(body.skillMdPath, "utf8");
    expect(contents).toContain("description: Does a thing");
    expect(contents).toContain("# my-new-skill");
  });

  it("rejects invalid kebab-case skill names", async () => {
    const h = makeCreateSkillHandler(root);
    const req = new FakeReq({ mode: "standalone", skillName: "BAD NAME" });
    const res = new FakeRes();
    await h(req as any, res as any);
    expect(res.statusCode).toBe(400);
    expect((res.json as { code: string }).code).toBe("invalid-skill-name");
  });

  it("rejects when the skill directory already exists (409)", async () => {
    mkdirSync(join(root, "skills", "dupe"), { recursive: true });
    writeFileSync(join(root, "skills", "dupe", "SKILL.md"), "# existing");

    const h = makeCreateSkillHandler(root);
    const req = new FakeReq({ mode: "standalone", skillName: "dupe" });
    const res = new FakeRes();
    await h(req as any, res as any);
    expect(res.statusCode).toBe(409);
    expect((res.json as { code: string }).code).toBe("skill-exists");
  });
});

describe("POST /api/authoring/create-skill — new-plugin", () => {
  it("scaffolds <plugin>/.claude-plugin/plugin.json + skills/<name>/SKILL.md", async () => {
    const h = makeCreateSkillHandler(root);
    const req = new FakeReq({
      mode: "new-plugin",
      pluginName: "my-first-plugin",
      skillName: "greeter",
      description: "Greets the user",
    });
    const res = new FakeRes();
    await h(req as any, res as any);
    expect(res.statusCode).toBe(201);
    const body = res.json as {
      manifestPath: string;
      skillMdPath: string;
      pluginName: string;
    };
    expect(body.pluginName).toBe("my-first-plugin");
    expect(existsSync(body.manifestPath)).toBe(true);
    expect(existsSync(body.skillMdPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(body.manifestPath, "utf8")) as {
      name: string;
      version?: string;
      author?: { name: string };
    };
    expect(manifest.name).toBe("my-first-plugin");
    // 0703 follow-up: version is intentionally omitted so Claude Code falls
    // back to git SHA (per plugins-reference docs — avoids "forgot to bump"
    // footgun). Confirm we do NOT emit a hardcoded version.
    expect(manifest.version).toBeUndefined();
    // 0703 follow-up: author is an object-shaped stub per schema.
    expect(manifest.author).toEqual({ name: "" });
  });

  it("rejects if the plugin directory already exists (409)", async () => {
    mkdirSync(join(root, "existing-plugin"), { recursive: true });
    const h = makeCreateSkillHandler(root);
    const req = new FakeReq({
      mode: "new-plugin",
      pluginName: "existing-plugin",
      skillName: "foo",
    });
    const res = new FakeRes();
    await h(req as any, res as any);
    expect(res.statusCode).toBe(409);
    expect((res.json as { code: string }).code).toBe("plugin-exists");
  });
});

describe("POST /api/authoring/create-skill — existing-plugin", () => {
  it("appends a skill to an existing plugin source", async () => {
    // Scaffold an existing plugin on disk
    mkdirSync(join(root, "my-plugin", ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(root, "my-plugin", ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "my-plugin", version: "0.0.1" }),
    );

    const h = makeCreateSkillHandler(root);
    const req = new FakeReq({
      mode: "existing-plugin",
      pluginName: "my-plugin",
      skillName: "second-skill",
    });
    const res = new FakeRes();
    await h(req as any, res as any);
    expect(res.statusCode).toBe(201);
    const body = res.json as { skillMdPath: string };
    expect(body.skillMdPath).toContain("my-plugin/skills/second-skill/SKILL.md");
    expect(existsSync(body.skillMdPath)).toBe(true);
  });

  it("rejects when the plugin manifest is missing (404)", async () => {
    const h = makeCreateSkillHandler(root);
    const req = new FakeReq({
      mode: "existing-plugin",
      pluginName: "ghost-plugin",
      skillName: "foo",
    });
    const res = new FakeRes();
    await h(req as any, res as any);
    expect(res.statusCode).toBe(404);
    expect((res.json as { code: string }).code).toBe("plugin-not-found");
  });
});

describe("POST /api/authoring/create-skill — validation", () => {
  it("rejects unknown mode", async () => {
    const h = makeCreateSkillHandler(root);
    const req = new FakeReq({ mode: "wrong", skillName: "foo" });
    const res = new FakeRes();
    await h(req as any, res as any);
    expect(res.statusCode).toBe(400);
    expect((res.json as { code: string }).code).toBe("invalid-mode");
  });

  it("requires pluginName for plugin modes", async () => {
    const h = makeCreateSkillHandler(root);
    const req = new FakeReq({ mode: "new-plugin", skillName: "foo" });
    const res = new FakeRes();
    await h(req as any, res as any);
    expect(res.statusCode).toBe(400);
    expect((res.json as { code: string }).code).toBe("invalid-plugin-name");
  });
});

// ---------------------------------------------------------------------------
// 0703 hotfix — GET /api/authoring/skill-exists (pre-flight duplicate check
// for the "Generate with AI" branch of CreateSkillModal)
// ---------------------------------------------------------------------------

class FakeGetReq {
  headers: Record<string, string> = {};
  method = "GET";
  url: string;
  constructor(path: string) {
    this.url = path;
  }
}

describe("0703 — GET /api/authoring/skill-exists", () => {
  it("returns exists:false for a fresh standalone skill name", async () => {
    const h = makeSkillExistsHandler(root);
    const req = new FakeGetReq("/api/authoring/skill-exists?mode=standalone&skillName=anton-greet");
    const res = new FakeRes();
    await h(req as any, res as any);
    expect(res.statusCode).toBe(200);
    const body = res.json as { exists: boolean; path: string };
    expect(body.exists).toBe(false);
    expect(body.path).toContain("skills/anton-greet");
  });

  it("returns exists:true when the standalone skill dir is already on disk", async () => {
    mkdirSync(join(root, "skills", "anton-greet"), { recursive: true });
    writeFileSync(join(root, "skills", "anton-greet", "SKILL.md"), "# existing");

    const h = makeSkillExistsHandler(root);
    const req = new FakeGetReq("/api/authoring/skill-exists?mode=standalone&skillName=anton-greet");
    const res = new FakeRes();
    await h(req as any, res as any);
    expect(res.statusCode).toBe(200);
    const body = res.json as { exists: boolean; path: string };
    expect(body.exists).toBe(true);
    expect(body.path).toContain("skills/anton-greet");
  });

  it("returns exists:true for existing-plugin mode when the skill dir is there", async () => {
    mkdirSync(join(root, "my-plugin", ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(root, "my-plugin", ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "my-plugin", version: "0.0.1" }),
    );
    mkdirSync(join(root, "my-plugin", "skills", "greeter"), { recursive: true });

    const h = makeSkillExistsHandler(root);
    const req = new FakeGetReq(
      "/api/authoring/skill-exists?mode=existing-plugin&pluginName=my-plugin&skillName=greeter",
    );
    const res = new FakeRes();
    await h(req as any, res as any);
    expect(res.statusCode).toBe(200);
    expect((res.json as { exists: boolean }).exists).toBe(true);
  });

  it("returns 404 plugin-not-found when existing-plugin mode targets a missing plugin", async () => {
    const h = makeSkillExistsHandler(root);
    const req = new FakeGetReq(
      "/api/authoring/skill-exists?mode=existing-plugin&pluginName=ghost&skillName=foo",
    );
    const res = new FakeRes();
    await h(req as any, res as any);
    expect(res.statusCode).toBe(404);
    expect((res.json as { code: string }).code).toBe("plugin-not-found");
  });

  it("returns 400 invalid-skill-name for non-kebab inputs", async () => {
    const h = makeSkillExistsHandler(root);
    const req = new FakeGetReq("/api/authoring/skill-exists?mode=standalone&skillName=BAD%20NAME");
    const res = new FakeRes();
    await h(req as any, res as any);
    expect(res.statusCode).toBe(400);
    expect((res.json as { code: string }).code).toBe("invalid-skill-name");
  });

  it("returns 400 invalid-mode for unknown mode", async () => {
    const h = makeSkillExistsHandler(root);
    const req = new FakeGetReq("/api/authoring/skill-exists?mode=bogus&skillName=foo");
    const res = new FakeRes();
    await h(req as any, res as any);
    expect(res.statusCode).toBe(400);
    expect((res.json as { code: string }).code).toBe("invalid-mode");
  });
});
