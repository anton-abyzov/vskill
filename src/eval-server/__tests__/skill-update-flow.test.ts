// ---------------------------------------------------------------------------
// 0726 — Skill update flow: create-update-mode + apply-improvement version bump
//
// These tests drive the fix for two studio bugs:
//   1. POST /api/skills/create returns 409 when the skill exists. The studio's
//      "save" path needs an explicit update mode that overwrites + bumps version.
//   2. POST /api/skills/:plugin/:skill/apply-improvement writes the file but
//      doesn't bump the SKILL.md frontmatter version, so subsequent publishing
//      can never produce a new version.
//
// The third concern (submitting to the platform's publish queue) is covered by
// a `submitSkillUpdateEvent` helper exercised in platform-proxy.test.ts.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";

// Mock LLM + benchmark dependencies — improve-routes pulls these in but we
// don't exercise the LLM path here; we only hit the plain-file apply-improvement
// handler which doesn't call the LLM.
vi.mock("../../eval/llm.js", () => ({
  createLlmClient: vi.fn(),
}));
vi.mock("../../eval/benchmark-history.js", () => ({
  writeHistoryEntry: vi.fn(async () => undefined),
}));
vi.mock("../../eval/benchmark.js", () => ({
  readBenchmark: vi.fn(),
}));
vi.mock("../../eval/schema.js", () => ({
  loadAndValidateEvals: vi.fn(() => ({ skill_name: "test-skill", evals: [] })),
}));

// Avoid the platform publish helper actually firing during these tests.
const submitMock = vi.hoisted(() => vi.fn(async () => ({
  submitted: false as const,
  reason: "no_internal_key" as const,
})));
vi.mock("../platform-proxy.js", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../platform-proxy.js");
  return {
    ...actual,
    submitSkillUpdateEvent: submitMock,
  };
});

const { registerSkillCreateRoutes } = await import("../skill-create-routes.js");
const { registerImproveRoutes } = await import("../improve-routes.js");

// ---------------------------------------------------------------------------
// Test harness — captures router handlers without booting the HTTP server
// ---------------------------------------------------------------------------

interface Captured {
  get: Record<string, any>;
  post: Record<string, any>;
  put: Record<string, any>;
  delete: Record<string, any>;
}

function makeRouter(): { handlers: Captured; router: any } {
  const handlers: Captured = { get: {}, post: {}, put: {}, delete: {} };
  const router: any = {
    get: (p: string, h: any) => { handlers.get[p] = h; },
    post: (p: string, h: any) => { handlers.post[p] = h; },
    put: (p: string, h: any) => { handlers.put[p] = h; },
    delete: (p: string, h: any) => { handlers.delete[p] = h; },
  };
  return { handlers, router };
}

function fakeReq(body: unknown): any {
  const bodyStr = JSON.stringify(body);
  const stream: any = {
    method: "POST",
    url: "/test",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(bodyStr)),
    },
    on: (event: string, callback: (chunk?: Buffer) => void) => {
      if (event === "data") setImmediate(() => callback(Buffer.from(bodyStr)));
      else if (event === "end") setImmediate(() => callback());
      return stream;
    },
  };
  return stream;
}

function fakeRes(): any {
  const captured = { body: "", status: 0, headers: {} as Record<string, string> };
  const res: any = {
    writeHead(status: number, headers?: Record<string, string>) {
      captured.status = status;
      if (headers) captured.headers = { ...captured.headers, ...headers };
    },
    write(chunk: string | Buffer) {
      captured.body += typeof chunk === "string" ? chunk : chunk.toString();
    },
    end(chunk?: string | Buffer) {
      if (chunk) captured.body += typeof chunk === "string" ? chunk : chunk.toString();
    },
    headersSent: false,
    on: vi.fn(),
    setHeader: vi.fn(),
    get capturedBody() { return captured.body; },
    get capturedStatus() { return captured.status; },
  };
  return res;
}

async function runHandler(handler: any, body: unknown, params: Record<string, string> = {}) {
  const req = fakeReq(body);
  const res = fakeRes();
  await handler(req, res, params);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  return res;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("0726 — POST /api/skills/create update mode", () => {
  let root: string;

  beforeEach(() => {
    submitMock.mockClear();
    root = mkdtempSync(join(tmpdir(), "vskill-0726-create-"));
    // Layout 3 (single-skill repo) so the created skill goes to <root>/<name>/
    // Layout 1 (multi-plugin repo) requires a `plugins/<plugin>/skills/<name>` tree.
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* */ }
  });

  it("returns 409 when skill exists and mode is omitted (preserves backward compat)", async () => {
    const { handlers, router } = makeRouter();
    registerSkillCreateRoutes(router, root);
    const handler = handlers.post["/api/skills/create"];

    // Pre-create the skill at the layout-2 path the handler will resolve to
    const skillDir = join(root, "plugins", "demo-plugin", "skills", "demo-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      '---\nversion: "1.0.0"\ndescription: "old"\n---\n# old\n',
      "utf-8",
    );

    const res = await runHandler(handler, {
      name: "demo-skill",
      plugin: "demo-plugin",
      layout: 2,
      description: "new description",
      body: "# new body",
    });

    expect(res.capturedStatus).toBe(409);
  });

  it("returns 200 + bumps version when mode='update' and skill exists", async () => {
    const { handlers, router } = makeRouter();
    registerSkillCreateRoutes(router, root);
    const handler = handlers.post["/api/skills/create"];

    // Pre-create the skill at the layout-2 path (computeSkillDir uses plugins/<plugin>/skills/<name>)
    const skillDir = join(root, "plugins", "demo-plugin", "skills", "demo-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      '---\nversion: "1.0.0"\ndescription: "old"\n---\n# old\n',
      "utf-8",
    );

    const res = await runHandler(handler, {
      name: "demo-skill",
      plugin: "demo-plugin",
      layout: 2,
      description: "new description",
      body: "# new body",
      mode: "update",
    });

    expect(res.capturedStatus).toBe(200);
    const json = JSON.parse(res.capturedBody);
    expect(json.ok).toBe(true);
    expect(json.version).toBe("1.0.1"); // patch bump
    expect(json.updated).toBe(true);

    // File on disk should have the bumped version + new content
    const written = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
    expect(written).toMatch(/version:\s*"?1\.0\.1"?/);
    expect(written).toContain("new description");
    expect(written).toContain("# new body");
  });

  it("creates new skill (201) with version 1.0.0 when no skill exists", async () => {
    const { handlers, router } = makeRouter();
    registerSkillCreateRoutes(router, root);
    const handler = handlers.post["/api/skills/create"];

    const res = await runHandler(handler, {
      name: "fresh-skill",
      plugin: "demo-plugin",
      layout: 2,
      description: "fresh",
      body: "# fresh",
    });

    expect(res.capturedStatus).toBe(201);
    const skillDir = join(root, "plugins", "demo-plugin", "skills", "fresh-skill");
    const written = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
    expect(written).toMatch(/version:\s*"?1\.0\.0"?/);
  });
});

describe("0726 — POST /api/skills/:plugin/:skill/apply-improvement bumps version", () => {
  let root: string;

  beforeEach(() => {
    submitMock.mockClear();
    root = mkdtempSync(join(tmpdir(), "vskill-0726-apply-"));
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* */ }
  });

  it("bumps patch version in frontmatter when applying improved content", async () => {
    const { handlers, router } = makeRouter();
    registerImproveRoutes(router, root);
    const handler = handlers.post["/api/skills/:plugin/:skill/apply-improvement"];
    expect(handler).toBeDefined();

    // Set up an existing skill
    const skillDir = join(root, "plugins", "demo-plugin", "skills", "demo-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      '---\nversion: "2.3.7"\ndescription: "v1"\n---\n# v1\n',
      "utf-8",
    );

    // Improved content WITHOUT a version field — handler must inject one
    const improvedNoVersion = '---\ndescription: "v2"\n---\n# v2 improved\n';

    const res = await runHandler(
      handler,
      { content: improvedNoVersion },
      { plugin: "demo-plugin", skill: "demo-skill" },
    );

    expect(res.capturedStatus).toBe(200);
    const json = JSON.parse(res.capturedBody);
    expect(json.ok).toBe(true);
    expect(json.version).toBe("2.3.8");
    expect(json.previousVersion).toBe("2.3.7");

    const written = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
    expect(written).toMatch(/version:\s*"?2\.3\.8"?/);
    expect(written).toContain("v2 improved");
  });

  it("preserves user-provided version when content already has a higher version", async () => {
    const { handlers, router } = makeRouter();
    registerImproveRoutes(router, root);
    const handler = handlers.post["/api/skills/:plugin/:skill/apply-improvement"];

    const skillDir = join(root, "plugins", "demo-plugin", "skills", "demo-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      '---\nversion: "1.0.0"\ndescription: "v1"\n---\n# v1\n',
      "utf-8",
    );

    const improvedHigherVersion = '---\nversion: "5.0.0"\ndescription: "v2"\n---\n# v2\n';

    const res = await runHandler(
      handler,
      { content: improvedHigherVersion },
      { plugin: "demo-plugin", skill: "demo-skill" },
    );

    expect(res.capturedStatus).toBe(200);
    const json = JSON.parse(res.capturedBody);
    // User explicitly bumped to 5.0.0 — preserve it
    expect(json.version).toBe("5.0.0");
    const written = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
    expect(written).toMatch(/version:\s*"?5\.0\.0"?/);
  });

  it("starts at 1.0.1 when current frontmatter has no version", async () => {
    const { handlers, router } = makeRouter();
    registerImproveRoutes(router, root);
    const handler = handlers.post["/api/skills/:plugin/:skill/apply-improvement"];

    const skillDir = join(root, "plugins", "demo-plugin", "skills", "demo-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      '---\ndescription: "v1"\n---\n# v1\n',
      "utf-8",
    );

    const improvedNoVersion = '---\ndescription: "v2"\n---\n# v2\n';

    const res = await runHandler(
      handler,
      { content: improvedNoVersion },
      { plugin: "demo-plugin", skill: "demo-skill" },
    );

    expect(res.capturedStatus).toBe(200);
    const json = JSON.parse(res.capturedBody);
    expect(json.version).toBe("1.0.1");
    const written = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
    expect(written).toMatch(/version:\s*"?1\.0\.1"?/);
  });

  it("attempts queue submission via submitSkillUpdateEvent helper after write", async () => {
    const { handlers, router } = makeRouter();
    registerImproveRoutes(router, root);
    const handler = handlers.post["/api/skills/:plugin/:skill/apply-improvement"];

    const skillDir = join(root, "plugins", "demo-plugin", "skills", "demo-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      '---\nversion: "1.0.0"\ndescription: "v1"\n---\n# v1\n',
      "utf-8",
    );

    await runHandler(
      handler,
      { content: '---\ndescription: "v2"\n---\n# v2\n' },
      { plugin: "demo-plugin", skill: "demo-skill" },
    );

    expect(submitMock).toHaveBeenCalledTimes(1);
    const arg = submitMock.mock.calls[0][0];
    expect(arg.version).toBe("1.0.1");
    expect(arg.skillId).toBe("demo-plugin/demo-skill");
    // publishedAt is defaulted inside submitSkillUpdateEvent, so it may be
    // undefined at the call site — that's fine.
    expect(typeof arg.diffSummary === "string").toBe(true);
  });
});
