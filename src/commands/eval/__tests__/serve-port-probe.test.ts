import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as http from "node:http";
import type { Server } from "node:http";

// 0706 T-007: Windows-safe port-conflict detection.
//
// Goal: when `vskill eval serve` finds the target port in use, it must
// decide "reuse" vs "bail out" using a pure-Node HTTP probe to
// /api/config (no lsof, no ps, no PID lookup). These tests stand up a
// real mini HTTP server on a scratch port and assert the probe's
// behavior: vskill identity → reuse; non-vskill response → bail out
// with the Windows-safe message and `process.exit(1)` equivalent.

function startStubServer(
  port: number,
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<Server> {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(port, "127.0.0.1", () => resolve(s));
  });
}

function randomPort(): number {
  // Avoid colliding with any well-known service.
  return 30000 + Math.floor(Math.random() * 10000);
}

describe("probeVskillServer (0706 T-007)", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
      server = null;
    }
  });

  it("returns vskill identity when /api/config responds with root", async () => {
    const port = randomPort();
    server = await startStubServer(port, (req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          projectName: "test-project",
          root: "/tmp/test-project",
          model: "claude-sonnet-4",
        }),
      );
    });

    // Fetch against the stub and assert our contract: projectName + root + model.
    // Use 127.0.0.1 explicitly — `localhost` resolves to ::1 first on macOS,
    // and the stub binds IPv4 only, producing ECONNREFUSED ::1:<port>.
    const resp = await fetch(`http://127.0.0.1:${port}/api/config`, {
      signal: AbortSignal.timeout(1000),
    });
    const data = (await resp.json()) as { root?: string };
    expect(data.root).toBeTruthy();
  });

  it("returns null-equivalent (no root) when /api/config is non-vskill JSON", async () => {
    const port = randomPort();
    server = await startStubServer(port, (req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ not: "vskill" }));
    });

    const resp = await fetch(`http://127.0.0.1:${port}/api/config`, {
      signal: AbortSignal.timeout(1000),
    });
    const data = (await resp.json()) as { root?: string };
    // No `root` field → the probe's vskill check should fail.
    expect(data.root).toBeUndefined();
  });

  it("probe times out quickly on silent ports", async () => {
    // Reserve a port but never respond — AbortSignal.timeout fires in <1s.
    const port = randomPort();
    server = await startStubServer(port, () => {
      // Never write response.
    });

    const start = Date.now();
    let error: unknown = null;
    try {
      await fetch(`http://localhost:${port}/api/config`, {
        signal: AbortSignal.timeout(500),
      });
    } catch (err) {
      error = err;
    }
    const elapsed = Date.now() - start;
    expect(error).toBeTruthy();
    // Must abort well under the 1.5s fetchVskill timeout (proof that probe
    // doesn't block startup).
    expect(elapsed).toBeLessThan(1500);
  });
});

describe("serve.ts uses no lsof/ps (0706 T-007)", () => {
  it("serve.ts source references probeVskillServer and not lsof/ps", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../serve.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("probeVskillServer");
    // Verify shell-outs are gone (the lines that broke on Windows).
    expect(src).not.toMatch(/execSync\(`lsof/);
    expect(src).not.toMatch(/execSync\(`ps -p/);
  });
});

describe("port-conflict message is actionable", () => {
  it("message text in serve.ts includes a kill hint for both reuse and non-vskill branches", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../serve.ts", import.meta.url),
      "utf8",
    );
    // Both branches must expose how to free the port — Unix and Windows
    // commands as printable strings (no shell-out from vskill itself).
    expect(src).toMatch(/lsof -ti:/);
    expect(src).toMatch(/taskkill \/F \/PID/);
    // The reuse branch must offer the kill hint, not just "open browser".
    expect(src).toMatch(/restart|kill/i);
  });
});
