// ---------------------------------------------------------------------------
// 0728 — POST /api/skills/save-draft must default version to "1.0.0"
//
// Companion to 0726's create-mode tests. The save-draft route is the path
// AI-generated skills travel through. Currently it calls buildSkillMd(body)
// without resolving body.version, so drafts land versionless on disk.
//
// AC-US1-01: no version → emit "1.0.0".
// AC-US1-02: explicit version → emit it verbatim.
// AC-US1-03: re-saving an existing draft preserves the on-disk version
//             rather than downgrading to "1.0.0".
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// History writer is a side effect we don't care about here.
vi.mock("../../eval/benchmark-history.js", () => ({
  writeHistoryEntry: vi.fn(async () => undefined),
}));
vi.mock("../../eval/llm.js", () => ({
  createLlmClient: vi.fn(),
}));
vi.mock("../../eval/benchmark.js", () => ({
  readBenchmark: vi.fn(),
}));
vi.mock("../../eval/schema.js", () => ({
  loadAndValidateEvals: vi.fn(() => ({ skill_name: "test-skill", evals: [] })),
}));

const { registerSkillCreateRoutes } = await import("../skill-create-routes.js");

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

const MINIMAL_AI_META = {
  prompt: "create a demo skill",
  provider: "anthropic",
  model: "claude-opus-4-7",
  reasoning: "test",
};

describe("0728 — POST /api/skills/save-draft default version", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "vskill-0728-save-draft-"));
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* */ }
  });

  it("AC-US1-01: writes SKILL.md with version: \"1.0.0\" when version is omitted", async () => {
    const { handlers, router } = makeRouter();
    registerSkillCreateRoutes(router, root);
    const handler = handlers.post["/api/skills/save-draft"];

    const res = await runHandler(handler, {
      name: "fresh-draft",
      plugin: "demo-plugin",
      layout: 2,
      description: "fresh draft",
      body: "# /fresh-draft",
      aiMeta: MINIMAL_AI_META,
    });

    expect(res.capturedStatus).toBe(201);
    const skillDir = join(root, "plugins", "demo-plugin", "skills", "fresh-draft");
    const written = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
    expect(written).toMatch(/^version: "1\.0\.0"$/m);
  });

  it("AC-US1-01: writes version: \"1.0.0\" when version is an empty string", async () => {
    const { handlers, router } = makeRouter();
    registerSkillCreateRoutes(router, root);
    const handler = handlers.post["/api/skills/save-draft"];

    const res = await runHandler(handler, {
      name: "empty-version-draft",
      plugin: "demo-plugin",
      layout: 2,
      description: "empty version",
      body: "# /empty-version-draft",
      version: "",
      aiMeta: MINIMAL_AI_META,
    });

    expect(res.capturedStatus).toBe(201);
    const skillDir = join(root, "plugins", "demo-plugin", "skills", "empty-version-draft");
    const written = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
    expect(written).toMatch(/^version: "1\.0\.0"$/m);
  });

  it("AC-US1-02: honours an explicit valid semver version in the request body", async () => {
    const { handlers, router } = makeRouter();
    registerSkillCreateRoutes(router, root);
    const handler = handlers.post["/api/skills/save-draft"];

    const res = await runHandler(handler, {
      name: "explicit-version-draft",
      plugin: "demo-plugin",
      layout: 2,
      description: "explicit version",
      body: "# /explicit-version-draft",
      version: "3.1.4",
      aiMeta: MINIMAL_AI_META,
    });

    expect(res.capturedStatus).toBe(201);
    const skillDir = join(root, "plugins", "demo-plugin", "skills", "explicit-version-draft");
    const written = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
    expect(written).toMatch(/^version: "3\.1\.4"$/m);
    expect(written).not.toMatch(/^version: "1\.0\.0"$/m);
  });

  it("AC-US1-03: re-saving over an existing draft preserves the on-disk version", async () => {
    const { handlers, router } = makeRouter();
    registerSkillCreateRoutes(router, root);
    const handler = handlers.post["/api/skills/save-draft"];

    // Pre-create a draft on disk with a non-default version to simulate
    // an in-progress AI iteration.
    const skillDir = join(root, "plugins", "demo-plugin", "skills", "iter-draft");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      '---\nname: iter-draft\ndescription: "old"\nversion: "1.2.7"\n---\n\n# /iter-draft\n',
      "utf-8",
    );
    writeFileSync(
      join(skillDir, "draft.json"),
      JSON.stringify({ draft: true, createdAt: new Date().toISOString() }),
      "utf-8",
    );

    // Re-save the draft with no version field → must NOT downgrade to 1.0.0.
    const res = await runHandler(handler, {
      name: "iter-draft",
      plugin: "demo-plugin",
      layout: 2,
      description: "new iteration",
      body: "# /iter-draft (v2)",
      aiMeta: MINIMAL_AI_META,
    });

    expect(res.capturedStatus).toBe(201);
    const written = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
    expect(written).toMatch(/^version: "1\.2\.7"$/m);
    expect(written).not.toMatch(/^version: "1\.0\.0"$/m);
    expect(written).toContain("new iteration");
  });
});
