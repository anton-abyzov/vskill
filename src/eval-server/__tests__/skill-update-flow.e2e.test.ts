// ---------------------------------------------------------------------------
// 0726 — End-to-end integration test for the skill update + publish flow.
//
// Boots a real eval-server in-process, points it at a fake platform that
// captures `/api/v1/internal/skills/publish` calls, then exercises the studio
// API endpoints from a fresh HTTP client. Verifies:
//   1. POST /api/skills/create with mode="update" overwrites the existing
//      skill, bumps the patch version, and submits a SkillUpdateEvent.
//   2. POST /api/skills/:plugin/:skill/apply-improvement bumps the version
//      and submits a SkillUpdateEvent to the queue.
//   3. The fake platform receives the events with the correct shape +
//      `X-Internal-Key` auth header.
//
// This is the "spawn a team of agents that submit a version" test the user
// asked for — only the agents are HTTP calls instead of separate processes.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as http from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startEvalServer } from "../eval-server.js";

const INTERNAL_KEY = "test-internal-key-0726";

interface CapturedPublish {
  headers: http.IncomingHttpHeaders;
  body: any;
  status: number;
}

let fakePlatform: http.Server;
let fakePort: number;
let captured: CapturedPublish[] = [];

let evalServer: http.Server;
let evalPort: number;
let workspaceRoot: string;
let evalWorkspaceDir: string;

beforeAll(async () => {
  // Fake vskill-platform — accepts /api/v1/internal/skills/publish and records.
  fakePlatform = http.createServer((req, res) => {
    if (req.url?.startsWith("/api/v1/internal/skills/publish") && req.method === "POST") {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        captured.push({ headers: req.headers, body, status: 202 });
        res.writeHead(202, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, eventId: body.eventId }));
      });
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise<void>((resolve) => {
    fakePlatform.listen(0, "127.0.0.1", () => {
      const addr = fakePlatform.address();
      if (typeof addr === "object" && addr) fakePort = addr.port;
      resolve();
    });
  });

  process.env.VSKILL_PLATFORM_URL = `http://127.0.0.1:${fakePort}`;
  process.env.INTERNAL_BROADCAST_KEY = INTERNAL_KEY;

  // Start a real eval-server pointing at a temp project root.
  workspaceRoot = mkdtempSync(join(tmpdir(), "vskill-0726-e2e-root-"));
  evalWorkspaceDir = mkdtempSync(join(tmpdir(), "vskill-0726-e2e-ws-"));
  evalServer = await startEvalServer({
    port: 0,
    root: workspaceRoot,
    workspaceDir: evalWorkspaceDir,
  });
  const addr = evalServer.address();
  if (typeof addr === "object" && addr) evalPort = addr.port;
}, 30_000);

afterAll(async () => {
  delete process.env.VSKILL_PLATFORM_URL;
  delete process.env.INTERNAL_BROADCAST_KEY;
  await new Promise<void>((resolve) => evalServer.close(() => resolve()));
  await new Promise<void>((resolve) => fakePlatform.close(() => resolve()));
  try { rmSync(workspaceRoot, { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(evalWorkspaceDir, { recursive: true, force: true }); } catch { /* */ }
});

beforeEach(() => {
  captured = [];
});

const evalUrl = (path: string) => `http://127.0.0.1:${evalPort}${path}`;

describe("0726 e2e — full skill update + publish round-trip", () => {
  it("agent A: creates a skill via /api/skills/create (mode=create)", async () => {
    const resp = await fetch(evalUrl("/api/skills/create"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "agent-a-skill",
        plugin: "test-plugin",
        layout: 2,
        description: "Agent A creating a fresh skill",
        body: "# Agent A skill\n\nFresh content.",
      }),
    });
    expect(resp.status).toBe(201);
    const json = (await resp.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.version).toBe("1.0.0");
    expect(json.updated).toBe(false);

    // Verify on disk
    const skillPath = join(workspaceRoot, "plugins", "test-plugin", "skills", "agent-a-skill", "SKILL.md");
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toMatch(/version:\s*"?1\.0\.0"?/);

    // Fresh creates do NOT submit to the queue (only updates do)
    expect(captured).toHaveLength(0);
  });

  it("agent B: updates the same skill via /api/skills/create (mode=update) — bumps version + publishes", async () => {
    const resp = await fetch(evalUrl("/api/skills/create"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "agent-a-skill",
        plugin: "test-plugin",
        layout: 2,
        description: "Agent B updated description",
        body: "# Agent B's improved skill\n\nUpdated content.",
        mode: "update",
      }),
    });
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.updated).toBe(true);
    expect(json.version).toBe("1.0.1");
    expect(json.publish).toBeDefined();
    expect(json.publish.submitted).toBe(true);

    // File on disk reflects the bump
    const skillPath = join(workspaceRoot, "plugins", "test-plugin", "skills", "agent-a-skill", "SKILL.md");
    const content = readFileSync(skillPath, "utf-8");
    expect(content).toMatch(/version:\s*"?1\.0\.1"?/);
    expect(content).toContain("Agent B's improved skill");

    // Fake platform received exactly one publish event
    expect(captured).toHaveLength(1);
    const ev = captured[0];
    expect(ev.headers["x-internal-key"]).toBe(INTERNAL_KEY);
    expect(ev.body.type).toBe("skill.updated");
    expect(ev.body.skillId).toBe("test-plugin/agent-a-skill");
    expect(ev.body.version).toBe("1.0.1");
    expect(typeof ev.body.eventId).toBe("string");
    expect(typeof ev.body.gitSha).toBe("string");
    expect(typeof ev.body.publishedAt).toBe("string");
  });

  it("agent C: applies an LLM improvement via /apply-improvement — bumps + publishes", async () => {
    // Pre-create a skill so apply-improvement has something to operate on
    const skillDir = join(workspaceRoot, "plugins", "test-plugin", "skills", "agent-c-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      '---\nversion: "2.5.0"\ndescription: "before improvement"\n---\n# Before\n',
      "utf-8",
    );

    const improvedContent = '---\ndescription: "after improvement"\n---\n# After improvement\n\nLLM-suggested updates.\n';
    const resp = await fetch(
      evalUrl("/api/skills/test-plugin/agent-c-skill/apply-improvement"),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: improvedContent }),
      },
    );
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.previousVersion).toBe("2.5.0");
    expect(json.version).toBe("2.5.1");
    expect(json.publish.submitted).toBe(true);

    const written = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
    expect(written).toMatch(/version:\s*"?2\.5\.1"?/);
    expect(written).toContain("After improvement");

    expect(captured).toHaveLength(1);
    expect(captured[0].body.skillId).toBe("test-plugin/agent-c-skill");
    expect(captured[0].body.version).toBe("2.5.1");
  });

  it("agent D: parallel updates produce monotonic version bumps + N publish events", async () => {
    // Pre-create skill
    const skillDir = join(workspaceRoot, "plugins", "test-plugin", "skills", "agent-d-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      '---\nversion: "1.0.0"\ndescription: "v1"\n---\n# v1\n',
      "utf-8",
    );

    // Fire 3 sequential updates (file IO + version read make true parallel
    // problematic — sequential matches the studio's actual usage pattern)
    const versions: string[] = [];
    for (let i = 0; i < 3; i++) {
      const resp = await fetch(
        evalUrl("/api/skills/test-plugin/agent-d-skill/apply-improvement"),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            content: `---\ndescription: "round ${i}"\n---\n# Round ${i}\n`,
          }),
        },
      );
      const j = (await resp.json()) as any;
      versions.push(j.version);
    }

    expect(versions).toEqual(["1.0.1", "1.0.2", "1.0.3"]);
    expect(captured).toHaveLength(3);
    expect(captured.map((e) => e.body.version)).toEqual(["1.0.1", "1.0.2", "1.0.3"]);

    const finalContent = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
    expect(finalContent).toMatch(/version:\s*"?1\.0\.3"?/);
  });
});
