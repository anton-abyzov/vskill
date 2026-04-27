// ---------------------------------------------------------------------------
// 0698 — authoring-routes tests: file-scaffolding for Create Skill modal.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import {
  makeCreateSkillHandler,
  makeSkillExistsHandler,
  makeConvertToPluginHandler,
} from "../authoring-routes.js";

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
  // 0793 follow-up F-004: handler now realpath-resolves both root and anchor
  // before the workspace-root invariant check, so tests must use the canonical
  // root path (on macOS, /var/folders/... → /private/var/folders/...).
  root = realpathSync(mkdtempSync(join(tmpdir(), "vskill-authoring-")));
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
    // 0793 T-001 fix: author is omitted (was previously stubbed as
    // `{ name: "" }`, but `claude plugin validate` rejects empty author.name).
    // Authors fill it in manually when ready to publish.
    expect(manifest.author).toBeUndefined();
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

// ---------------------------------------------------------------------------
// 0793 T-004 — POST /api/authoring/convert-to-plugin
// ---------------------------------------------------------------------------

describe("POST /api/authoring/convert-to-plugin", () => {
  /**
   * Seed a candidate plugin folder with one or more skills under <rootDir>/<dir>/skills/.
   * Returns the absolute path of the first skill (for use as anchorSkillDir).
   */
  function seedCandidate(
    rootDir: string,
    dir: string,
    skills: string[],
  ): string {
    let firstSkillDir: string | null = null;
    for (const s of skills) {
      const skillDir = join(rootDir, dir, "skills", s);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), "---\ndescription: x\n---\n# x\n");
      firstSkillDir ??= skillDir;
    }
    return firstSkillDir!;
  }

  /**
   * Top-level "Root" layout: <rootDir>/skills/<skill>/SKILL.md (no nesting dir).
   * Plugin root = workspace root itself. Returns absolute path to first skill.
   */
  function seedRootLayout(rootDir: string, skills: string[]): string {
    let firstSkillDir: string | null = null;
    for (const s of skills) {
      const skillDir = join(rootDir, "skills", s);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), "---\ndescription: x\n---\n# x\n");
      firstSkillDir ??= skillDir;
    }
    return firstSkillDir!;
  }

  it("writes plugin.json + returns 200 with validation:'skipped' when claude not on PATH (nested layout)", async () => {
    const anchor = seedCandidate(root, "hi-anton", ["hi-there", "anton-plugin-skill"]);
    const originalPath = process.env.PATH;
    process.env.PATH = "/dev/null-vskill-test";
    try {
      const h = makeConvertToPluginHandler(root);
      const req = new FakeReq({
        anchorSkillDir: anchor,
        pluginName: "hi-anton",
        description: "Anton's first plugin",
      });
      const res = new FakeRes();
      await h(req as any, res as any);
      expect(res.statusCode).toBe(200);
      const body = res.json as {
        ok: true;
        pluginDir: string;
        manifestPath: string;
        validation: "passed" | "skipped";
      };
      expect(body.ok).toBe(true);
      expect(body.validation).toBe("skipped");
      expect(body.pluginDir).toBe(join(root, "hi-anton"));
      expect(body.manifestPath).toBe(join(root, "hi-anton", ".claude-plugin", "plugin.json"));
      expect(existsSync(body.manifestPath)).toBe(true);
      // F-002: declare every field optional so the type matches the actual
      // scaffold shape (no `author`, no `version` — Claude Code derives both
      // from package.json / git SHA at install time).
      const manifest = JSON.parse(readFileSync(body.manifestPath, "utf8")) as {
        name?: string;
        description?: string;
        author?: { name: string };
      };
      expect(manifest.name).toBe("hi-anton");
      expect(manifest.description).toBe("Anton's first plugin");
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("converts top-level Root layout (<root>/skills/<s>/) by writing manifest at root", async () => {
    // This is the TestLab/hi-anton case from the bug report: workspace root
    // itself contains skills/ with no manifest. Conversion should write
    // plugin.json directly into <root>/.claude-plugin/.
    const anchor = seedRootLayout(root, ["hi-there", "anton-plugin-skill"]);
    const originalPath = process.env.PATH;
    process.env.PATH = "/dev/null-vskill-test";
    try {
      const h = makeConvertToPluginHandler(root);
      const req = new FakeReq({
        anchorSkillDir: anchor,
        pluginName: "my-workspace-plugin",
        description: "Top-level workspace becomes a plugin",
      });
      const res = new FakeRes();
      await h(req as any, res as any);
      expect(res.statusCode).toBe(200);
      const body = res.json as { pluginDir: string; manifestPath: string };
      expect(body.pluginDir).toBe(root);
      expect(body.manifestPath).toBe(join(root, ".claude-plugin", "plugin.json"));
      expect(existsSync(body.manifestPath)).toBe(true);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("rejects anchorSkillDir outside the workspace root (400)", async () => {
    const h = makeConvertToPluginHandler(root);
    const req = new FakeReq({
      anchorSkillDir: "/tmp/somewhere-else/skills/x",
      pluginName: "ok-name",
      description: "y",
    });
    const res = new FakeRes();
    await h(req as any, res as any);
    expect(res.statusCode).toBe(400);
    expect((res.json as { code: string }).code).toBe("anchor-outside-root");
  });

  it("rejects when the manifest already exists (409)", async () => {
    const anchor = seedCandidate(root, "hi-anton", ["greet"]);
    mkdirSync(join(root, "hi-anton", ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(root, "hi-anton", ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "already-here" }),
    );
    const h = makeConvertToPluginHandler(root);
    const req = new FakeReq({
      anchorSkillDir: anchor,
      pluginName: "hi-anton",
      description: "x",
    });
    const res = new FakeRes();
    await h(req as any, res as any);
    expect(res.statusCode).toBe(409);
    expect((res.json as { code: string }).code).toBe("plugin-already-exists");
  });

  it("rejects pluginDir with no skills (400)", async () => {
    // Anchor at <root>/foo/skills/bar where the dir exists but has no SKILL.md
    mkdirSync(join(root, "foo", "skills", "bar"), { recursive: true });
    const h = makeConvertToPluginHandler(root);
    const req = new FakeReq({
      anchorSkillDir: join(root, "foo", "skills", "bar"),
      pluginName: "foo",
      description: "x",
    });
    const res = new FakeRes();
    await h(req as any, res as any);
    expect(res.statusCode).toBe(400);
    expect((res.json as { code: string }).code).toBe("no-skills-to-convert");
  });

  // F-003 source-side fix (hasAnyAuthoredSkill rethrows non-ENOENT readdir
  // errors so the convert handler returns 500 "skills-scan-failed" instead
  // of a misleading 400 "no-skills-to-convert"): not unit-tested here
  // because reliably triggering a non-ENOENT readdir failure is platform-
  // dependent (chmod games are flaky on macOS+vitest, mocking node:fs
  // collides with the rest of this file's filesystem-driven tests). The fix
  // is captured in the inline comment of `hasAnyAuthoredSkill` + the
  // try/catch around its call site. The existing "rejects pluginDir with
  // no skills (400)" test above continues to guard the ENOENT/empty-dir
  // path, so this addition strictly widens the error contract.

  it("rejects anchorSkillDir whose parent is not 'skills/' (400 invalid-anchor-shape)", async () => {
    // 0793 follow-up F-002: a misbehaving client sending an anchor that does
    // not live under a `skills/` directory must be rejected fast — otherwise
    // dirname(dirname(anchor)) silently resolves to a wrong pluginDir.
    mkdirSync(join(root, "foo", "bar", "baz"), { recursive: true });
    writeFileSync(
      join(root, "foo", "bar", "baz", "SKILL.md"),
      "---\ndescription: x\n---\n# x\n",
    );
    const h = makeConvertToPluginHandler(root);
    const req = new FakeReq({
      anchorSkillDir: join(root, "foo", "bar", "baz"),
      pluginName: "ok-name",
      description: "x",
    });
    const res = new FakeRes();
    await h(req as any, res as any);
    expect(res.statusCode).toBe(400);
    expect((res.json as { code: string }).code).toBe("invalid-anchor-shape");
  });

  it("returns 422 + stderr + unlinks manifest when claude plugin validate rejects (F-003)", async () => {
    // Force the validator to fail by injecting `false` (always exit 1) as the
    // claude binary. Same fakebin trick as plugin.test.ts:106 — symlink
    // `claude` → `/usr/bin/false` and point PATH at that directory only.
    const anchor = seedCandidate(root, "rolled-back", ["greet"]);
    const fakeBinDir = mkdtempSync(join(tmpdir(), "vskill-fakebin-"));
    symlinkSync("/usr/bin/false", join(fakeBinDir, "claude"));
    const originalPath = process.env.PATH;
    process.env.PATH = fakeBinDir;
    try {
      const h = makeConvertToPluginHandler(root);
      const req = new FakeReq({
        anchorSkillDir: anchor,
        pluginName: "rolled-back",
        description: "x",
      });
      const res = new FakeRes();
      await h(req as any, res as any);
      expect(res.statusCode).toBe(422);
      const body = res.json as { code: string; stderr?: string };
      expect(body.code).toBe("validation-failed");
      // stderr is spread into the error envelope by sendError(extra) — the
      // local sendError helper passes `{ stderr }` via the 5th arg, which
      // gets `...extra` into the JSON body alongside `code` and `error`.
      expect(typeof body.stderr).toBe("string");
      // Manifest must be unlinked after validator failure (rollback).
      const manifestPath = join(root, "rolled-back", ".claude-plugin", "plugin.json");
      expect(existsSync(manifestPath)).toBe(false);
    } finally {
      process.env.PATH = originalPath;
      rmSync(fakeBinDir, { recursive: true, force: true });
    }
  });

  it("rejects invalid kebab-case pluginName (400)", async () => {
    const anchor = seedCandidate(root, "ok-dir", ["greet"]);
    const h = makeConvertToPluginHandler(root);
    const req = new FakeReq({
      anchorSkillDir: anchor,
      pluginName: "BadName",
      description: "x",
    });
    const res = new FakeRes();
    await h(req as any, res as any);
    expect(res.statusCode).toBe(400);
    expect((res.json as { code: string }).code).toBe("invalid-plugin-name");
  });

  it("rejects anchorSkillDir that does not exist (400)", async () => {
    const h = makeConvertToPluginHandler(root);
    const req = new FakeReq({
      anchorSkillDir: join(root, "does-not-exist", "skills", "x"),
      pluginName: "ghost",
      description: "x",
    });
    const res = new FakeRes();
    await h(req as any, res as any);
    expect(res.statusCode).toBe(400);
    expect((res.json as { code: string }).code).toBe("anchor-not-found");
  });

  it("does NOT add hardcoded version to plugin.json (matches existing new-plugin scaffold)", async () => {
    const anchor = seedCandidate(root, "v-test", ["s"]);
    const originalPath = process.env.PATH;
    process.env.PATH = "/dev/null-vskill-test";
    try {
      const h = makeConvertToPluginHandler(root);
      const req = new FakeReq({
        anchorSkillDir: anchor,
        pluginName: "v-test",
        description: "y",
      });
      const res = new FakeRes();
      await h(req as any, res as any);
      const body = res.json as { manifestPath: string };
      const manifest = JSON.parse(readFileSync(body.manifestPath, "utf8")) as {
        version?: string;
        author?: { name: string };
      };
      // Same contract as create-skill new-plugin: no hardcoded version, no
      // author stub (would fail `claude plugin validate` per 0793 T-001 fix).
      expect(manifest.version).toBeUndefined();
      expect(manifest.author).toBeUndefined();
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
