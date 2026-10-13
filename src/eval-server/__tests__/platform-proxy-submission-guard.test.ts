// ---------------------------------------------------------------------------
// 0874 AC-06 / 0896 — Studio publish never sends a private repository, or one
// whose visibility GitHub cannot confirm, to public intake.
//
// The eval-server proxy screens `POST /api/v1/submissions` before anything
// leaves the machine. A fake platform server counts every upstream request;
// the visibility check (isPrivateOrUnknownRepo) is mocked so each test picks
// the GitHub answer, and `fetch` is spied on so no other request slips out.
// ---------------------------------------------------------------------------

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as http from "node:http";

const hostedGate = vi.hoisted(() => ({ open: false }));
vi.mock("../../lib/hosted-publishing.js", () => ({
  get HOSTED_PRIVATE_PUBLISHING_AVAILABLE() { return hostedGate.open; },
}));

const isPrivateOrUnknownRepoMock = vi.hoisted(() => vi.fn<[string, string], Promise<boolean>>());
vi.mock("../../lib/private-source.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/private-source.js")>()),
  isPrivateOrUnknownRepo: isPrivateOrUnknownRepoMock,
}));

vi.mock("../../lib/keychain.js", () => ({
  getDefaultKeychain: () => ({
    getGitHubToken: () => "gho_never_sent",
    getVskillToken: () => "vsk_signed_in",
  }),
}));

import { invalidatePlatformProxyTokenCache, proxyToPlatform } from "../platform-proxy.js";

interface CapturedReq {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let fakePlatform: http.Server;
let upstream: CapturedReq[] = [];
let proxyServer: http.Server;
let proxyPort = 0;
const originalUrl = process.env.VSKILL_PLATFORM_URL;
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  fakePlatform = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      upstream.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "s1", state: "RECEIVED" }));
    });
  });
  await new Promise<void>((r) => fakePlatform.listen(0, "127.0.0.1", () => r()));
  const addr = fakePlatform.address();
  process.env.VSKILL_PLATFORM_URL = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  proxyServer = http.createServer((req, res) => {
    void proxyToPlatform(req, res);
  });
  await new Promise<void>((r) => proxyServer.listen(0, "127.0.0.1", () => r()));
  const paddr = proxyServer.address();
  proxyPort = typeof paddr === "object" && paddr ? paddr.port : 0;
});

afterAll(async () => {
  if (originalUrl === undefined) delete process.env.VSKILL_PLATFORM_URL;
  else process.env.VSKILL_PLATFORM_URL = originalUrl;
  proxyServer.closeAllConnections();
  fakePlatform.closeAllConnections();
  await new Promise<void>((r) => proxyServer.close(() => r()));
  await new Promise<void>((r) => fakePlatform.close(() => r()));
});

beforeEach(() => {
  upstream = [];
  hostedGate.open = false;
  isPrivateOrUnknownRepoMock.mockReset();
  invalidatePlatformProxyTokenCache();
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

function send(
  method: string,
  path: string,
  body?: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port: proxyPort, path, method, headers: { connection: "close", ...headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function submit(payload: unknown) {
  return send("POST", "/api/v1/submissions", JSON.stringify(payload), {
    "content-type": "application/json",
    authorization: "Bearer browser_supplied",
  });
}

describe("POST /api/v1/submissions is screened before it leaves the machine", () => {
  it("a client that disconnects during the visibility lookup starts no upstream request", async () => {
    let answer: (v: boolean) => void = () => {};
    let looked: () => void = () => {};
    const lookupStarted = new Promise<void>((r) => { looked = r; });
    isPrivateOrUnknownRepoMock.mockImplementation(
      () => new Promise<boolean>((r) => { answer = r; looked(); }),
    );

    const body = JSON.stringify({ repoUrl: "https://github.com/acme/public-skills", skillName: "greet" });
    const req = http.request({
      hostname: "127.0.0.1",
      port: proxyPort,
      path: "/api/v1/submissions",
      method: "POST",
      headers: { "content-type": "application/json", connection: "close" },
    });
    req.on("error", () => {});
    req.end(body);
    await lookupStarted;
    req.destroy();
    await new Promise((r) => setTimeout(r, 50));
    answer(false); // GitHub now says public, but the client is gone
    await new Promise((r) => setTimeout(r, 100));

    expect(upstream).toHaveLength(0);
  });

  it("a private repo gets 422 private_repository and nothing goes upstream", async () => {
    isPrivateOrUnknownRepoMock.mockResolvedValue(true);

    const res = await submit({ repoUrl: "https://github.com/acme/secret-skills", skillName: "greet" });

    expect(res.status).toBe(422);
    const json = JSON.parse(res.body);
    expect(json.error).toBe("private_repository");
    expect(json.message).toMatch(/nothing was submitted/i);
    expect(isPrivateOrUnknownRepoMock).toHaveBeenCalledWith("acme", "secret-skills");
    expect(upstream).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a repo GitHub cannot confirm public (unknown) also gets 422 with zero upstream calls", async () => {
    // isPrivateOrUnknownRepo is fail-closed: rate limit / outage / no token
    // all resolve to true unless the repo is confirmed public.
    isPrivateOrUnknownRepoMock.mockResolvedValue(true);

    const res = await submit({ repoUrl: "git@github.com:acme/maybe.git", skillName: "greet", privacy: "public" });

    expect(res.status).toBe(422);
    expect(JSON.parse(res.body).error).toBe("private_repository");
    expect(isPrivateOrUnknownRepoMock).toHaveBeenCalledWith("acme", "maybe");
    expect(upstream).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a confirmed public repo is forwarded with the identical body and the injected vsk_* token", async () => {
    isPrivateOrUnknownRepoMock.mockResolvedValue(false);
    const raw = JSON.stringify({
      repoUrl: "https://github.com/acme/open-skills",
      skillName: "greet",
      skillPath: "skills/greet",
      source: "studio-submit",
      privacy: "public",
    });

    const res = await send("POST", "/api/v1/submissions", raw, {
      "content-type": "application/json",
      authorization: "Bearer browser_supplied",
    });

    expect(res.status).toBe(201);
    expect(upstream).toHaveLength(1);
    expect(upstream[0].method).toBe("POST");
    expect(upstream[0].url).toBe("/api/v1/submissions");
    expect(upstream[0].body).toBe(raw);
    expect(upstream[0].headers.authorization).toBe("Bearer vsk_signed_in");
    expect(upstream[0].headers["content-length"]).toBe(String(Buffer.byteLength(raw)));
  });

  it("a missing repoUrl gets 422 unsupported_repository without a visibility lookup", async () => {
    const res = await submit({ skillName: "greet" });

    expect(res.status).toBe(422);
    const json = JSON.parse(res.body);
    expect(json.error).toBe("unsupported_repository");
    expect(json.message).toMatch(/nothing was submitted/i);
    expect(isPrivateOrUnknownRepoMock).not.toHaveBeenCalled();
    expect(upstream).toHaveLength(0);
  });

  it("an unparsable body gets 422 unsupported_repository", async () => {
    const res = await send("POST", "/api/v1/submissions", "{not json", { "content-type": "application/json" });

    expect(res.status).toBe(422);
    expect(JSON.parse(res.body).error).toBe("unsupported_repository");
    expect(upstream).toHaveLength(0);
  });

  it("a non-GitHub repo URL gets 422 unsupported_repository", async () => {
    const res = await submit({ repoUrl: "https://gitlab.com/acme/skills", skillName: "greet" });

    expect(res.status).toBe(422);
    expect(JSON.parse(res.body).error).toBe("unsupported_repository");
    expect(isPrivateOrUnknownRepoMock).not.toHaveBeenCalled();
    expect(upstream).toHaveLength(0);
  });

  it("an oversized body is refused locally and never forwarded", async () => {
    const res = await submit({ repoUrl: "https://github.com/acme/open-skills", pad: "x".repeat(300 * 1024) });

    expect(res.status).toBe(413);
    expect(JSON.parse(res.body).message).toMatch(/nothing was submitted/i);
    expect(upstream).toHaveLength(0);
  });
});

describe("other submission routes are untouched", () => {
  it("GET /api/v1/submissions/stream/<id> is forwarded without a visibility check", async () => {
    const res = await send("GET", "/api/v1/submissions/stream/abc-123");

    expect(res.status).toBe(201);
    expect(upstream).toHaveLength(1);
    expect(upstream[0].url).toBe("/api/v1/submissions/stream/abc-123");
    expect(isPrivateOrUnknownRepoMock).not.toHaveBeenCalled();
  });

  it("GET /api/v1/submissions/positions/<id> is forwarded without a visibility check", async () => {
    const res = await send("GET", "/api/v1/submissions/positions/abc-123");

    expect(res.status).toBe(201);
    expect(upstream).toHaveLength(1);
    expect(upstream[0].url).toBe("/api/v1/submissions/positions/abc-123");
    expect(isPrivateOrUnknownRepoMock).not.toHaveBeenCalled();
  });

  it("GET /api/v1/submissions?mine=1 is forwarded without a visibility check", async () => {
    const res = await send("GET", "/api/v1/submissions?mine=1");

    expect(res.status).toBe(201);
    expect(upstream).toHaveLength(1);
    expect(upstream[0].url).toBe("/api/v1/submissions?mine=1");
    expect(isPrivateOrUnknownRepoMock).not.toHaveBeenCalled();
  });
});


describe("0896 hosted private publishing guard", () => {
  it("the release default forwards explicit private intent with a tenant, with only platform auth", async () => {
    const actualGate = await vi.importActual<typeof import("../../lib/hosted-publishing.js")>("../../lib/hosted-publishing.js");
    expect(actualGate.HOSTED_PRIVATE_PUBLISHING_AVAILABLE).toBe(true);
    hostedGate.open = actualGate.HOSTED_PRIVATE_PUBLISHING_AVAILABLE;
    isPrivateOrUnknownRepoMock.mockResolvedValue(true);
    const body = { repoUrl: "https://github.com/acme/private", skillName: "secret", privacy: "private", tenantId: "tenant-1" };
    const res = await submit(body);
    expect(res.status).toBe(201);
    expect(upstream).toHaveLength(1);
    expect(JSON.parse(upstream[0].body)).toEqual(body);
    expect(upstream[0].headers.authorization).toBe("Bearer vsk_signed_in");
    expect(JSON.stringify(upstream)).not.toContain("gho_never_sent");
    // Scoped repository access is checked by the platform, never a broad local token.
    expect(isPrivateOrUnknownRepoMock).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "  ", 12])("rejects missing or invalid tenant %s before egress", async (tenantId) => {
    hostedGate.open = true;
    const res = await submit({ repoUrl: "https://github.com/acme/private", privacy: "private", tenantId });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ error: "missing_tenant", message: expect.stringContaining("connect the GitHub App") });
    expect(upstream).toHaveLength(0);
  });

  it.each(["public", "decide-later", undefined])("never sends private repo with %s intent to the public queue", async (privacy) => {
    hostedGate.open = true;
    isPrivateOrUnknownRepoMock.mockResolvedValue(true);
    const res = await submit({ repoUrl: "https://github.com/acme/private", privacy, tenantId: "tenant-1" });
    expect(res.status).toBe(422);
    expect(JSON.parse(res.body).error).toBe("private_repository");
    expect(upstream).toHaveLength(0);
  });

  it("rollback refuses private intent for a public repository too", async () => {
    isPrivateOrUnknownRepoMock.mockResolvedValue(false);
    const res = await submit({ repoUrl: "https://github.com/acme/public", privacy: "private", tenantId: "tenant-1" });
    expect(res.status).toBe(503);
    expect(JSON.parse(res.body).error).toBe("private_publishing_unavailable");
    expect(upstream).toHaveLength(0);
  });

  it("rejects a non-GitHub repository even with private intent and tenant", async () => {
    hostedGate.open = true;
    const res = await submit({ repoUrl: "https://example.com/acme/private", privacy: "private", tenantId: "tenant-1" });
    expect(res.status).toBe(422);
    expect(upstream).toHaveLength(0);
  });
});
