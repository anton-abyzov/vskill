import { describe, expect, it, vi } from "vitest";
import {
  normalizeExternalHttpsUrl,
  registerDesktopOpenRoutes,
} from "../desktop-open-routes.js";

type Handler = (req: any, res: any, params?: Record<string, string>) => unknown;

function makeRouter() {
  const routes = new Map<string, Handler>();
  return {
    routes,
    post: (path: string, handler: Handler) => routes.set(`POST ${path}`, handler),
  };
}

function makeReq(body: unknown): any {
  return {
    method: "POST",
    url: "/api/desktop/open-url",
    headers: { "content-type": "application/json" },
    on(event: string, cb: (chunk?: Buffer) => void) {
      if (event === "data") cb(Buffer.from(JSON.stringify(body)));
      if (event === "end") cb();
      return this;
    },
  };
}

function makeRes(): any {
  const res: any = {
    statusCode: 200,
    headers: {},
    body: null,
    headersSent: false,
  };
  res.writeHead = (code: number, headers?: Record<string, string>) => {
    res.statusCode = code;
    res.headersSent = true;
    if (headers) Object.assign(res.headers, headers);
  };
  res.end = (body?: string) => {
    res.body = typeof body === "string" ? JSON.parse(body) : body;
  };
  return res;
}

describe("desktop open-url route", () => {
  it("accepts only https URLs", () => {
    expect(normalizeExternalHttpsUrl("https://github.com/login")).toBe(
      "https://github.com/login",
    );
    expect(normalizeExternalHttpsUrl("http://github.com/login")).toBeNull();
    expect(normalizeExternalHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeExternalHttpsUrl(null)).toBeNull();
  });

  it("opens a valid URL through the injected native opener", async () => {
    const router = makeRouter();
    const opener = vi.fn(async () => undefined);
    registerDesktopOpenRoutes(router as any, { opener });
    const handler = router.routes.get("POST /api/desktop/open-url")!;
    const res = makeRes();

    await handler(makeReq({ url: "https://github.com/octocat" }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(opener).toHaveBeenCalledWith("https://github.com/octocat");
  });

  it("rejects non-https URLs before invoking the opener", async () => {
    const router = makeRouter();
    const opener = vi.fn(async () => undefined);
    registerDesktopOpenRoutes(router as any, { opener });
    const handler = router.routes.get("POST /api/desktop/open-url")!;
    const res = makeRes();

    await handler(makeReq({ url: "file:///etc/passwd" }), res);

    expect(res.statusCode).toBe(400);
    expect(opener).not.toHaveBeenCalled();
  });
});
