import { describe, it, expect, afterEach } from "vitest";
import * as http from "node:http";
import type { Server } from "node:http";
import { requestShutdownAndWait } from "../serve.js";

// `vskill studio --force` flow:
//   1. POST /api/shutdown to the existing server.
//   2. Poll the port until it frees.
//   3. Caller proceeds to bind.
// These tests stand up tiny stub servers that mimic both ends of the contract
// (well-behaved + uncooperative) and assert requestShutdownAndWait's return.

function startStubServer(
  port: number,
  handler: (req: http.IncomingMessage, res: http.ServerResponse, server: Server) => void,
): Promise<Server> {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => handler(req, res, s));
    // Bind to default (all interfaces) — matches how the real eval-server
    // listens, so isPortInUse's IPv4/IPv6 probe sees this port as occupied.
    // Binding to 127.0.0.1 specifically would let the probe succeed on ::.
    s.listen(port, () => resolve(s));
  });
}

function randomPort(): number {
  return 30000 + Math.floor(Math.random() * 10000);
}

describe("requestShutdownAndWait (force-restart contract)", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server && server.listening) {
      await new Promise<void>((r) => server!.close(() => r()));
    }
    server = null;
  });

  it("returns true when the server honors POST /api/shutdown by closing", async () => {
    const port = randomPort();
    server = await startStubServer(port, (req, res, s) => {
      if (req.url === "/api/shutdown" && req.method === "POST") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, shuttingDown: true }));
        // Simulate the real handler: close the server after responding.
        setTimeout(() => s.close(), 20);
        return;
      }
      res.statusCode = 404;
      res.end();
    });

    const freed = await requestShutdownAndWait(port);
    expect(freed).toBe(true);
  }, 10000);

  it("returns false when the server ignores /api/shutdown (port stays bound)", async () => {
    const port = randomPort();
    server = await startStubServer(port, (req, res) => {
      // Accept the request but never close — simulates a stuck/uncooperative server.
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false }));
    });

    const start = Date.now();
    const freed = await requestShutdownAndWait(port);
    const elapsed = Date.now() - start;

    expect(freed).toBe(false);
    // Polls for ~5s before giving up — must not hang the user indefinitely.
    expect(elapsed).toBeGreaterThanOrEqual(4900);
    expect(elapsed).toBeLessThan(7000);
  }, 10000);
});

describe("--force is wired into CLI surface", () => {
  it("studio command exposes --force/-f", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../../index.ts", import.meta.url),
      "utf8",
    );
    // The studio command must advertise -f/--force to the user.
    expect(src).toMatch(/\.command\("studio"\)[\s\S]*?-f, --force/);
  });

  it("port-conflict message advertises --force as the friendly option", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../serve.ts", import.meta.url),
      "utf8",
    );
    // The reuse branch must mention --force so users discover it without docs.
    expect(src).toMatch(/vskill studio --force/);
  });
});
