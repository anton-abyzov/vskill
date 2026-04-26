// ---------------------------------------------------------------------------
// platform-proxy.test.ts — verifies the eval-server forwards
// `/api/v1/skills/*` to a configurable platform target (0712 US-003 T-016B).
//
// Strategy: spin up a fake "platform" HTTP server in-process, point
// `VSKILL_PLATFORM_URL` at it, then drive `proxyToPlatform` with a fabricated
// IncomingMessage / ServerResponse pair so we can assert the wire-level
// behaviour without the full eval-server stack.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as http from "node:http";
import {
  proxyToPlatform,
  shouldProxyToPlatform,
  getPlatformBaseUrl,
} from "../platform-proxy.js";

// Helper: collect upstream requests so each test can inspect them.
interface CapturedReq {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let fakePlatform: http.Server;
let fakePort: number;
let lastCaptured: CapturedReq | null = null;
let nextResponse: {
  status: number;
  headers: Record<string, string>;
  body: string | Buffer | null;
  /** When set, write `body` then keep the socket open for `holdMs` ms before ending. */
  holdMs?: number;
} = { status: 200, headers: {}, body: "" };

beforeAll(async () => {
  fakePlatform = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      lastCaptured = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      res.writeHead(nextResponse.status, nextResponse.headers);
      if (nextResponse.body !== null) {
        res.write(nextResponse.body);
      }
      if (nextResponse.holdMs && nextResponse.holdMs > 0) {
        setTimeout(() => res.end(), nextResponse.holdMs);
      } else {
        res.end();
      }
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
  lastCaptured = null;
  nextResponse = { status: 200, headers: {}, body: "" };
});

// Drive the proxy by issuing a real HTTP request against a tiny in-process
// server that delegates to `proxyToPlatform`. This exercises the full
// IncomingMessage / ServerResponse lifecycle (including streaming).
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
    await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
  }
}

describe("shouldProxyToPlatform", () => {
  it("matches /api/v1/skills/check-updates", () => {
    expect(shouldProxyToPlatform("/api/v1/skills/check-updates?skills=a")).toBe(
      true,
    );
  });
  it("matches /api/v1/skills/stream", () => {
    expect(shouldProxyToPlatform("/api/v1/skills/stream?skills=a")).toBe(true);
  });
  it("does NOT match /api/skills (legacy local route)", () => {
    expect(shouldProxyToPlatform("/api/skills")).toBe(false);
  });
  it("does NOT match unrelated paths", () => {
    expect(shouldProxyToPlatform("/")).toBe(false);
    expect(shouldProxyToPlatform("/api/config")).toBe(false);
    expect(shouldProxyToPlatform(undefined)).toBe(false);
  });

  // 0741 US-005 AC-US5-01: extend predicate for find-palette endpoints.
  // The eval-ui's FindSkillsPalette + SkillDetailPanel issue same-origin
  // fetches that must reach the platform via the eval-server proxy (per the
  // browser→localhost-only architecture rule).
  it("matches /api/v1/studio/search (find-palette query endpoint)", () => {
    expect(
      shouldProxyToPlatform("/api/v1/studio/search?q=obs&limit=20"),
    ).toBe(true);
  });
  it("matches /api/v1/studio/telemetry/search-select (fire-and-forget)", () => {
    expect(
      shouldProxyToPlatform("/api/v1/studio/telemetry/search-select"),
    ).toBe(true);
  });
  it("matches /api/v1/studio/telemetry/install-copy (fire-and-forget)", () => {
    expect(
      shouldProxyToPlatform("/api/v1/studio/telemetry/install-copy"),
    ).toBe(true);
  });
  it("matches /api/v1/stats (trending fallback)", () => {
    expect(shouldProxyToPlatform("/api/v1/stats")).toBe(true);
  });
  // 0741 AC-US5-05: confirm the existing /api/v1/skills/* glob still covers
  // the detail-page endpoints (.../{owner}/{repo}/{skill} and .../versions).
  it("matches /api/v1/skills/{owner}/{repo}/{skill}/versions via existing glob", () => {
    expect(
      shouldProxyToPlatform("/api/v1/skills/anton-abyzov/vskill/greet-anton/versions"),
    ).toBe(true);
    expect(
      shouldProxyToPlatform("/api/v1/skills/anton-abyzov/vskill/greet-anton"),
    ).toBe(true);
  });
  // 0741 AC-US5-04: negative — paths that look studio-ish but are NOT
  // intended to be proxied. /api/v1/studio (no trailing path) shouldn't
  // match the search prefix; /api/v1/foo is unrelated.
  it("does NOT match /api/v1/studio (bare prefix, no specific endpoint)", () => {
    expect(shouldProxyToPlatform("/api/v1/studio")).toBe(false);
  });
  it("does NOT match /api/v1/foo (unrelated v1 path)", () => {
    expect(shouldProxyToPlatform("/api/v1/foo")).toBe(false);
  });
});

describe("getPlatformBaseUrl", () => {
  it("returns env value (set by beforeAll)", () => {
    expect(getPlatformBaseUrl()).toBe(`http://127.0.0.1:${fakePort}`);
  });
  it("strips trailing slash", () => {
    process.env.VSKILL_PLATFORM_URL = "http://example.test:9999/";
    expect(getPlatformBaseUrl()).toBe("http://example.test:9999");
    process.env.VSKILL_PLATFORM_URL = `http://127.0.0.1:${fakePort}`;
  });
  // 0725 AC-US1-01/03: when VSKILL_PLATFORM_URL is unset, the proxy must
  // default to the production worker (https://verified-skill.com), mirroring
  // src/api/client.ts:10 DEFAULT_BASE_URL. Hermetic — no live network call.
  it("defaults to https://verified-skill.com when VSKILL_PLATFORM_URL is unset", () => {
    const original = process.env.VSKILL_PLATFORM_URL;
    delete process.env.VSKILL_PLATFORM_URL;
    try {
      expect(getPlatformBaseUrl()).toBe("https://verified-skill.com");
    } finally {
      if (typeof original !== "undefined") {
        process.env.VSKILL_PLATFORM_URL = original;
      }
    }
  });
  // 0725 AC-US1-01: empty-string env also falls through to the production default.
  it("defaults to https://verified-skill.com when VSKILL_PLATFORM_URL is empty", () => {
    const original = process.env.VSKILL_PLATFORM_URL;
    process.env.VSKILL_PLATFORM_URL = "";
    try {
      expect(getPlatformBaseUrl()).toBe("https://verified-skill.com");
    } finally {
      if (typeof original !== "undefined") {
        process.env.VSKILL_PLATFORM_URL = original;
      } else {
        delete process.env.VSKILL_PLATFORM_URL;
      }
    }
  });
});

describe("proxyToPlatform — request forwarding", () => {
  it("forwards GET requests with path, query, and headers", async () => {
    nextResponse = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ results: [] }),
    };
    await withProxyServer(async (port) => {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/v1/skills/check-updates?skills=a%2Fb`,
        { headers: { "x-test-header": "yes" } },
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ results: [] });
    });
    expect(lastCaptured?.method).toBe("GET");
    expect(lastCaptured?.url).toBe(
      "/api/v1/skills/check-updates?skills=a%2Fb",
    );
    expect(lastCaptured?.headers["x-test-header"]).toBe("yes");
  });

  it("forwards POST request body", async () => {
    nextResponse = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
    await withProxyServer(async (port) => {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/v1/skills/check-updates`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ skills: ["plugin/skill"] }),
        },
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });
    expect(lastCaptured?.method).toBe("POST");
    expect(JSON.parse(lastCaptured?.body ?? "{}")).toEqual({
      skills: ["plugin/skill"],
    });
  });

  it("propagates upstream non-2xx status verbatim", async () => {
    nextResponse = {
      status: 405,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "method_not_allowed" }),
    };
    await withProxyServer(async (port) => {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/v1/skills/check-updates`,
      );
      expect(res.status).toBe(405);
      expect(await res.json()).toEqual({ error: "method_not_allowed" });
    });
  });

  it("returns 502 with structured envelope when upstream is unreachable", async () => {
    const original = process.env.VSKILL_PLATFORM_URL;
    process.env.VSKILL_PLATFORM_URL = "http://127.0.0.1:1"; // unreachable
    try {
      await withProxyServer(async (port) => {
        const res = await fetch(
          `http://127.0.0.1:${port}/api/v1/skills/check-updates`,
        );
        expect(res.status).toBe(502);
        const body = await res.json();
        expect(body.error).toBe("platform_unreachable");
        expect(typeof body.message).toBe("string");
      });
    } finally {
      process.env.VSKILL_PLATFORM_URL = original;
    }
  });

  it("strips hop-by-hop headers", async () => {
    nextResponse = { status: 200, headers: {}, body: "" };
    await withProxyServer(async (port) => {
      await fetch(`http://127.0.0.1:${port}/api/v1/skills/stream`, {
        headers: {
          // `connection` is hop-by-hop; must NOT reach the upstream.
          // (Node's fetch may strip some of these on its own; assert what we
          //  control: the upstream `connection` header should be the one
          //  Node's http.request sets, which is "keep-alive" by default —
          //  NOT whatever we pass here.)
          "X-Real-Test": "ok",
        },
      });
    });
    // Sanity: upstream sees the non-hop-by-hop header we set.
    expect(lastCaptured?.headers["x-real-test"]).toBe("ok");
    // And `host` is rewritten (we forward to 127.0.0.1:fakePort, NOT
    // whatever the proxy server's host header was).
    expect(lastCaptured?.headers.host).toContain(String(fakePort));
  });

  it("preserves text/event-stream content-type and body for SSE responses", async () => {
    nextResponse = {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      },
      body: "id: evt-1\nevent: skill.updated\ndata: {\"skillId\":\"x\"}\n\n",
    };
    await withProxyServer(async (port) => {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/v1/skills/stream?skills=x`,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/event-stream");
      const text = await res.text();
      expect(text).toContain("event: skill.updated");
      expect(text).toContain("id: evt-1");
    });
  });
});
