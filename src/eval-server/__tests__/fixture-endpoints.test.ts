// ---------------------------------------------------------------------------
// 0707 T-026: integration tests for the four studio detail endpoints against
// real filesystem fixture skills (including dash-containing plugin slugs and
// skills that live outside any git repo). Each test spins up the Router with
// registerRoutes() bound to a freshly-minted temp directory so the behaviour
// is observed end-to-end — not via handler mocking.
//
// Endpoints under test:
//   GET /api/skills/:plugin/:skill/versions
//   GET /api/skills/:plugin/:skill/benchmark/latest
//   GET /api/skills/:plugin/:skill/evals
//   GET /api/skills/:plugin/:skill/activation-history
//
// Gates covered: G-F2 (200 + documented envelope for non-git fixture skills),
// G-F3 (dash-slug `google-workspace/gws` works for all four endpoints).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Router } from "../router.js";
import { registerRoutes } from "../api-routes.js";
import { studioTokenHeaders } from "./helpers/studio-token-test-helpers.js";

// 0836 US-002: every /api/* fetch must include X-Studio-Token. Wrap globalThis.fetch
// for the lifetime of this test file so we don't have to thread headers through
// every individual fetch call.
const _origFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const merged: RequestInit = { ...(init ?? {}) };
  const url = typeof input === "string" ? input : input.toString();
  if (url.includes("/api/")) {
    const headers = new Headers(merged.headers ?? {});
    for (const [k, v] of Object.entries(studioTokenHeaders())) headers.set(k, v);
    merged.headers = headers;
  }
  return _origFetch(input, merged);
}) as typeof fetch;

let tmpRoot: string;
let baseUrl: string;
let server: ReturnType<typeof createServer>;

function writeSkill(
  relDir: string,
  files: Record<string, string> = { "SKILL.md": "---\nname: test\n---\n" },
): string {
  const dir = join(tmpRoot, relDir);
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true });
    writeFileSync(full, body, "utf-8");
  }
  return dir;
}

async function startServer(): Promise<string> {
  const router = new Router();
  registerRoutes(router, tmpRoot);
  server = createServer(async (req, res) => {
    const matched = await router.handle(req, res);
    if (!matched && !res.headersSent) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  return `http://127.0.0.1:${addr.port}`;
}

async function stopServer(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), "vskill-0707-fixture-endpoints-"));
  // Fixture A: dash-containing plugin slug, skill is NOT inside a .git repo
  writeSkill("google-workspace/skills/gws", {
    "SKILL.md": "---\nname: gws\nversion: 0.1.0\n---\n# gws",
  });
  // Fixture B: happy-path plugin with a valid evals.json
  writeSkill("simple-plugin/skills/authoring", {
    "SKILL.md": "---\nname: authoring\nversion: 0.1.0\n---\n",
    "evals/evals.json": JSON.stringify({
      skill_name: "authoring",
      evals: [
        {
          id: 1,
          name: "case-1",
          prompt: "write hello",
          expected_output: "hello",
          expectations: ["output contains hello"],
        },
      ],
    }),
  });
  // Fixture C: malformed evals.json
  writeSkill("broken-plugin/skills/broken-evals", {
    "SKILL.md": "---\nname: broken\n---\n",
    "evals/evals.json": "{ not valid json",
  });
  baseUrl = await startServer();
});

afterEach(async () => {
  await stopServer();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("0707 T-026: /versions for non-git fixture skills", () => {
  it("returns 200 empty envelope with X-Skill-VCS: unavailable when platform is unreachable", async () => {
    // The integration test runs offline — fetch() to verified-skill.com fails
    // (either network refused or DNS). That is exactly the "no VCS surface"
    // path the harden step should handle as empty state, not 502.
    const res = await fetch(
      `${baseUrl}/api/skills/google-workspace/gws/versions`,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("x-skill-vcs")).toBe("unavailable");
    const body = await res.json();
    // 0823: envelope additively includes provider + trackedForUpdates.
    expect(body).toMatchObject({ versions: [], count: 0, source: "none" });
    expect(body.trackedForUpdates).toBe(false);
    expect(body.provider).toBeDefined();
  });

  it("works for dash-containing plugin slugs (google-workspace/gws)", async () => {
    const res = await fetch(
      `${baseUrl}/api/skills/google-workspace/gws/versions`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Whether network is up or down, plugin slug routing must succeed — the
    // dashed slug does not come back as 404 (catch-all) or generic 500.
    expect(Array.isArray(body.versions)).toBe(true);
    expect(typeof body.count).toBe("number");
    expect(["platform", "none"]).toContain(body.source);
  });
});

describe("0707 T-026: /benchmark/latest for non-git fixture skills", () => {
  it("returns 200 null when no benchmark exists (dash-slug plugin)", async () => {
    const res = await fetch(
      `${baseUrl}/api/skills/google-workspace/gws/benchmark/latest`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it("returns 200 null when no benchmark exists (simple plugin)", async () => {
    const res = await fetch(
      `${baseUrl}/api/skills/simple-plugin/authoring/benchmark/latest`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });
});

describe("0707 T-026: /evals three-state envelope", () => {
  it("returns 200 { exists: false, evals: [] } when evals.json is missing", async () => {
    const res = await fetch(
      `${baseUrl}/api/skills/google-workspace/gws/evals`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exists).toBe(false);
    expect(body.evals).toEqual([]);
  });

  it("returns 200 { exists: true, ...EvalsFile } when evals.json is valid", async () => {
    const res = await fetch(
      `${baseUrl}/api/skills/simple-plugin/authoring/evals`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exists).toBe(true);
    expect(body.skill_name).toBe("authoring");
    expect(Array.isArray(body.evals)).toBe(true);
    expect(body.evals.length).toBe(1);
  });

  it("returns 422 with validation details when evals.json is malformed", async () => {
    const res = await fetch(
      `${baseUrl}/api/skills/broken-plugin/broken-evals/evals`,
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toEqual(expect.any(String));
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
  });
});

describe("0707 T-026: /activation-history for never-activated skills", () => {
  it("returns 200 { runs: [], count: 0 } for a skill with no activation log", async () => {
    const res = await fetch(
      `${baseUrl}/api/skills/google-workspace/gws/activation-history`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ runs: [], count: 0 });
  });

  it("works for dash-slug plugins (google-workspace/gws)", async () => {
    // Same contract as above — here we assert explicitly that the dashed slug
    // reaches the handler (not 404 from the catch-all).
    const res = await fetch(
      `${baseUrl}/api/skills/google-workspace/gws/activation-history`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(0);
  });
});
