// ---------------------------------------------------------------------------
// 0847 — Plugin mutation routes must use the same plugin cache root for
// resolution and refresh that the Studio server was configured with.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
import { studioTokenHeaders } from "./helpers/studio-token-test-helpers.js";

let cacheRoot: string;
let projectDir: string;
let router: Router;

beforeEach(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), "vskill-plugin-mutation-cache-"));
  projectDir = mkdtempSync(join(tmpdir(), "vskill-plugin-mutation-project-"));
  router = new Router();
  registerPluginCliRoutes(router, projectDir, { cacheRoot });
  mocks.runClaudePlugin.mockReset();
});

afterEach(() => {
  if (existsSync(cacheRoot)) rmSync(cacheRoot, { recursive: true, force: true });
  if (existsSync(projectDir)) rmSync(projectDir, { recursive: true, force: true });
});

function seedPlugin(marketplace: string, name: string, version = "1.0.0"): void {
  const dir = join(cacheRoot, marketplace, name, version, ".claude-plugin");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugin.json"), JSON.stringify({ name }));
}

interface Captured {
  status: number;
  body: Record<string, unknown> | null;
}

async function callRoute(method: string, url: string, body: object = {}): Promise<Captured> {
  const captured: Captured = { status: 0, body: null };
  const req = new IncomingMessage(new Socket());
  req.method = method;
  req.url = url;
  req.headers = {
    "content-type": "application/json",
    host: "localhost",
    ...studioTokenHeaders(),
  };
  const res = new ServerResponse(req);
  const origWriteHead = res.writeHead.bind(res);
  res.writeHead = ((status: number, ...rest: unknown[]) => {
    captured.status = status;
    return origWriteHead(status, ...(rest as [unknown?, unknown?]));
  }) as typeof res.writeHead;
  const origEnd = res.end.bind(res);
  res.end = ((chunk?: unknown, ...rest: unknown[]) => {
    if (typeof chunk === "string" && chunk.length > 0) {
      captured.body = JSON.parse(chunk);
    }
    return origEnd(chunk as never, ...(rest as []));
  }) as typeof res.end;

  process.nextTick(() => {
    req.push(JSON.stringify(body));
    req.push(null);
  });

  await router.handle(req, res);
  return captured;
}

describe("plugin mutation routes", () => {
  it("resolves bare enable refs from the configured cache root", async () => {
    seedPlugin("scale-mp", "scale-fixture-01");
    mocks.runClaudePlugin.mockResolvedValueOnce({
      stdout: "Enabled",
      stderr: "",
      code: 0,
    });

    const result = await callRoute("POST", "/api/plugins/scale-fixture-01/enable", { scope: "user" });

    expect(result.status).toBe(200);
    expect(result.body?.ok).toBe(true);
    expect(mocks.runClaudePlugin).toHaveBeenCalledWith(
      ["enable", "scale-fixture-01@scale-mp", "--scope", "user"],
      expect.objectContaining({ cwd: projectDir }),
    );
  });

  it("refreshes install responses from the configured cache root", async () => {
    seedPlugin("scale-mp", "scale-fixture-02");
    mocks.runClaudePlugin.mockResolvedValueOnce({
      stdout: "Installed",
      stderr: "",
      code: 0,
    });

    const result = await callRoute("POST", "/api/plugins/install", {
      plugin: "scale-fixture-02@scale-mp",
      scope: "user",
    });

    expect(result.status).toBe(200);
    expect(result.body?.ok).toBe(true);
    expect(result.body?.plugins).toEqual([
      {
        name: "scale-fixture-02",
        marketplace: "scale-mp",
        version: "1.0.0",
        scope: "user",
        enabled: false,
      },
    ]);
  });
});
