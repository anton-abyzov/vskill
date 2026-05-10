// ---------------------------------------------------------------------------
// 0836 US-002 — X-Studio-Token gate tests (RED → GREEN).
//
// The eval-server's router currently allows any localhost Origin via
// `LOCALHOST_ORIGIN_RE`. After the fix:
//   - every /api/* request requires `X-Studio-Token: <token>`
//   - missing/wrong → 401, empty body, no token in log
//   - OPTIONS preflight bypasses the gate
//   - static files bypass the gate
//   - length-mismatch is rejected before timingSafeEqual
//   - the token is rotated per process via `_resetStudioTokenForTests`
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "../router.js";
import {
  _resetStudioTokenForTests,
  getStudioToken,
  tokenGate,
  tokensEqual,
} from "../router.js";
import type { IncomingMessage, ServerResponse } from "node:http";

interface FakeReqInit {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
}

function fakeReq(init: FakeReqInit = {}): IncomingMessage {
  return {
    method: init.method ?? "GET",
    // Default to a token-gated endpoint. /api/health is intentionally exempt
    // from tokenGate (Codex C#1 fix — sidecar boot polls health BEFORE it has
    // the studio_token from stdout), so a default of "/api/health" would mask
    // every gate-rejection test. Use /api/skills instead — a normal protected
    // route — so missing-token assertions actually fire.
    url: init.url ?? "/api/skills",
    headers: { host: "localhost", ...(init.headers ?? {}) },
  } as unknown as IncomingMessage;
}

interface FakeResState {
  status?: number;
  body?: string;
  headers?: Record<string, string | number>;
  ended: boolean;
}

function fakeRes(): { res: ServerResponse; state: FakeResState } {
  const state: FakeResState = { ended: false };
  const res = {
    headersSent: false,
    writeHead: vi.fn((status: number, headers?: Record<string, string | number>) => {
      state.status = status;
      state.headers = headers;
      (res as unknown as { headersSent: boolean }).headersSent = true;
      return res;
    }),
    end: vi.fn((body?: string) => {
      state.body = body;
      state.ended = true;
    }),
    setHeader: vi.fn(),
  } as unknown as ServerResponse;
  return { res, state };
}

describe("getStudioToken (US-002 AC-US2-01, AC-US2-08)", () => {
  beforeEach(() => {
    _resetStudioTokenForTests();
  });

  it("AC-US2-01: returns a base64url string of length 43 (256 bits)", () => {
    const t = getStudioToken();
    expect(typeof t).toBe("string");
    // base64url-encoded 32 bytes = 43 chars (no padding).
    expect(t).toHaveLength(43);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("AC-US2-01: same process returns the same token across calls", () => {
    const a = getStudioToken();
    const b = getStudioToken();
    expect(a).toBe(b);
  });

  it("AC-US2-08: rotates after _resetStudioTokenForTests", () => {
    const a = getStudioToken();
    _resetStudioTokenForTests();
    const b = getStudioToken();
    expect(a).not.toBe(b);
  });
});

describe("tokensEqual constant-time compare (US-002 AC-US2-06)", () => {
  it("returns true for matching tokens", () => {
    expect(tokensEqual("abc123", "abc123")).toBe(true);
  });

  it("returns false for length mismatch (rejected before timingSafeEqual)", () => {
    expect(tokensEqual("short", "much-longer")).toBe(false);
  });

  it("returns false for same-length but different content", () => {
    expect(tokensEqual("abcdef", "abcXXX")).toBe(false);
  });

  it("returns false when supplied is undefined or non-string", () => {
    expect(tokensEqual(undefined, "abc")).toBe(false);
    expect(tokensEqual(null as unknown as string, "abc")).toBe(false);
    expect(tokensEqual(123 as unknown as string, "abc")).toBe(false);
  });

  it("returns false for empty string supplied", () => {
    expect(tokensEqual("", "abc")).toBe(false);
  });
});

describe("tokenGate (US-002 AC-US2-03, AC-US2-04, AC-US2-05)", () => {
  beforeEach(() => {
    _resetStudioTokenForTests();
  });

  it("AC-US2-05: /api/* without X-Studio-Token returns 401, empty body", () => {
    const req = fakeReq({ url: "/api/skills" });
    const { res, state } = fakeRes();
    const passed = tokenGate(req, res);
    expect(passed).toBe(false);
    expect(state.status).toBe(401);
    expect(state.body ?? "").toBe("");
  });

  it("AC-US2-05: /api/* with correct X-Studio-Token allows the request", () => {
    const token = getStudioToken();
    const req = fakeReq({
      url: "/api/skills",
      headers: { "x-studio-token": token },
    });
    const { res, state } = fakeRes();
    const passed = tokenGate(req, res);
    expect(passed).toBe(true);
    expect(state.ended).toBe(false);
  });

  it("AC-US2-03: /api/* with wrong same-length X-Studio-Token returns 401", () => {
    const token = getStudioToken();
    const wrong = "X".repeat(token.length);
    const req = fakeReq({
      url: "/api/skills",
      headers: { "x-studio-token": wrong },
    });
    const { res, state } = fakeRes();
    const passed = tokenGate(req, res);
    expect(passed).toBe(false);
    expect(state.status).toBe(401);
  });

  it("AC-US2-06: a wrong-length token returns 401 (length-mismatch fast path)", () => {
    const req = fakeReq({
      url: "/api/skills",
      headers: { "x-studio-token": "too-short" },
    });
    const { res, state } = fakeRes();
    const passed = tokenGate(req, res);
    expect(passed).toBe(false);
    expect(state.status).toBe(401);
  });

  it("AC-US2-03: a wrong supplied token does NOT appear in any log line", () => {
    const wrong = "supersekret-attacker-value-XYZ-000-aaa-bbb";
    const logs: string[] = [];
    const origLog = console.log;
    const origWarn = console.warn;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    console.warn = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    try {
      const req = fakeReq({
        url: "/api/skills",
        headers: { "x-studio-token": wrong },
      });
      const { res } = fakeRes();
      tokenGate(req, res);
    } finally {
      console.log = origLog;
      console.warn = origWarn;
    }
    for (const line of logs) {
      expect(line).not.toContain(wrong);
    }
  });

  it("AC-US2-03: OPTIONS bypasses the gate", () => {
    const req = fakeReq({ url: "/api/skills", method: "OPTIONS" });
    const { res } = fakeRes();
    const passed = tokenGate(req, res);
    expect(passed).toBe(true);
  });

  it("non-/api paths bypass the gate (static files)", () => {
    const req = fakeReq({ url: "/index.html" });
    const { res } = fakeRes();
    const passed = tokenGate(req, res);
    expect(passed).toBe(true);
  });

  it("AC-US2-08: a token from a prior process (after reset) returns 401", () => {
    const stale = getStudioToken();
    _resetStudioTokenForTests();
    // The fresh process generates a different token on next request.
    const req = fakeReq({
      url: "/api/skills",
      headers: { "x-studio-token": stale },
    });
    const { res, state } = fakeRes();
    const passed = tokenGate(req, res);
    expect(passed).toBe(false);
    expect(state.status).toBe(401);
  });

  // ─── Codex 2026-05-10 follow-up regressions ────────────────────────────
  // These guard the two fixes from the adversarial review:
  //   C#1: /api/health must pass without a token (desktop boot deadlock).
  //   H#4: absolute-form request targets must gate on parsed pathname,
  //        not on the raw req.url string.
  it("Codex C#1: /api/health is exempt from tokenGate (desktop sidecar boot)", () => {
    const req = fakeReq({ url: "/api/health" });
    const { res, state } = fakeRes();
    const passed = tokenGate(req, res);
    expect(passed).toBe(true);
    expect(state.status).toBeUndefined();
    expect(state.ended).toBe(false);
  });

  it("Codex H#4: absolute-form URL is gated by parsed pathname, not raw string", () => {
    // Some HTTP clients (curl, Rust reqwest, certain proxies) emit the
    // request target in absolute form. The raw req.url then contains the
    // scheme+host prefix and `startsWith('/api/')` returns false on it,
    // even though the route dispatcher correctly resolves to /api/skills.
    const req = fakeReq({
      url: "http://127.0.0.1:3077/api/skills",
      // intentionally no x-studio-token
    });
    const { res, state } = fakeRes();
    const passed = tokenGate(req, res);
    expect(passed).toBe(false);
    expect(state.status).toBe(401);
  });

  it("Codex H#4: absolute-form URL with valid token still passes", () => {
    const valid = getStudioToken();
    const req = fakeReq({
      url: "http://127.0.0.1:3077/api/skills",
      headers: { "x-studio-token": valid },
    });
    const { res, state } = fakeRes();
    const passed = tokenGate(req, res);
    expect(passed).toBe(true);
    expect(state.status).toBeUndefined();
  });
});

describe("Router.handle integrated with tokenGate (US-002 AC-US2-04)", () => {
  beforeEach(() => {
    _resetStudioTokenForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("AC-US2-04/05: /api/* without token never reaches the route handler", async () => {
    const router = new Router();
    const handler = vi.fn((_req, res) => {
      (res as ServerResponse).writeHead(200);
      (res as ServerResponse).end("{}");
    });
    router.get("/api/health", handler);

    const req = fakeReq({ url: "/api/skills" });
    const { res, state } = fakeRes();
    const matched = await router.handle(req, res);
    // Either the gate produces 401 (and matched=true since the response is
    // owned by the router), OR the gate is missing (legacy path) and the
    // handler runs. The strict assertion: handler MUST NOT have been called.
    expect(handler).not.toHaveBeenCalled();
    // Some implementations short-circuit before route matching → matched=true
    // with status=401. Accept either as long as the response is 401.
    expect(matched).toBeTruthy();
    expect(state.status).toBe(401);
  });

  it("AC-US2-05: /api/* with valid token reaches the route handler", async () => {
    const token = getStudioToken();
    const router = new Router();
    const handler = vi.fn((_req, res) => {
      (res as ServerResponse).writeHead(200);
      (res as ServerResponse).end(JSON.stringify({ ok: true }));
    });
    // Register on /api/skills (not /api/health, which is now exempt from
    // tokenGate per Codex C#1 — using a non-exempt path proves the gate
    // both lets the request through AND the route runs).
    router.get("/api/skills", handler);

    const req = fakeReq({
      url: "/api/skills",
      headers: { "x-studio-token": token },
    });
    const { res, state } = fakeRes();
    await router.handle(req, res);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(state.status).toBe(200);
  });
});
