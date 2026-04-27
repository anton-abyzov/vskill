// ---------------------------------------------------------------------------
// 0767 — Uninstall route integration tests with orphan-cache fallback.
//
// Mocks runClaudePlugin so we can drive specific CLI exit codes / stderr
// strings, then exercises the actual `/api/plugins/:name/uninstall` route
// handler against a tmp cache root so the orphan-cleanup branch can be
// observed end-to-end.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

const mocks = vi.hoisted(() => ({
  runClaudePlugin: vi.fn(),
}));

vi.mock("../plugin-cli.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    runClaudePlugin: mocks.runClaudePlugin,
  };
});

import { Router } from "../router";
import { registerPluginCliRoutes } from "../plugin-cli-routes";

let cacheRoot: string;
let router: Router;

beforeEach(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), "vskill-uninstall-test-"));
  router = new Router();
  registerPluginCliRoutes(router, "/cwd", { cacheRoot });
  mocks.runClaudePlugin.mockReset();
});

afterEach(() => {
  if (existsSync(cacheRoot)) rmSync(cacheRoot, { recursive: true, force: true });
});

function seed(p: string): void {
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, "marker.txt"), "orphan");
}

interface Captured {
  status: number;
  body: Record<string, unknown> | null;
}

async function callUninstall(name: string, body: object = {}): Promise<Captured> {
  const captured: Captured = { status: 0, body: null };
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = "POST";
  req.url = `/api/plugins/${name}/uninstall`;
  req.headers = { "content-type": "application/json", host: "localhost" };

  const res = new ServerResponse(req);
  // Capture writeHead + end so we can assert the response.
  const origWriteHead = res.writeHead.bind(res);
  res.writeHead = ((status: number, ...rest: unknown[]) => {
    captured.status = status;
    return origWriteHead(status, ...(rest as [unknown?, unknown?]));
  }) as typeof res.writeHead;
  const origEnd = res.end.bind(res);
  res.end = ((chunk?: unknown, ...rest: unknown[]) => {
    if (typeof chunk === "string" && chunk.length > 0) {
      try {
        captured.body = JSON.parse(chunk);
      } catch {
        captured.body = { raw: chunk } as Record<string, unknown>;
      }
    }
    return origEnd(chunk as never, ...(rest as []));
  }) as typeof res.end;

  // Push body for readBody().
  process.nextTick(() => {
    req.push(JSON.stringify(body));
    req.push(null);
  });

  await router.handle(req, res);
  return captured;
}

describe("POST /api/plugins/:name/uninstall — orphan-cache fallback (0767)", () => {
  // 0795: after `claude plugin list` was removed from the CLI, the route
  // no longer shells out for ref resolution or post-action refresh — both
  // calls go through `discoverInstalledPlugins` (filesystem walk). Each test
  // therefore mocks `runClaudePlugin` exactly once (for the actual
  // install/uninstall/enable/disable subcommand, which DO still exist).

  it("returns ok:false unchanged when CLI fails for a non-orphan reason", async () => {
    // Single call: the actual uninstall.
    mocks.runClaudePlugin.mockResolvedValueOnce({
      stdout: "",
      stderr: "Permission denied",
      code: 1,
    });

    const result = await callUninstall("skill-creator");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: false,
      code: "claude-cli-failed",
      error: "Permission denied",
    });
  });

  it("falls back to orphan-cache cleanup when CLI says 'not found in installed plugins' AND a cache dir exists", async () => {
    const orphan = join(cacheRoot, "claude-plugins-official", "skill-creator");
    seed(join(orphan, "78497c524da3"));

    // Single call: uninstall returns "not found"; the route's listOrphan path
    // takes over and removes the cache dir directly.
    mocks.runClaudePlugin.mockResolvedValueOnce({
      stdout: "",
      stderr:
        '✘ Failed to uninstall plugin "skill-creator": Plugin "skill-creator" not found in installed plugins',
      code: 1,
    });

    const result = await callUninstall("skill-creator");

    expect(result.status).toBe(200);
    expect(result.body?.ok).toBe(true);
    expect(result.body?.fallback).toBe("orphan-cache-removed");
    expect((result.body?.removed as string[]).sort()).toEqual([orphan].sort());
    expect(existsSync(orphan)).toBe(false);
  });

  it("strips @marketplace from the name when scanning the cache (cache dirs use bare name)", async () => {
    const orphan = join(cacheRoot, "claude-plugins-official", "skill-creator");
    seed(join(orphan, "abc"));

    mocks.runClaudePlugin.mockResolvedValueOnce({
      stdout: "",
      stderr: 'Plugin "skill-creator" not found in installed plugins',
      code: 1,
    });

    const result = await callUninstall("skill-creator@claude-plugins-official");
    expect(result.body?.ok).toBe(true);
    expect(result.body?.fallback).toBe("orphan-cache-removed");
  });

  it("returns the original CLI error when 'not found' but no orphan cache dir exists", async () => {
    mocks.runClaudePlugin.mockResolvedValueOnce({
      stdout: "",
      stderr: 'Plugin "ghost" not found in installed plugins',
      code: 1,
    });

    const result = await callUninstall("ghost");
    expect(result.body?.ok).toBe(false);
    expect(result.body?.code).toBe("claude-cli-failed");
    expect(result.body?.error).toContain("not found in installed plugins");
  });

  it("returns ok:true with no fallback when CLI succeeds (orphan branch never runs)", async () => {
    mocks.runClaudePlugin.mockResolvedValueOnce({
      stdout: "Uninstalled plugin",
      stderr: "",
      code: 0,
    });

    const result = await callUninstall("skill-creator");
    expect(result.body?.ok).toBe(true);
    expect(result.body?.fallback).toBeUndefined();
  });
});
