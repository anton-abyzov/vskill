// ---------------------------------------------------------------------------
// T-020 (0707): Router must correctly extract :plugin / :skill params when
// the plugin slug contains dashes (e.g. google-workspace/gws). The pattern
// is built from `:([^/]+)` → `([^/]+)` which matches any path segment except
// `/`. This test locks the behavior so a future tightening to `\w+` does not
// silently break dash-containing plugin slugs.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { Router } from "../router.js";
import type { IncomingMessage, ServerResponse } from "node:http";

function fakeReq(url: string): IncomingMessage {
  return {
    method: "GET",
    url,
    headers: { host: "localhost" },
  } as unknown as IncomingMessage;
}

function fakeRes(): { res: ServerResponse; state: { headersSent: boolean; status?: number; body?: string } } {
  const state = { headersSent: false } as { headersSent: boolean; status?: number; body?: string };
  const res = {
    headersSent: false,
    writeHead: vi.fn((status: number) => {
      state.status = status;
      state.headersSent = true;
      return res;
    }),
    end: vi.fn((body: string) => {
      state.body = body;
    }),
    setHeader: vi.fn(),
  } as unknown as ServerResponse;
  return { res, state };
}

describe("Router — :plugin / :skill param extraction", () => {
  it("extracts dash-containing plugin slugs (google-workspace/gws)", async () => {
    const router = new Router();
    const handler = vi.fn((_req, res: any) => {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
    });
    router.get("/api/skills/:plugin/:skill/versions", handler);

    const { res } = fakeRes();
    const matched = await router.handle(
      fakeReq("/api/skills/google-workspace/gws/versions"),
      res,
    );

    expect(matched).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    const callArgs = handler.mock.calls[0];
    const params = callArgs[2] as Record<string, string>;
    expect(params.plugin).toBe("google-workspace");
    expect(params.skill).toBe("gws");
  });

  it("extracts dash-containing skill slugs (foo/my-skill-name)", async () => {
    const router = new Router();
    const handler = vi.fn((_req, res: any) => {
      res.writeHead(200);
      res.end("{}");
    });
    router.get("/api/skills/:plugin/:skill/benchmark/latest", handler);

    const { res } = fakeRes();
    await router.handle(
      fakeReq("/api/skills/foo/my-skill-name/benchmark/latest"),
      res,
    );

    const params = handler.mock.calls[0][2] as Record<string, string>;
    expect(params.plugin).toBe("foo");
    expect(params.skill).toBe("my-skill-name");
  });

  it("does not match when a path segment contains a slash (cannot span segments)", async () => {
    const router = new Router();
    const handler = vi.fn();
    router.get("/api/skills/:plugin/:skill", handler);

    const { res } = fakeRes();
    const matched = await router.handle(
      fakeReq("/api/skills/a/b/c"), // extra segment
      res,
    );

    expect(matched).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("decodes URI-encoded param values", async () => {
    const router = new Router();
    const handler = vi.fn((_req, res: any) => {
      res.writeHead(200);
      res.end("{}");
    });
    router.get("/api/skills/:plugin/:skill", handler);

    const { res } = fakeRes();
    await router.handle(fakeReq("/api/skills/my%2Dplugin/skill"), res);

    const params = handler.mock.calls[0][2] as Record<string, string>;
    expect(params.plugin).toBe("my-plugin");
  });
});
