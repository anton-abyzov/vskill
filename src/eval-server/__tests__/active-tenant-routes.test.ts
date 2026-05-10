// ---------------------------------------------------------------------------
// active-tenant-routes.test.ts — 0839 T-011 / US-004.
//
// Drives the GET/POST handler directly with fake req/res. Uses a temp
// dir for the config file so we don't touch the user's real
// `~/.vskill/config.json`.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { handleActiveTenant } from "../active-tenant-routes.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vskill-internal-tenant-"));
}

interface FakeRes {
  statusCode: number | null;
  body: unknown;
  headers: Record<string, string>;
  writeHead: (code: number, headers?: Record<string, string>) => unknown;
  setHeader: (k: string, v: string) => unknown;
  end: (chunk?: string) => unknown;
  headersSent: boolean;
}

function fakeRes(): FakeRes {
  const r: FakeRes = {
    statusCode: null,
    body: undefined,
    headers: {},
    headersSent: false,
    writeHead(code, headers) {
      r.statusCode = code;
      if (headers) Object.assign(r.headers, headers);
      r.headersSent = true;
      return r as unknown as ReturnType<FakeRes["writeHead"]>;
    },
    setHeader(k, v) {
      r.headers[k] = v;
      return r as unknown as ReturnType<FakeRes["setHeader"]>;
    },
    end(chunk?: string) {
      if (chunk) {
        try {
          r.body = JSON.parse(chunk);
        } catch {
          r.body = chunk;
        }
      }
      return r as unknown as ReturnType<FakeRes["end"]>;
    },
  };
  return r;
}

function fakeReq(opts: {
  url?: string;
  method?: string;
  remoteAddress?: string;
  body?: string;
}): import("node:http").IncomingMessage {
  // Use a Readable stream so readBody() (which uses .on("data") / .on("end"))
  // works against our fake. We layer the http-specific fields on top.
  const stream = Readable.from(opts.body ? [Buffer.from(opts.body)] : []);
  const req = stream as unknown as import("node:http").IncomingMessage & {
    socket: { remoteAddress: string };
  };
  req.url = opts.url ?? "/__internal/active-tenant";
  req.method = opts.method ?? "GET";
  req.headers = {};
  // Cast through unknown for the partial socket shape — only remoteAddress is read.
  (req as unknown as { socket: { remoteAddress: string } }).socket = {
    remoteAddress: opts.remoteAddress ?? "127.0.0.1",
  };
  return req as unknown as import("node:http").IncomingMessage;
}

describe("0839 T-011 — /__internal/active-tenant", () => {
  let configDir: string;
  beforeEach(() => {
    configDir = tmpDir();
  });

  it("returns false (no match) for unrelated paths", async () => {
    const req = fakeReq({ url: "/api/health" });
    const res = fakeRes();
    const handled = await handleActiveTenant(req, res, {
      activeTenantOptions: { configDir },
    });
    expect(handled).toBe(false);
    expect(res.statusCode).toBeNull();
  });

  it("GET returns { currentTenant: null } when config is empty", async () => {
    const req = fakeReq({ method: "GET" });
    const res = fakeRes();
    const handled = await handleActiveTenant(req, res, {
      activeTenantOptions: { configDir },
    });
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ currentTenant: null });
  });

  it("GET returns the slug from config.json", async () => {
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ currentTenant: "acme" }),
      { encoding: "utf8", mode: 0o600 },
    );
    const req = fakeReq({ method: "GET" });
    const res = fakeRes();
    await handleActiveTenant(req, res, {
      activeTenantOptions: { configDir },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ currentTenant: "acme" });
  });

  it("POST { currentTenant: 'acme' } writes config and echoes", async () => {
    const req = fakeReq({
      method: "POST",
      body: JSON.stringify({ currentTenant: "acme" }),
    });
    const res = fakeRes();
    await handleActiveTenant(req, res, {
      activeTenantOptions: { configDir },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ currentTenant: "acme" });
    const written = JSON.parse(
      fs.readFileSync(path.join(configDir, "config.json"), "utf8"),
    );
    expect(written.currentTenant).toBe("acme");
  });

  it("POST { currentTenant: null } clears the active tenant", async () => {
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ currentTenant: "acme", otherKey: "preserved" }),
      { encoding: "utf8", mode: 0o600 },
    );
    const req = fakeReq({
      method: "POST",
      body: JSON.stringify({ currentTenant: null }),
    });
    const res = fakeRes();
    await handleActiveTenant(req, res, {
      activeTenantOptions: { configDir },
    });
    expect(res.statusCode).toBe(200);
    const written = JSON.parse(
      fs.readFileSync(path.join(configDir, "config.json"), "utf8"),
    );
    expect(written.currentTenant).toBeUndefined();
    expect(written.otherKey).toBe("preserved");
  });

  it("POST with invalid JSON returns 400", async () => {
    const req = fakeReq({ method: "POST", body: "not json {" });
    const res = fakeRes();
    await handleActiveTenant(req, res, {
      activeTenantOptions: { configDir },
    });
    expect(res.statusCode).toBe(400);
    expect((res.body as { ok?: boolean }).ok).toBe(false);
  });

  it("POST with non-string slug returns 400", async () => {
    const req = fakeReq({
      method: "POST",
      body: JSON.stringify({ currentTenant: 42 }),
    });
    const res = fakeRes();
    await handleActiveTenant(req, res, {
      activeTenantOptions: { configDir },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST with malformed slug (special chars) returns 400", async () => {
    const req = fakeReq({
      method: "POST",
      body: JSON.stringify({ currentTenant: "../etc/passwd" }),
    });
    const res = fakeRes();
    await handleActiveTenant(req, res, {
      activeTenantOptions: { configDir },
    });
    expect(res.statusCode).toBe(400);
  });

  it("non-loopback remoteAddress is rejected with 403", async () => {
    const req = fakeReq({ remoteAddress: "192.168.1.42" });
    const res = fakeRes();
    await handleActiveTenant(req, res, {
      activeTenantOptions: { configDir },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PUT/DELETE methods return 405", async () => {
    const req = fakeReq({ method: "PUT" });
    const res = fakeRes();
    await handleActiveTenant(req, res, {
      activeTenantOptions: { configDir },
    });
    expect(res.statusCode).toBe(405);
  });

  it("ignores ?_= cache-buster query suffix", async () => {
    const req = fakeReq({
      method: "GET",
      url: "/__internal/active-tenant?_=12345",
    });
    const res = fakeRes();
    const handled = await handleActiveTenant(req, res, {
      activeTenantOptions: { configDir },
    });
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
  });
});

// Make sure linter knows we use vi for symbol-name suppression in CI.
void vi;
