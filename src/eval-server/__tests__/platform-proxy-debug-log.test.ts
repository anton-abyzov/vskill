// ---------------------------------------------------------------------------
// platform-proxy-debug-log.test.ts — T-002 / 0838 — verifies structured
// SSE proxy logging behind VSKILL_DEBUG_SSE=1.
//
// Contract (AC-US1-02):
//   - When `process.env.VSKILL_DEBUG_SSE === "1"` AND the request path looks
//     like an SSE stream (`/stream` suffix or upstream replies with
//     `text/event-stream`), proxyToPlatform emits:
//       proxy.sse.start{requestId, upstreamUrl}  on dispatch
//       proxy.sse.end{requestId, status, durationMs}  on completion
//     and the response carries `X-Request-Id` matching the requestId.
//   - When the flag is unset (or "0"), no per-request logs and the
//     X-Request-Id header is NOT injected by the proxy (existing behavior).
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import * as http from "node:http";
import { proxyToPlatform } from "../platform-proxy.js";

let fakePlatform: http.Server;
let fakePort: number;
let nextResponse: {
  status: number;
  headers: Record<string, string>;
  body: string;
} = { status: 200, headers: {}, body: "" };

beforeAll(async () => {
  fakePlatform = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(nextResponse.status, nextResponse.headers);
      res.end(nextResponse.body);
    });
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
  nextResponse = {
    status: 200,
    headers: { "content-type": "text/event-stream" },
    body: "id: e1\nevent: skill.updated\ndata: {}\n\n",
  };
});

async function withProxyServer<T>(
  fn: (port: number) => Promise<T>,
): Promise<T> {
  const proxyServer = http.createServer((req, res) => {
    void proxyToPlatform(req, res);
  });
  await new Promise<void>((resolve) =>
    proxyServer.listen(0, "127.0.0.1", () => resolve()),
  );
  const addr = proxyServer.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    return await fn(port);
  } finally {
    proxyServer.closeAllConnections();
    await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
  }
}

describe("platform-proxy SSE debug logging (T-002 / AC-US1-02, AC-US1-03)", () => {
  it("AC-US1-02: emits proxy.sse.start + proxy.sse.end with matching requestId when VSKILL_DEBUG_SSE=1", async () => {
    const original = process.env.VSKILL_DEBUG_SSE;
    process.env.VSKILL_DEBUG_SSE = "1";
    const logs: unknown[][] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });
    try {
      await withProxyServer(async (port) => {
        const res = await fetch(
          `http://127.0.0.1:${port}/api/v1/skills/stream?skills=u1`,
        );
        expect(res.status).toBe(200);
        const xRequestId = res.headers.get("x-request-id");
        expect(typeof xRequestId).toBe("string");
        expect(xRequestId!.length).toBeGreaterThan(0);

        // Find structured log lines.
        const startLog = logs.find((args) =>
          typeof args[0] === "string" && args[0].startsWith("proxy.sse.start"),
        );
        const endLog = logs.find((args) =>
          typeof args[0] === "string" && args[0].startsWith("proxy.sse.end"),
        );
        expect(startLog, "proxy.sse.start log should be emitted").toBeDefined();
        expect(endLog, "proxy.sse.end log should be emitted").toBeDefined();

        // Both logs should include the same requestId (passed as second arg, structured).
        const startMeta = startLog?.[1] as { requestId?: string; upstreamUrl?: string } | undefined;
        const endMeta = endLog?.[1] as { requestId?: string; status?: number; durationMs?: number } | undefined;
        expect(startMeta?.requestId).toBe(xRequestId);
        expect(endMeta?.requestId).toBe(xRequestId);
        expect(typeof startMeta?.upstreamUrl).toBe("string");
        expect(startMeta?.upstreamUrl).toContain("/api/v1/skills/stream");
        expect(typeof endMeta?.status).toBe("number");
        expect(typeof endMeta?.durationMs).toBe("number");
      });
    } finally {
      spy.mockRestore();
      if (original === undefined) delete process.env.VSKILL_DEBUG_SSE;
      else process.env.VSKILL_DEBUG_SSE = original;
    }
  });

  it("AC-US1-03: emits NO per-request SSE logs when VSKILL_DEBUG_SSE is unset", async () => {
    const original = process.env.VSKILL_DEBUG_SSE;
    delete process.env.VSKILL_DEBUG_SSE;
    const logs: unknown[][] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });
    try {
      await withProxyServer(async (port) => {
        const res = await fetch(
          `http://127.0.0.1:${port}/api/v1/skills/stream?skills=u1`,
        );
        expect(res.status).toBe(200);
      });
      const startLog = logs.find((args) =>
        typeof args[0] === "string" && args[0].startsWith("proxy.sse."),
      );
      expect(startLog).toBeUndefined();
    } finally {
      spy.mockRestore();
      if (original !== undefined) process.env.VSKILL_DEBUG_SSE = original;
    }
  });

  it("AC-US1-03: emits NO per-request logs when VSKILL_DEBUG_SSE='0'", async () => {
    const original = process.env.VSKILL_DEBUG_SSE;
    process.env.VSKILL_DEBUG_SSE = "0";
    const logs: unknown[][] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });
    try {
      await withProxyServer(async (port) => {
        const res = await fetch(
          `http://127.0.0.1:${port}/api/v1/skills/stream?skills=u1`,
        );
        expect(res.status).toBe(200);
      });
      const sseLog = logs.find((args) =>
        typeof args[0] === "string" && args[0].startsWith("proxy.sse."),
      );
      expect(sseLog).toBeUndefined();
    } finally {
      spy.mockRestore();
      if (original === undefined) delete process.env.VSKILL_DEBUG_SSE;
      else process.env.VSKILL_DEBUG_SSE = original;
    }
  });

  it("AC-US1-02: skips logging for non-SSE paths even with debug flag set", async () => {
    const original = process.env.VSKILL_DEBUG_SSE;
    process.env.VSKILL_DEBUG_SSE = "1";
    nextResponse = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
    const logs: unknown[][] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });
    try {
      await withProxyServer(async (port) => {
        const res = await fetch(
          `http://127.0.0.1:${port}/api/v1/skills/check-updates`,
        );
        expect(res.status).toBe(200);
      });
      const sseLog = logs.find((args) =>
        typeof args[0] === "string" && args[0].startsWith("proxy.sse."),
      );
      expect(sseLog, "non-SSE paths should not produce proxy.sse.* logs").toBeUndefined();
    } finally {
      spy.mockRestore();
      if (original === undefined) delete process.env.VSKILL_DEBUG_SSE;
      else process.env.VSKILL_DEBUG_SSE = original;
    }
  });
});
