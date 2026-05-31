// ---------------------------------------------------------------------------
// sse-stream-token-gate.test.ts — 0855 US-001/US-002 integration test.
//
// Reproduces the production dispatch order end-to-end:
//   1. tokenGate(req, res)  — the 0836 X-Studio-Token gate (router.ts)
//   2. shouldProxyToPlatform(req.url) → proxyToPlatform(req, res)  — forwards
//      /api/v1/skills/* to the platform (eval-server.ts:132-155).
//
// The notification stream is opened by the browser `EventSource`, which CANNOT
// set request headers. 0855 lets it authenticate via a `?studioToken=<t>`
// query param. This test proves:
//   - GET /api/v1/skills/stream?studioToken=<valid> → 200, text/event-stream
//     (NOT 401), and the body is piped from the upstream SSE server.
//   - the studioToken param is STRIPPED before it reaches the upstream platform.
//   - a missing or wrong token → 401 (0836 boundary preserved).
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as http from "node:http";
import {
  proxyToPlatform,
  shouldProxyToPlatform,
} from "../platform-proxy.js";
import { getStudioToken, tokenGate, _resetStudioTokenForTests } from "../router.js";

interface CapturedReq {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
}

let fakePlatform: http.Server;
let fakePort: number;
let lastCaptured: CapturedReq | null = null;

beforeAll(async () => {
  // Fake upstream platform: responds with an SSE frame so we can assert the
  // content-type + body are piped back through the proxy.
  fakePlatform = http.createServer((req, res) => {
    lastCaptured = { method: req.method, url: req.url, headers: req.headers };
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    res.write('id: evt-1\nevent: skill.updated\ndata: {"skillId":"x"}\n\n');
    res.end();
  });
  await new Promise<void>((resolve) => {
    fakePlatform.listen(0, "127.0.0.1", () => {
      const addr = fakePlatform.address();
      if (typeof addr === "object" && addr) fakePort = addr.port;
      resolve();
    });
  });
  process.env.VSKILL_PLATFORM_URL = `http://127.0.0.1:${fakePort}`;
});

afterAll(async () => {
  delete process.env.VSKILL_PLATFORM_URL;
  await new Promise<void>((resolve) => fakePlatform.close(() => resolve()));
});

beforeEach(() => {
  lastCaptured = null;
  _resetStudioTokenForTests();
});

// Mirror the eval-server dispatcher: gate first, then proxy.
async function withGatedProxyServer<T>(
  fn: (port: number) => Promise<T>,
): Promise<T> {
  const server = http.createServer((req, res) => {
    if (!tokenGate(req, res)) return; // 401 already written by the gate
    if (shouldProxyToPlatform(req.url)) {
      void proxyToPlatform(req, res);
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    return await fn(port);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("SSE stream token-gate end-to-end (0855)", () => {
  it("AC-US1-03: GET /stream?studioToken=<valid> → 200 text/event-stream", async () => {
    const token = getStudioToken();
    await withGatedProxyServer(async (port) => {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/v1/skills/stream?skills=x&studioToken=${token}`,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/event-stream");
      const text = await res.text();
      expect(text).toContain("event: skill.updated");
    });
  });

  it("AC-US2-04: studioToken is stripped before reaching the upstream platform", async () => {
    const token = getStudioToken();
    await withGatedProxyServer(async (port) => {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/v1/skills/stream?skills=x&studioToken=${token}`,
      );
      await res.text();
    });
    expect(lastCaptured).not.toBeNull();
    expect(lastCaptured?.url ?? "").not.toContain("studioToken");
    expect(lastCaptured?.url ?? "").not.toContain(token);
    // The legitimate ?skills= filter must survive the strip.
    expect(lastCaptured?.url ?? "").toContain("skills=x");
  });

  it("AC-US2-01: GET /stream with NO token → 401 (never reaches upstream)", async () => {
    await withGatedProxyServer(async (port) => {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/v1/skills/stream?skills=x`,
      );
      expect(res.status).toBe(401);
    });
    expect(lastCaptured).toBeNull();
  });

  it("AC-US2-02: GET /stream?studioToken=<wrong> → 401 (never reaches upstream)", async () => {
    const token = getStudioToken();
    const wrong = "X".repeat(token.length);
    await withGatedProxyServer(async (port) => {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/v1/skills/stream?studioToken=${wrong}`,
      );
      expect(res.status).toBe(401);
    });
    expect(lastCaptured).toBeNull();
  });
});
