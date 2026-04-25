// ---------------------------------------------------------------------------
// 0682 F-001 — Studio.json restoration on boot
//
// Code-review F-001 (CRITICAL): currentOverrides is initialized at module
// scope with a default `{ provider: "claude-cli" }`, so the guard
// `if (!currentOverrides.provider)` in /api/config NEVER fires —
// loadStudioSelection() is silently skipped on every boot.
//
// This test exercises the regression and asserts that a stored studio.json
// at .vskill/studio.json IS restored on the first /api/config request.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Minimal Router stub — captures registered handlers and lets us invoke them.
type Handler = (req: unknown, res: unknown, params?: Record<string, string>) => unknown;
interface FakeRouter {
  routes: Map<string, Handler>;
  get: (path: string, h: Handler) => void;
  post: (path: string, h: Handler) => void;
  put: (path: string, h: Handler) => void;
  delete: (path: string, h: Handler) => void;
}

function makeRouter(): FakeRouter {
  const routes = new Map<string, Handler>();
  return {
    routes,
    get: (p, h) => routes.set(`GET ${p}`, h),
    post: (p, h) => routes.set(`POST ${p}`, h),
    put: (p, h) => routes.set(`PUT ${p}`, h),
    delete: (p, h) => routes.set(`DELETE ${p}`, h),
  };
}

interface FakeRes {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  setHeader: (k: string, v: string) => void;
  writeHead: (code: number, headers?: Record<string, string>) => void;
  end: (body?: string) => void;
}

function makeRes(): FakeRes {
  const res: Partial<FakeRes> = {
    statusCode: 200,
    body: null as unknown,
    headers: {},
  };
  res.setHeader = (k: string, v: string) => {
    (res.headers as Record<string, string>)[k] = v;
  };
  res.writeHead = (code: number, headers?: Record<string, string>) => {
    res.statusCode = code;
    if (headers) Object.assign(res.headers as Record<string, string>, headers);
  };
  res.end = (body?: string) => {
    if (typeof body === "string") {
      try {
        res.body = JSON.parse(body);
      } catch {
        res.body = body;
      }
    }
  };
  return res as FakeRes;
}

const tempDirs: string[] = [];

function makeRoot(studioJson: { activeAgent: string; activeModel: string } | null): string {
  const root = mkdtempSync(join(tmpdir(), "vskill-0682-restore-"));
  tempDirs.push(root);
  if (studioJson) {
    const dir = join(root, ".vskill");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "studio.json"),
      JSON.stringify({ ...studioJson, updatedAt: new Date().toISOString() }),
      "utf8",
    );
  }
  return root;
}

afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe("0682 F-001: studio.json is restored on first /api/config request", () => {
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(async () => {
    // Reset module so the in-memory currentOverrides + studioLoaded flag
    // start fresh per test, simulating server boot.
    const { resetStudioRestoreState } = await import("../api-routes.js");
    resetStudioRestoreState?.();
    // Seed test API keys so getClient() doesn't throw and clobber the
    // restored provider via the catch-path. The actual key value never
    // leaves the process — no upstream call is made by /api/config itself.
    process.env.OPENROUTER_API_KEY = "test-or-key-for-validation";
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key-for-validation";
  });

  afterEach(() => {
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
    if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  });

  it("restores activeAgent + activeModel from .vskill/studio.json on boot", async () => {
    const root = makeRoot({ activeAgent: "openrouter", activeModel: "anthropic/claude-3.5-sonnet" });
    const { registerRoutes } = await import("../api-routes.js");
    const router = makeRouter();
    registerRoutes(router as unknown as Parameters<typeof registerRoutes>[0], root);

    const handler = router.routes.get("GET /api/config")!;
    expect(handler).toBeDefined();
    const res = makeRes();
    await handler({}, res);

    const body = res.body as { provider: string | null; model: string };
    expect(body.provider).toBe("openrouter");
    expect(body.model).toBe("anthropic/claude-3.5-sonnet");
  });

  it("falls back to claude-cli default when studio.json is absent", async () => {
    const root = makeRoot(null);
    const { registerRoutes } = await import("../api-routes.js");
    const router = makeRouter();
    registerRoutes(router as unknown as Parameters<typeof registerRoutes>[0], root);

    const handler = router.routes.get("GET /api/config")!;
    const res = makeRes();
    await handler({}, res);

    const body = res.body as { provider: string | null };
    // Default — claude-cli — should still come through when no studio.json.
    expect(body.provider).toBe("claude-cli");
  });

  it("does NOT re-load studio.json on subsequent calls (idempotency)", async () => {
    const root = makeRoot({ activeAgent: "openrouter", activeModel: "x/y" });
    const { registerRoutes } = await import("../api-routes.js");
    const router = makeRouter();
    registerRoutes(router as unknown as Parameters<typeof registerRoutes>[0], root);

    const handler = router.routes.get("GET /api/config")!;
    const res1 = makeRes();
    await handler({}, res1);

    // After first call: rewrite studio.json on disk to a different value.
    // If load runs again, the second response should reflect the change.
    // Correct behavior: load runs ONCE on boot, so second call still reflects
    // the first load (i.e., "openrouter"/"x/y").
    writeFileSync(
      join(root, ".vskill", "studio.json"),
      JSON.stringify({
        activeAgent: "anthropic",
        activeModel: "haiku",
        updatedAt: new Date().toISOString(),
      }),
      "utf8",
    );

    const res2 = makeRes();
    await handler({}, res2);
    const body2 = res2.body as { provider: string | null };
    // Idempotency — boot-time load should not re-fire mid-session.
    expect(body2.provider).toBe("openrouter");
  });
});
